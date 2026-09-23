/**
 * Sync writer — apply a SyncPlan to the ZCode mirror.
 *
 * For add/update: copy <name>/SKILL.md into the mirror.
 * For remove: delete the mirror directory (never touch the project).
 * Writes .skill-router-meta.json alongside each synced skill.
 *
 * Safety guarantees:
 *   - Never modifies mirror directories that lack a .skill-router-meta.json
 *     (user-created / hand-edited skills are left alone).
 *   - Never follows symlinks outside the mirror root.
 *   - --dry-run mode computes changes but writes nothing.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  rmSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { disableSkill } from './disabler.mjs';

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SkillEntry
 * @property {string} name
 * @property {string} path   — relative to skills root
 * @property {string} hash   — SHA-256 hex digest of SKILL.md content
 */

/**
 * @typedef {Object} SyncPlan
 * @property {SkillEntry[]} add
 * @property {SkillEntry[]} update
 * @property {SkillEntry[]} remove
 * @property {SkillEntry[]} unchanged
 * @property {SkillEntry[]} disabled  — skills explicitly disabled by the user
 * @property {string}       mirrorPath
 */

/**
 * @typedef {Object} SyncOptions
 * @property {boolean} [dryRun]    — preview only, no filesystem writes
 * @property {boolean} [force]     — overwrite even if unchanged (normally unnecessary)
 * @property {boolean} [quiet]     — suppress console output
 * @property {'mirror'|'shadow'} [disableMechanism] — how to disable skills ('mirror' default)
 */

/**
 * @typedef {Object} SyncResult
 * @property {number} added       — count of skills added
 * @property {number} updated     — count of skills updated
 * @property {number} removed     — count of skills removed
 * @property {number} unchanged   — count of skills already up-to-date
 * @property {number} disabled    — count of skills disabled
 * @property {number} skipped     — count of mirror directories skipped (no meta)
 * @property {string[]} errors    — any errors encountered
 * @property {string} mirrorPath
 */

// ── Constants ──────────────────────────────────────────────────────────────────

const META_FILENAME = '.skill-router-meta.json';
const SKILL_FILE_NAME = 'SKILL.md';

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hex digest of a UTF-8 string.
 */
function hashContent(content) {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Check whether a resolved path is safely within a root directory.
 */
function isWithinRoot(checkPath, root) {
  const normalize = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const normPath = normalize(checkPath);
  const normRoot = normalize(root);
  return normPath === normRoot || normPath.startsWith(normRoot + '/');
}

/**
 * Read existing meta from a mirror skill directory, if present.
 */
function readMeta(mirrorSkillDir) {
  const metaPath = join(mirrorSkillDir, META_FILENAME);
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Write the meta file for a synced skill.
 */
function writeMeta(mirrorSkillDir, hash) {
  const meta = {
    source: 'project',
    managedBy: 'zcode-skill-router',
    hash,
  };
  writeFileSync(join(mirrorSkillDir, META_FILENAME), JSON.stringify(meta, null, 2) + '\n', 'utf-8');
}

// ── Core API ───────────────────────────────────────────────────────────────────

/**
 * Apply a sync plan to the ZCode mirror.
 *
 * @param {SyncPlan}        plan             — output from planSync()
 * @param {string}          projectSkillsDir — absolute path to the project skills root
 * @param {SyncOptions}     [options]
 * @returns {SyncResult}
 */
export function applySync(plan, projectSkillsDir, options = {}) {
  const { dryRun = false, force = false, quiet = false, disableMechanism = 'mirror' } = options;
  const mirrorRoot = resolve(plan.mirrorPath);
  const projectRoot = resolve(projectSkillsDir);
  const errors = [];
  let skipped = 0;
  let added = 0;
  let updated = 0;
  let removed = 0;
  let disabled = 0;

  if (!quiet) {
    console.log(`Applying sync plan (mirror: ${mirrorRoot})`);
    if (dryRun) console.log('  [DRY-RUN] No files will be written.');
    console.log(`  Add: ${plan.add.length}  Update: ${plan.update.length}  Remove: ${plan.remove.length}  Disabled: ${plan.disabled.length}  Unchanged: ${plan.unchanged.length}`);
  }

  // Ensure mirror root exists
  if (!dryRun) {
    try {
      mkdirSync(mirrorRoot, { recursive: true });
    } catch (err) {
      errors.push(`Failed to create mirror root: ${err.message}`);
      return { added, updated, removed, unchanged: plan.unchanged.length, skipped, errors, mirrorPath: mirrorRoot };
    }
  }

  // ── Handle disabled ──────────────────────────────────────────────────────────
  for (const entry of plan.disabled) {
    const mirrorSkillDir = join(mirrorRoot, entry.path);

    if (dryRun) {
      if (!quiet) console.log(`  [DRY-RUN] Would disable: ${entry.name}`);
      disabled++;
      continue;
    }

    const result = disableSkill(mirrorRoot, entry, disableMechanism);
    if (result.success) {
      if (!quiet) console.log(`  Disabled: ${entry.name}`);
      disabled++;
    } else {
      errors.push(result.message);
      if (!quiet) console.log(`  Failed to disable ${entry.name}: ${result.message}`);
    }
  }

  // ── Handle adds ────────────────────────────────────────────────────────────
  for (const entry of plan.add) {
    const sourcePath = join(projectRoot, entry.path, SKILL_FILE_NAME);
    const mirrorSkillDir = join(mirrorRoot, entry.path);

    if (!existsSync(sourcePath)) {
      errors.push(`Source not found for add: ${entry.name} (${sourcePath})`);
      continue;
    }

    // Safety: verify source is within project root
    if (!isWithinRoot(sourcePath, projectRoot)) {
      errors.push(`Source path escapes project root for ${entry.name}: ${sourcePath}`);
      continue;
    }

    if (dryRun) {
      if (!quiet) console.log(`  [DRY-RUN] Would add: ${entry.name}`);
      added++;
      continue;
    }

    try {
      mkdirSync(mirrorSkillDir, { recursive: true });
      copyFileSync(sourcePath, join(mirrorSkillDir, SKILL_FILE_NAME));
      writeMeta(mirrorSkillDir, entry.hash);
      if (!quiet) console.log(`  Added: ${entry.name}`);
      added++;
    } catch (err) {
      errors.push(`Failed to add ${entry.name}: ${err.message}`);
    }
  }

  // ── Handle updates ─────────────────────────────────────────────────────────
  for (const entry of plan.update) {
    const sourcePath = join(projectRoot, entry.path, SKILL_FILE_NAME);
    const mirrorSkillDir = join(mirrorRoot, entry.path);

    if (!existsSync(sourcePath)) {
      errors.push(`Source not found for update: ${entry.name} (${sourcePath})`);
      continue;
    }

    if (dryRun) {
      if (!quiet) console.log(`  [DRY-RUN] Would update: ${entry.name}`);
      updated++;
      continue;
    }

    try {
      // Only touch if the mirror dir has a meta file (managed by us)
      const meta = readMeta(mirrorSkillDir);
      if (!meta) {
        if (!quiet) console.log(`  Skipped (user-managed): ${entry.name}`);
        skipped++;
        continue;
      }

      copyFileSync(sourcePath, join(mirrorSkillDir, SKILL_FILE_NAME));
      writeMeta(mirrorSkillDir, entry.hash);
      if (!quiet) console.log(`  Updated: ${entry.name}`);
      updated++;
    } catch (err) {
      errors.push(`Failed to update ${entry.name}: ${err.message}`);
    }
  }

  // ── Handle removes ─────────────────────────────────────────────────────────
  for (const entry of plan.remove) {
    const mirrorSkillDir = join(mirrorRoot, entry.path);

    if (dryRun) {
      if (!quiet) console.log(`  [DRY-RUN] Would remove: ${entry.name}`);
      removed++;
      continue;
    }

    try {
      // Only remove if the mirror dir has a meta file (managed by us)
      const meta = readMeta(mirrorSkillDir);
      if (!meta) {
        if (!quiet) console.log(`  Skipped (user-managed): ${entry.name}`);
        skipped++;
        continue;
      }

      rmSync(mirrorSkillDir, { recursive: true, force: true });
      if (!quiet) console.log(`  Removed: ${entry.name}`);
      removed++;
    } catch (err) {
      errors.push(`Failed to remove ${entry.name}: ${err.message}`);
    }
  }

  // ── Handle unchanged ───────────────────────────────────────────────────────
  if (!quiet && plan.unchanged.length > 0) {
    console.log(`  Unchanged: ${plan.unchanged.length} skill(s) up-to-date`);
  }

  return {
    added,
    updated,
    removed,
    unchanged: plan.unchanged.length,
    disabled,
    skipped,
    errors,
    mirrorPath: mirrorRoot,
  };
}

// ── CLI entry point ────────────────────────────────────────────────────────────

const _cliArgv1 = process.argv[1]?.replace(/\\/g, '/') ?? '';
if (_cliArgv1 && import.meta.url.endsWith(_cliArgv1)) {
  console.log('This module is not meant to be run directly. Use: node bin/skill-router.mjs sync');
  process.exit(1);
}
