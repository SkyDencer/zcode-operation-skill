/**
 * Plan a deploy operation: compare router-skills/ with the ZCode mirror and
 * classify each router as add / update / unchanged.
 *
 * The planner also reads the disabled-registry to classify leaf skills that
 * should be disabled in the mirror. It does NOT modify any files.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { readDisabledRegistry } from '../sync/disabler.mjs';

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} RouterEntry
 * @property {string} name         — router directory name (e.g. "router-next")
 * @property {string} path         — relative path from router-skills root
 * @property {string} hash         — SHA-256 hex digest of the SKILL.md content
 */

/**
 * @typedef {Object} LeafEntry
 * @property {string} name         — skill directory name to disable
 */

/**
 * @typedef {Object} DeployPlan
 * @property {{add: RouterEntry[], update: RouterEntry[], unchanged: RouterEntry[]}} routers
 * @property {{disable: LeafEntry[], alreadyDisabled: LeafEntry[], untouched: LeafEntry[]}} leaves
 * @property {string[]} warnings
 * @property {string} mirrorPath  — absolute path to the ZCode mirror
 */

// ── Constants ──────────────────────────────────────────────────────────────────

const SKILL_FILE_NAME = 'SKILL.md';
const META_FILENAME = '.skill-router-meta.json';
const DEFAULT_ZCODE_DIR = join(homedir(), '.zcode', 'skills');

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hex digest of a UTF-8 string.
 */
function hashContent(content) {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Read the meta file for a mirror router directory, if present.
 */
function readMeta(mirrorRouterDir) {
  const metaPath = join(mirrorRouterDir, META_FILENAME);
  try {
    if (!existsSync(metaPath)) return null;
    return JSON.parse(readFileSync(metaPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Check whether a path is safely within a root directory.
 */
function isWithinRoot(checkPath, root) {
  const normalize = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const normPath = normalize(checkPath);
  const normRoot = normalize(root);
  return normPath === normRoot || normPath.startsWith(normRoot + '/');
}

/**
 * Scan the project skills directory and build a name→relative-path map.
 * Used to resolve the correct mirror path when disabling a leaf skill
 * by name (e.g. "backend-eloquent" → "backend/laravel/eloquent").
 *
 * @param {string} projectRoot — absolute path to the project root
 * @returns {Map<string, string>} name → relative path
 */
function buildSkillPathMap(projectRoot) {
  const skillsDir = resolve(projectRoot, 'data', 'skills');
  const nameToPath = new Map();

  function walk(dir, relPrefix) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const child of entries) {
        const fullPath = join(dir, child.name);
        const relPath = relPrefix ? `${relPrefix}/${child.name}` : child.name;
        if (child.isDirectory()) {
          // Check if this dir has a SKILL.md directly (leaf skill)
          const skillMd = join(fullPath, 'SKILL.md');
          if (existsSync(skillMd)) {
            try {
              const content = readFileSync(skillMd, 'utf-8');
              const fmMatch = content.match(/^---\s*\n([\s\S]+?)\n---\s*\n?/);
              if (fmMatch) {
                const nameMatch = fmMatch[1].match(/^name:\s*(.+)$/m);
                if (nameMatch) {
                  nameToPath.set(nameMatch[1].trim(), relPath);
                }
              }
            } catch { /* skip unreadable files */ }
          }
          walk(fullPath, relPath);
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  try {
    if (existsSync(skillsDir)) {
      walk(skillsDir, '');
    }
  } catch { /* skills dir missing — map stays empty */ }

  return nameToPath;
}

// ── Core API ───────────────────────────────────────────────────────────────────

/**
 * Plan a deploy operation: compare router-skills/ with the ZCode mirror.
 *
 * @param {string} [projectDir]         — absolute path to the project root
 * @param {string} [zcodeDir]           — absolute path to the ZCode skills mirror
 * @param {Object} [options]
 * @param {string} [options.routerSkillsDir] — absolute path to router-skills/ (default: router-skills/)
 * @returns {DeployPlan}
 */
export function planDeploy(projectDir, zcodeDir, options = {}) {
  const { routerSkillsDir } = options;
  const projectRoot = resolve(projectDir ?? process.cwd());
  const sourceDir = resolve(routerSkillsDir ?? join(projectRoot, 'router-skills'));
  const mirrorRoot = resolve(zcodeDir ?? process.env.SKILL_ROUTER_ZCODE_DIR ?? DEFAULT_ZCODE_DIR);

  const warnings = [];

  // ── Scan source routers ────────────────────────────────────────────────────
  const sourceRouters = new Map();
  try {
    const entries = readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (!isWithinRoot(join(sourceDir, entry.name), sourceDir)) continue;

      const skillPath = join(sourceDir, entry.name, SKILL_FILE_NAME);
      if (!statSync(skillPath).isFile()) {
        warnings.push(`Source router ${entry.name} missing SKILL.md — skipped`);
        continue;
      }
      const content = readFileSync(skillPath, 'utf-8');
      sourceRouters.set(entry.name, {
        name: entry.name,
        path: entry.name,
        hash: hashContent(content),
      });
    }
  } catch (err) {
    warnings.push(`Failed to scan source routers: ${err.message}`);
  }

  // ── Scan mirror routers ────────────────────────────────────────────────────
  const mirrorRouters = new Map();
  const userManagedDirs = new Set();
  try {
    const mirrorEntries = readdirSync(mirrorRoot, { withFileTypes: true });
    for (const entry of mirrorEntries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const routerDir = join(mirrorRoot, entry.name);
      const meta = readMeta(routerDir);
      if (meta) {
        const skillPath = join(routerDir, SKILL_FILE_NAME);
        let hash = null;
        try {
          if (statSync(skillPath).isFile()) {
            hash = hashContent(readFileSync(skillPath, 'utf-8'));
          }
        } catch { /* missing SKILL.md */ }
        mirrorRouters.set(entry.name, {
          name: entry.name,
          path: entry.name,
          hash: hash ?? meta.hash ?? null,
        });
      } else {
        userManagedDirs.add(entry.name);
      }
      // Directories without meta are user-managed — never touch them
    }
  } catch (err) {
    warnings.push(`Failed to scan mirror routers: ${err.message}`);
  }

  // ── Classify routers ───────────────────────────────────────────────────────
  const add = [];
  const update = [];
  const unchanged = [];

  for (const [name, entry] of sourceRouters) {
    if (userManagedDirs.has(name)) {
      warnings.push(`Router ${name} exists in mirror but is user-managed (no meta) — skipped`);
      continue;
    }
    if (!mirrorRouters.has(name)) {
      add.push(entry);
    } else if (entry.hash !== mirrorRouters.get(name).hash) {
      update.push(entry);
    } else {
      unchanged.push(entry);
    }
  }

  // Sort for deterministic output
  const sortFn = (a, b) => a.name.localeCompare(b.name);
  add.sort(sortFn);
  update.sort(sortFn);
  unchanged.sort(sortFn);

  // ── Classify leaves from disabled registry ─────────────────────────────────
  let disabledNames = [];
  try {
    const registry = readDisabledRegistry(projectRoot);
    disabledNames = registry.disabled;
  } catch {
    warnings.push('Failed to read disabled registry — leaves will be treated as untouched');
  }

  // Build name→relative-path map from project skills to resolve correct mirror paths
  const skillPathMap = buildSkillPathMap(projectRoot);

  const disable = [];
  const alreadyDisabled = [];
  const untouched = [];

  for (const name of disabledNames) {
    // Look up the correct relative path from the project skills index.
    // Using only the raw name (e.g. "backend-laravel-eloquent") produces a
    // wrong mirror path when the actual SKILL.md lives under a subdirectory
    // like backend/laravel/eloquent/ — that path does not exist on disk and
    // disableSkill() fails, which previously caused deploy to rollback the
    // successful router additions.
    const relPath = skillPathMap.get(name) ?? name;
    // Check if already disabled in mirror (directory absent or shadowed)
    const mirrorSkillDir = join(mirrorRoot, relPath);
    const meta = readMeta(mirrorSkillDir);
    if (meta && meta.disabled === true) {
      alreadyDisabled.push({ name });
    } else {
      disable.push({ name, path: relPath });
    }
  }

  return {
    routers: { add, update, unchanged },
    leaves: { disable, alreadyDisabled, untouched },
    warnings,
    mirrorPath: mirrorRoot,
  };
}

// ── CLI entry point ────────────────────────────────────────────────────────────

const _cliArgv1 = process.argv[1]?.replace(/\\/g, '/') ?? '';
if (_cliArgv1 && import.meta.url.endsWith(_cliArgv1)) {
  const plan = planDeploy(process.argv[2], process.argv[3]);
  console.log(JSON.stringify(plan, null, 2));
}
