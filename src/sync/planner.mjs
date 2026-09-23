/**
 * Sync planner — compare project skills with the ZCode mirror and classify
 * each skill as add / update / remove / unchanged based on SHA-256 content hash.
 *
 * The planner does NOT modify any files; it returns a pure SyncPlan object
 * that the writer can consume.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
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
 * @property {string}       mirrorPath  — absolute path to the ZCode mirror
 */

// ── Constants ──────────────────────────────────────────────────────────────────

const SKILL_FILE_NAME = 'SKILL.md';
const DEFAULT_ZCODE_DIR = join(homedir(), '.zcode', 'skills');

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
 * Recursively walk a directory yielding absolute SKILL.md paths.
 * Never follows symlinks that escape the directory root.
 *
 * @param {string} dir     — absolute path to walk
 * @param {string} root    — absolute root for symlink safety checks
 * @param {number} depth
 * @yields {string} absolute path to a SKILL.md file
 */
async function* walkSkillFiles(dir, root, depth = 0) {
  const MAX_DEPTH = 10;
  if (depth > MAX_DEPTH) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // Permission denied or I/O error — skip silently
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
        const s = await stat(fullPath);
        if (s.isSymbolicLink()) {
          const { realpath } = await import('node:fs');
          realPath = await realpath(fullPath);
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
      yield* walkSkillFiles(fullPath, root, depth + 1);
    } else if (entry.isFile() && entry.name === SKILL_FILE_NAME) {
      yield fullPath;
    }
  }
}

/**
 * Build a Map of skill-name → SkillEntry from a directory.
 *
 * @param {string} dir       — absolute path to the skills root
 * @returns {Promise<Map<string, SkillEntry>>}
 */
async function buildIndex(dir) {
  const index = new Map();
  const root = resolve(dir);

  for await (const filePath of walkSkillFiles(root, root)) {
    try {
      const content = await readFile(filePath, 'utf-8');
      // Normalize to forward slashes for reliable string replacement
      const normFilePath = filePath.replace(/\\/g, '/');
      const normRoot = root.replace(/\\/g, '/');
      const relPath = normFilePath.startsWith(normRoot)
        ? normFilePath.slice(normRoot.length).replace(/^\//, '')
        : normFilePath;
      // relPath is like "backend/eloquent/SKILL.md"
      const relativeWithoutFilename = dirname(relPath);
      const name = relativeWithoutFilename.split('/').pop();

      index.set(name, {
        name,
        path: relativeWithoutFilename,
        hash: hashContent(content),
      });
    } catch {
      // skip unreadable files
    }
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
 * @returns {Promise<SyncPlan>}
 */
export async function planSync(projectSkillsDir, zcodeSkillsDir, options = {}) {
  const { projectRoot = process.cwd() } = options;
  const projectRootResolved = resolve(projectRoot);
  const projectRootDir = resolve(projectSkillsDir ?? join(projectRootResolved, 'data', 'skills'));
  const mirrorRoot = resolve(zcodeSkillsDir ?? process.env.SKILL_ROUTER_ZCODE_DIR ?? DEFAULT_ZCODE_DIR);

  // Build indices for both sides
  const [projectIndex, mirrorIndex] = await Promise.all([
    buildIndex(projectRootDir),
    buildIndex(mirrorRoot),
  ]);

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

  // Skills in mirror but not in project → remove
  for (const [name, entry] of mirrorIndex) {
    if (!projectIndex.has(name)) {
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

  return { add, update, remove, unchanged, disabled, mirrorPath: mirrorRoot };
}

// ── CLI entry point ─────────────────────────────────────────────────────────────

const _cliArgv1 = process.argv[1]?.replace(/\\/g, '/') ?? '';
if (_cliArgv1 && import.meta.url.endsWith(_cliArgv1)) {
  const projectDir = process.argv[2];
  const mirrorDir = process.argv[3];
  const plan = await planSync(projectDir, mirrorDir);
  console.log(JSON.stringify(plan, null, 2));
}
