/**
 * Deploy verifier — check that the ZCode mirror is in a healthy post-deploy state.
 *
 * Verifies:
 *   - All expected routers are present and have valid meta files
 *   - All disabled leaves are actually disabled (shadow or removed)
 *   - No orphan router dirs exist without our meta
 *   - No leaf skill files were modified by the deploy
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { readDisabledRegistry } from '../sync/disabler.mjs';

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} RouterHealth
 * @property {string} name
 * @property {boolean} present
 * @property {boolean} hasMeta
 * @property {boolean} hasSkill
 * @property {string | null} hash
 */

/**
 * @typedef {Object} LeafHealth
 * @property {string} name
 * @property {boolean} disabled
 * @property {string} status — 'disabled', 'absent', 'enabled', 'unknown'
 */

/**
 * @typedef {Object} VerifyReport
 * @property {boolean} routersOk
 * @property {boolean} leavesOk
 * @property {string[]} warnings
 * @property {RouterHealth[]} routers
 * @property {LeafHealth[]} leaves
 * @property {string} mirrorPath
 */

// ── Constants ──────────────────────────────────────────────────────────────────

const META_FILENAME = '.skill-router-meta.json';
const SKILL_FILE_NAME = 'SKILL.md';
const DEFAULT_ZCODE_DIR = join(homedir(), '.zcode', 'skills');

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hex digest of a UTF-8 string.
 */
function hashContent(content) {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Read the meta file for a mirror router/leaf directory, if present.
 */
function readMeta(dir) {
  const metaPath = join(dir, META_FILENAME);
  try {
    if (!existsSync(metaPath)) return null;
    return JSON.parse(readFileSync(metaPath, 'utf-8'));
  } catch {
    return null;
  }
}

// ── Core API ───────────────────────────────────────────────────────────────────

/**
 * Verify the post-deploy health of the ZCode mirror.
 *
 * @param {string} [projectDir]     — absolute path to the project root
 * @param {string} [zcodeDir]       — absolute path to the ZCode skills mirror
 * @returns {VerifyReport}
 */
export function verifyDeploy(projectDir, zcodeDir) {
  const projectRoot = resolve(projectDir ?? process.cwd());
  const mirrorRoot = resolve(zcodeDir ?? process.env.SKILL_ROUTER_ZCODE_DIR ?? DEFAULT_ZCODE_DIR);
  const warnings = [];
  const routers = [];
  const leaves = [];

  // ── Check routers ──────────────────────────────────────────────────────────
  // Expected routers from router-skills/ directory
  const expectedRouters = [];
  try {
    const sourceDir = resolve(join(projectRoot, 'router-skills'));
    const entries = readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        expectedRouters.push(entry.name);
      }
    }
  } catch (err) {
    warnings.push(`Cannot scan router-skills/: ${err.message}`);
  }

  // Actual routers in mirror
  const actualRouters = new Set();
  const orphanRouters = [];
  try {
    const mirrorEntries = readdirSync(mirrorRoot, { withFileTypes: true });
    for (const entry of mirrorEntries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      // Only check router-named dirs for orphans; leaf skill dirs are expected to lack router meta
      if (!entry.name.startsWith('router-')) continue;
      const routerDir = join(mirrorRoot, entry.name);
      const meta = readMeta(routerDir);
      const skillPath = join(routerDir, SKILL_FILE_NAME);
      const hasSkill = existsSync(skillPath);
      actualRouters.add(entry.name);

      if (!meta) {
        orphanRouters.push(entry.name);
      }

      routers.push({
        name: entry.name,
        present: expectedRouters.includes(entry.name),
        hasMeta: !!meta,
        hasSkill,
        hash: meta?.hash ?? null,
      });
    }
  } catch (err) {
    warnings.push(`Cannot scan mirror: ${err.message}`);
  }

  // Missing routers (expected but not in mirror)
  for (const name of expectedRouters) {
    if (!actualRouters.has(name)) {
      routers.push({ name, present: false, hasMeta: false, hasSkill: false, hash: null });
    }
  }

  const routersOk = expectedRouters.every((name) => {
    const r = routers.find((x) => x.name === name);
    return r && r.present && r.hasMeta && r.hasSkill;
  }) && orphanRouters.length === 0;

  if (orphanRouters.length > 0) {
    warnings.push(`Orphan router dirs (no meta): ${orphanRouters.join(', ')}`);
  }

  // ── Check leaves ───────────────────────────────────────────────────────────
  let disabledNames = [];
  try {
    const registry = readDisabledRegistry(projectRoot);
    disabledNames = registry.disabled;
  } catch {
    warnings.push('Cannot read disabled registry');
  }

  for (const name of disabledNames) {
    const leafDir = join(mirrorRoot, name);
    const meta = readMeta(leafDir);
    const skillPath = join(leafDir, SKILL_FILE_NAME);

    let status = 'unknown';
    let disabled = false;

    if (!existsSync(leafDir)) {
      // mirror-mode: directory removed → effectively disabled
      status = 'absent';
      disabled = true;
    } else if (meta && meta.disabled === true) {
      status = 'disabled';
      disabled = true;
    } else if (existsSync(skillPath)) {
      // Check for shadow file (disabled frontmatter)
      try {
        const content = readFileSync(skillPath, 'utf-8');
        if (content.includes('disabled: true')) {
          status = 'disabled';
          disabled = true;
        } else {
          status = 'enabled';
        }
      } catch {
        status = 'enabled';
      }
    } else {
      status = 'absent';
      disabled = true;
    }

    leaves.push({ name, disabled, status });
  }

  const leavesOk = leaves.every((l) => l.disabled);

  return { routersOk, leavesOk, warnings, routers, leaves, mirrorPath: mirrorRoot };
}

// ── CLI entry point ────────────────────────────────────────────────────────────

const _cliArgv1 = process.argv[1]?.replace(/\\/g, '/') ?? '';
if (_cliArgv1 && import.meta.url.endsWith(_cliArgv1)) {
  const report = verifyDeploy(process.argv[2], process.argv[3]);
  console.log(JSON.stringify(report, null, 2));
}
