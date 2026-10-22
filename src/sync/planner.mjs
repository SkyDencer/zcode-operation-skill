/**
 * Sync planner — compare project skills with the ZCode mirror and classify
 * each skill as add / update / remove / unchanged based on SHA-256 content hash.
 *
 * The planner does NOT modify any files; it returns a pure SyncPlan object
 * that the writer can consume.
 *
 * P6-H-015: read errors are classified by `err.code` so a permission failure
 * can never be mistaken for "the skill is absent". ENOENT means the source is
 * genuinely missing (existing behaviour). EACCES/EPERM mean the file could
 * not be read, so the skill is skipped and its name is recorded as
 * "uncertain" — such a name is excluded from mirror-side `remove`
 * classification, because an unreadable project file must not prove absence
 * (doing so would let the writer delete a mirror skill the user still has).
 * Any other read error is fatal. If more than half of the project's skills
 * are unreadable, the whole plan is rejected so the writer never runs on
 * partial data. The filesystem reader is injectable (default fs/promises) as
 * a test seam.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, realpath } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { readDisabledRegistry } from './disabler.mjs';

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SkillEntry
 * @property {string} name         — skill directory name (e.g. "backend-eloquent")
 * @property {string} path         — relative path from the skills root (e.g. "backend/eloquent")
 * @property {string} hash         — SHA-256 hex digest of the SKILL.md content
 */

/**
 * @typedef {'add' | 'update' | 'remove' | 'unchanged' | 'disabled'} SkillChange
 *
 * @typedef {Object} SyncPlan
 * @property {SkillEntry[]} add         — skills present in project but absent from mirror
 * @property {SkillEntry[]} update      — skills present in both but with different hash
 * @property {SkillEntry[]} remove      — skills present in mirror but absent from project
 * @property {SkillEntry[]} unchanged   — skills identical in both
 * @property {SkillEntry[]} disabled    — skills explicitly disabled by the user (present in project & mirror, but will be removed from mirror)
 * @property {Array<{name:string, path:string, reason:string}>} skipped — skills that could not be read (permission errors), recorded but not acted on
 * @property {string[]} errors          — fatal read errors encountered while building an index
 * @property {string}       mirrorPath  — absolute path to the ZCode mirror
 */

// ── Constants ──────────────────────────────────────────────────────────────────

const SKILL_FILE_NAME = 'SKILL.md';
const DEFAULT_ZCODE_DIR = join(homedir(), '.zcode', 'skills');

// Default filesystem reader (the injectable test seam default).
const defaultReader = { readFile, readdir, stat, realpath };

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Compute the SHA-256 hash of a UTF-8 string.
 *
 * @param {string} content
 * @returns {string} hex digest
 */
function hashContent(content) {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Derive the skill name and relative path from an absolute SKILL.md path.
 *
 * @param {string} filePath — absolute SKILL.md path
 * @param {string} root     — absolute skills root
 * @returns {{name: string, path: string}}
 */
function skillPathsForPath(filePath, root) {
  const normFilePath = filePath.replace(/\\/g, '/');
  const normRoot = root.replace(/\\/g, '/');
  // Normalize to forward slashes for reliable string replacement
  const relPath = normFilePath.startsWith(normRoot)
    ? normFilePath.slice(normRoot.length).replace(/^\//, '')
    : normFilePath;
  // relPath is like "backend/eloquent/SKILL.md"
  const relativeWithoutFilename = dirname(relPath);
  return { name: relativeWithoutFilename.split('/').pop(), path: relativeWithoutFilename };
}

/**
 * Fresh per-side read diagnostics.
 *
 * @returns {{uncertain: Set<string>, skipped: Array<{name:string, path:string, reason:string}>, errors: string[]}}
 */
function makeDiagnostics() {
  return { uncertain: new Set(), skipped: [], errors: [] };
}

/**
 * Recursively walk a directory yielding absolute SKILL.md paths.
 * Never follows symlinks that escape the directory root.
 *
 * @param {string} dir     — absolute path to walk
 * @param {string} root    — absolute root for symlink safety checks
 * @param {number} depth
 * @param {{readdir:Function, stat:Function, realpath:Function}} reader
 * @yields {string} absolute path to a SKILL.md file
 */
async function* walkSkillFiles(dir, root, depth = 0, reader = defaultReader) {
  const MAX_DEPTH = 10;
  if (depth > MAX_DEPTH) return;

  let entries;
  try {
    entries = await reader.readdir(dir, { withFileTypes: true });
  } catch {
    // Permission denied or I/O error — skip silently. Making this explicit
    // (fail or classify) is P6-H-016's scope; the file-read errors are what
    // P6-H-015 addresses.
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    // Block obvious path traversal in component names
    if (entry.name.includes('..')) {
      continue;
    }

    if (entry.isSymbolicLink()) {
      // Resolve and verify the symlink target stays within root
      let realPath;
      try {
        const s = await reader.stat(fullPath);
        if (s.isSymbolicLink()) {
          realPath = await reader.realpath(fullPath);
        } else {
          realPath = fullPath;
        }
      } catch {
        continue;
      }
      const normReal = realPath.replace(/\\/g, '/');
      const normRoot = root.replace(/\\/g, '/');
      if (normReal !== normRoot && !normReal.startsWith(normRoot + '/')) {
        continue;
      }
    }

    if (entry.isDirectory()) {
      yield* walkSkillFiles(fullPath, root, depth + 1, reader);
    } else if (entry.isFile() && entry.name === SKILL_FILE_NAME) {
      yield fullPath;
    }
  }
}

/**
 * Build a Map of skill-name → SkillEntry from a directory.
 *
 * P6-H-015: each SKILL.md read is classified. ENOENT is treated as "source
 * missing" (existing behaviour). EACCES/EPERM records the skill name in
 * `diag.uncertain` and adds a skipped entry; the skill is NOT indexed. Any
 * other error is recorded in `diag.errors` and rethrown.
 *
 * @param {string} dir       — absolute path to the skills root
 * @param {{readFile:Function}} reader
 * @param {ReturnType<typeof makeDiagnostics>} diag
 * @returns {Promise<Map<string, SkillEntry>>}
 */
async function buildIndex(dir, reader, diag) {
  const index = new Map();
  const root = resolve(dir);

  for await (const filePath of walkSkillFiles(root, root, 0, reader)) {
    let content;
    try {
      content = await reader.readFile(filePath, 'utf-8');
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        // Source genuinely missing — treat as absent (existing behaviour).
        continue;
      }
      if (err && (err.code === 'EACCES' || err.code === 'EPERM')) {
        // Uncertain: we cannot prove the skill is absent. Record it so the
        // caller can exclude it from remove classification.
        const { name, path } = skillPathsForPath(filePath, root);
        diag.uncertain.add(name);
        diag.skipped.push({ name, path, reason: `unreadable (${err.code})` });
        continue;
      }
      // Any other read error is fatal: the plan must not be built on partial data.
      diag.errors.push(`${filePath}: ${err.code ?? err.message}`);
      throw err;
    }

    const { name, path } = skillPathsForPath(filePath, root);
    index.set(name, {
      name,
      path,
      hash: hashContent(content),
    });
  }

  return index;
}

// ── Core API ───────────────────────────────────────────────────────────────────

/**
 * Plan a sync operation between the project skills directory and the ZCode mirror.
 *
 * @param {string} [projectSkillsDir]  — absolute path to the project skills root (default: data/skills)
 * @param {string} [zcodeSkillsDir]    — absolute path to the ZCode mirror root
 * @param {Object} [options]
 * @param {string} [options.projectRoot] — absolute path to the project root (for reading disabled registry)
 * @param {{readFile?:Function, readdir?:Function, stat?:Function, realpath?:Function}} [options.reader]
 *   — injectable filesystem reader (test seam); defaults to fs/promises
 * @returns {Promise<SyncPlan>}
 * @throws {Error} when more than 50% of the project's skills are unreadable
 *   (P6-H-015), or on a fatal (non-permission) read error.
 */
export async function planSync(projectSkillsDir, zcodeSkillsDir, options = {}) {
  const { projectRoot = process.cwd(), reader = defaultReader } = options;
  const projectRootResolved = resolve(projectRoot);
  const projectRootDir = resolve(projectSkillsDir ?? join(projectRootResolved, 'data', 'skills'));
  const mirrorRoot = resolve(zcodeSkillsDir ?? process.env.SKILL_ROUTER_ZCODE_DIR ?? DEFAULT_ZCODE_DIR);

  // Build indices for both sides, each with its own read diagnostics.
  const projectDiag = makeDiagnostics();
  const mirrorDiag = makeDiagnostics();
  const [projectIndex, mirrorIndex] = await Promise.all([
    buildIndex(projectRootDir, reader, projectDiag),
    buildIndex(mirrorRoot, reader, mirrorDiag),
  ]);

  // P6-H-015 mass-unreadable guard: if more than half of the project's skills
  // could not be read, the plan is built on partial data and must be refused.
  const uncertainProject = projectDiag.uncertain;
  const projectItems = projectIndex.size + uncertainProject.size;
  if (projectItems > 0 && uncertainProject.size / projectItems > 0.5) {
    throw new Error(
      `sync plan rejected: ${uncertainProject.size} of ${projectItems} project skills ` +
        'are unreadable (more than 50%); refusing to plan on partial data'
    );
  }

  const add = [];
  const update = [];
  const remove = [];
  const unchanged = [];
  const disabled = [];

  // Read disabled registry to classify skills
  const { disabled: disabledNames } = readDisabledRegistry(projectRootResolved);
  const disabledSet = new Set(disabledNames);

  // Skills in project but not in mirror → add (unless disabled)
  for (const [name, entry] of projectIndex) {
    if (!mirrorIndex.has(name)) {
      if (disabledSet.has(name)) {
        disabled.push(entry);
      } else {
        add.push(entry);
      }
    } else if (entry.hash !== mirrorIndex.get(name).hash) {
      if (disabledSet.has(name)) {
        disabled.push(entry);
      } else {
        update.push(entry);
      }
    } else {
      if (disabledSet.has(name)) {
        disabled.push(entry);
      } else {
        unchanged.push(entry);
      }
    }
  }

  // Skills in mirror but not in project → remove. P6-H-015: a skill whose
  // project-side read failed (uncertain) must not prove absence, so it is
  // excluded from remove classification.
  for (const [name, entry] of mirrorIndex) {
    if (!projectIndex.has(name) && !uncertainProject.has(name)) {
      remove.push(entry);
    }
  }

  // Sort for deterministic output
  const sortFn = (a, b) => a.name.localeCompare(b.name);
  add.sort(sortFn);
  update.sort(sortFn);
  remove.sort(sortFn);
  unchanged.sort(sortFn);
  disabled.sort(sortFn);

  const skipped = [...projectDiag.skipped, ...mirrorDiag.skipped];
  const errors = [...projectDiag.errors, ...mirrorDiag.errors];

  return { add, update, remove, unchanged, disabled, skipped, errors, mirrorPath: mirrorRoot };
}

// ── CLI entry point ─────────────────────────────────────────────────────────────

const _cliArgv1 = process.argv[1]?.replace(/\\/g, '/') ?? '';
if (_cliArgv1 && import.meta.url.endsWith(_cliArgv1)) {
  const projectDir = process.argv[2];
  const mirrorDir = process.argv[3];
  const plan = await planSync(projectDir, mirrorDir);
  console.log(JSON.stringify(plan, null, 2));
}
