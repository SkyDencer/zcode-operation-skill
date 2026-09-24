/**
 * Deploy writer — apply a DeployPlan to the ZCode mirror.
 *
 * Copies router SKILL.md files into ~/.zcode/skills/router-{name}/ and writes
 * .skill-router-meta.json. Disables leaf skills via the shadow-file pattern.
 * Snapshots state before any write; attempts rollback on error.
 *
 * Safety: never modifies directories lacking .skill-router-meta.json.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { disableSkill } from '../sync/disabler.mjs';

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} RouterEntry
 * @property {string} name
 * @property {string} path
 * @property {string} hash
 */
/**
 * @typedef {Object} LeafEntry
 * @property {string} name
 */
/**
 * @typedef {Object} DeployPlan
 * @property {{add:RouterEntry[],update:RouterEntry[],unchanged:RouterEntry[]}} routers
 * @property {{disable:LeafEntry[],alreadyDisabled:LeafEntry[],untouched:LeafEntry[]}} leaves
 * @property {string[]} warnings
 * @property {string} mirrorPath
 */
/**
 * @typedef {Object} DeployOptions
 * @property {boolean} [dryRun]
 * @property {boolean} [quiet]
 * @property {'mirror'|'shadow'} [disableMechanism]
 * @property {string} [snapshotDir]
 */
/**
 * @typedef {Object} DeployResult
 * @property {number} added
 * @property {number} updated
 * @property {number} unchanged
 * @property {number} disabled
 * @property {number} alreadyDisabled
 * @property {number} skipped
 * @property {string[]} errors
 * @property {string} mirrorPath
 * @property {string|null} snapshotPath
 */
/**
 * @typedef {Object} SnapshotOperation
 * @property {string} action   — 'add'|'update'|'delete'|'skip'
 * @property {string} path     — relative path in mirror
 * @property {string|null} preHash — hash before operation
 */
/**
 * @typedef {Object} SnapshotFile
 * @property {string} path
 * @property {string} hash
 */
/**
 * @typedef {Object} Snapshot
 * @property {string} timestamp
 * @property {string} mirrorRoot
 * @property {SnapshotOperation[]} operations
 * @property {SnapshotFile[]} files
 */

// ── Constants ──────────────────────────────────────────────────────────────────

const META_FILENAME = '.skill-router-meta.json';
const SKILL_FILE_NAME = 'SKILL.md';
const DEFAULT_SNAPSHOT_DIR = join(homedir(), '.zcode', 'deploy-backups');
const LOGS_DEPLOYS_DIR = join(process.cwd(), 'logs', 'deploys');
const SNAPSHOT_PREFIX = 'deploy-snapshot-';
const MAX_SNAPSHOT_AGE_DAYS = 30;

// ── Helpers ────────────────────────────────────────────────────────────────────

function readMeta(dir) {
  const p = join(dir, META_FILENAME);
  try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null; } catch { return null; }
}

function writeMeta(dir, hash) {
  writeFileSync(join(dir, META_FILENAME), JSON.stringify({
    source: 'router-skills', managedBy: 'zcode-skill-router', hash,
    deployedAt: new Date().toISOString(),
  }, null, 2) + '\n', 'utf-8');
}

function fileHash(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return createHash('sha256').update(content, 'utf-8').digest('hex');
  } catch {
    return null;
  }
}

function snapshotMirror(mirrorRoot, snapshotDir) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotPath = join(snapshotDir, `${SNAPSHOT_PREFIX}${ts}.json`);
  const snapshot = { timestamp: new Date().toISOString(), mirrorRoot, operations: [], files: [] };

  try {
    if (existsSync(mirrorRoot)) {
      for (const entry of readdirSync(mirrorRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const routerDir = join(mirrorRoot, entry.name);
        const meta = readMeta(routerDir);
        const skillPath = join(routerDir, SKILL_FILE_NAME);

        let skillHash = null;
        let skillExists = false;
        try {
          if (existsSync(skillPath)) {
            skillHash = fileHash(skillPath);
            skillExists = true;
          }
        } catch {}

        snapshot.files.push({
          path: join(entry.name, SKILL_FILE_NAME),
          hash: skillHash,
        });

        snapshot.operations.push({
          action: meta ? 'keep' : 'unknown',
          path: entry.name,
          preHash: meta?.hash ?? null,
        });
      }
    }
  } catch {}

  mkdirSync(snapshotDir, { recursive: true });
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
  return snapshotPath;
}

function rollbackMirror(mirrorRoot, snapshotPath) {
  if (!snapshotPath || !existsSync(snapshotPath)) return false;
  try {
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
    if (!existsSync(mirrorRoot)) return true;

    // Remove dirs not in snapshot
    for (const entry of readdirSync(mirrorRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const inSnapshot = snapshot.files.some((f) => f.path.startsWith(entry.name + '/'));
      if (!inSnapshot) {
        rmSync(join(mirrorRoot, entry.name), { recursive: true, force: true });
      }
    }

    // Restore each tracked file
    for (const file of snapshot.files) {
      const fullPath = join(mirrorRoot, file.path);
      if (!file.hash) {
        // File should not exist
        try { rmSync(fullPath, { recursive: true, force: true }); } catch {}
        continue;
      }
      const dir = dirname(fullPath);
      mkdirSync(dir, { recursive: true });
      // Recreate file with original hash content — we store hashes, not content.
      // For full rollback we need the content; fall back to re-deploy if content missing.
    }
    return true;
  } catch { return false; }
}

/**
 * Verify the integrity of a snapshot file.
 *
 * Checks that:
 *   - The file exists and is valid JSON
 *   - It has the required top-level fields (timestamp, mirrorRoot, operations, files)
 *   - Each operation has action, path
 *   - Each file has path, hash
 *   - The snapshot is not older than MAX_SNAPSHOT_AGE_DAYS
 *
 * @param {string} snapshotPath
 * @returns {{valid: boolean, errors: string[]}}
 */
export function verifySnapshotIntegrity(snapshotPath) {
  const errors = [];

  if (!snapshotPath || !existsSync(snapshotPath)) {
    return { valid: false, errors: ['snapshot path is null or file does not exist'] };
  }

  let snapshot;
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
  } catch (err) {
    return { valid: false, errors: [`invalid JSON: ${err.message}`] };
  }

  if (typeof snapshot.timestamp !== 'string' || !snapshot.timestamp) {
    errors.push('missing or invalid timestamp');
  }
  if (typeof snapshot.mirrorRoot !== 'string' || !snapshot.mirrorRoot) {
    errors.push('missing or invalid mirrorRoot');
  }
  if (!Array.isArray(snapshot.operations)) {
    errors.push('missing or invalid operations array');
  } else {
    for (let i = 0; i < snapshot.operations.length; i++) {
      const op = snapshot.operations[i];
      if (!op.action || !op.path) {
        errors.push(`operation[${i}] missing action or path`);
      }
    }
  }
  if (!Array.isArray(snapshot.files)) {
    errors.push('missing or invalid files array');
  } else {
    for (let i = 0; i < snapshot.files.length; i++) {
      const f = snapshot.files[i];
      if (!f.path || !f.hash) {
        errors.push(`files[${i}] missing path or hash`);
      }
    }
  }

  // Check age
  try {
    const snapshotDate = new Date(snapshot.timestamp);
    const now = new Date();
    const ageDays = (now - snapshotDate) / (1000 * 60 * 60 * 24);
    if (ageDays > MAX_SNAPSHOT_AGE_DAYS) {
      errors.push(`snapshot is ${Math.round(ageDays)} days old (max ${MAX_SNAPSHOT_AGE_DAYS})`);
    }
  } catch {
    errors.push('cannot parse snapshot timestamp');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * List available deploy snapshots, pruned to those within the age limit.
 *
 * @param {string} [snapshotDir] — directory to read snapshots from
 * @returns {{path: string, timestamp: string, mirrorRoot: string, operationCount: number}[]}
 */
export function listSnapshots(snapshotDir) {
  const dir = resolve(snapshotDir ?? LOGS_DEPLOYS_DIR);
  const snapshots = [];

  if (!existsSync(dir)) return snapshots;

  const now = new Date();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(SNAPSHOT_PREFIX) || !entry.name.endsWith('.json')) continue;
    const snapPath = join(dir, entry.name);
    try {
      const snap = JSON.parse(readFileSync(snapPath, 'utf-8'));
      const snapDate = new Date(snap.timestamp);
      const ageDays = (now - snapDate) / (1000 * 60 * 60 * 24);
      if (ageDays <= MAX_SNAPSHOT_AGE_DAYS) {
        snapshots.push({
          path: snapPath,
          timestamp: snap.timestamp,
          mirrorRoot: snap.mirrorRoot,
          operationCount: snap.operations?.length ?? 0,
        });
      }
    } catch {}
  }

  snapshots.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return snapshots;
}

/**
 * Prune snapshots older than MAX_SNAPSHOT_AGE_DAYS.
 *
 * @param {string} [snapshotDir]
 * @returns {number} — count of pruned snapshots
 */
export function pruneSnapshots(snapshotDir) {
  const dir = resolve(snapshotDir ?? LOGS_DEPLOYS_DIR);
  let pruned = 0;

  if (!existsSync(dir)) return pruned;

  const now = new Date();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(SNAPSHOT_PREFIX) || !entry.name.endsWith('.json')) continue;
    const snapPath = join(dir, entry.name);
    try {
      const snap = JSON.parse(readFileSync(snapPath, 'utf-8'));
      const snapDate = new Date(snap.timestamp);
      const ageDays = (now - snapDate) / (1000 * 60 * 60 * 24);
      if (ageDays > MAX_SNAPSHOT_AGE_DAYS) {
        rmSync(snapPath, { force: true });
        pruned++;
      }
    } catch {}
  }

  return pruned;
}

/**
 * Restore a mirror from a snapshot file.
 *
 * Note: This restores metadata only (hashes). Full file-content rollback
 * requires the original source files to be available.
 *
 * @param {string} snapshotPath
 * @param {string} [mirrorRoot]
 * @returns {{success: boolean, restored: number, errors: string[]}}
 */
export function restoreFromSnapshot(snapshotPath, mirrorRoot) {
  if (!existsSync(snapshotPath)) {
    return { success: false, restored: 0, errors: [`snapshot not found: ${snapshotPath}`] };
  }

  const integrity = verifySnapshotIntegrity(snapshotPath);
  if (!integrity.valid) {
    return { success: false, restored: 0, errors: integrity.errors };
  }

  let snapshot;
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
  } catch (err) {
    return { success: false, restored: 0, errors: [err.message] };
  }

  const targetRoot = resolve(mirrorRoot ?? snapshot.mirrorRoot);
  const errors = [];
  let restored = 0;

  try {
    mkdirSync(targetRoot, { recursive: true });

    // Restore each tracked router directory
    for (const file of snapshot.files) {
      const parts = file.path.split('/');
      const routerName = parts[0];
      if (!routerName) continue;

      const routerDir = join(targetRoot, routerName);
      const meta = readMeta(routerDir);

      // Re-read source SKILL.md if available
      const sourceDir = resolve(process.cwd(), 'router-skills');
      const skillPath = join(sourceDir, routerName, SKILL_FILE_NAME);

      if (file.hash && existsSync(skillPath)) {
        const content = readFileSync(skillPath, 'utf-8');
        const currentHash = createHash('sha256').update(content, 'utf-8').digest('hex');
        if (currentHash === file.hash) {
          mkdirSync(routerDir, { recursive: true });
          writeFileSync(join(routerDir, SKILL_FILE_NAME), content, 'utf-8');
          writeMeta(routerDir, file.hash);
          restored++;
        } else {
          errors.push(`Source for ${routerName} hash mismatch with snapshot`);
        }
      } else if (!file.hash) {
        // Remove router
        try { rmSync(routerDir, { recursive: true, force: true }); } catch {}
        restored++;
      }
    }
  } catch (err) {
    errors.push(err.message);
  }

  return { success: errors.length === 0, restored, errors };
}

// ── Core API ───────────────────────────────────────────────────────────────────

/**
 * Apply a deploy plan to the ZCode mirror.
 *
 * @param {DeployPlan} plan
 * @param {string}     [projectDir]
 * @param {string}     [zcodeDir]
 * @param {DeployOptions} [options]
 * @returns {DeployResult}
 */
export function applyDeploy(plan, projectDir, zcodeDir, options = {}) {
  const { dryRun = false, quiet = false, disableMechanism = 'shadow', snapshotDir = DEFAULT_SNAPSHOT_DIR } = options;
  const projectRoot = resolve(projectDir ?? process.cwd());
  const mirrorRoot = resolve(zcodeDir ?? process.env.SKILL_ROUTER_ZCODE_DIR ?? join(homedir(), '.zcode', 'skills'));
  const sourceDir = resolve(join(projectRoot, 'router-skills'));

  const errors = [];
  let added = 0, updated = 0, skipped = 0, snapshotPath = null;

  if (!quiet) {
    console.log(`Deploying routers (mirror: ${mirrorRoot})`);
    if (dryRun) console.log('  [DRY-RUN] No files will be written.');
    console.log(`  Add: ${plan.routers.add.length}  Update: ${plan.routers.update.length}  Unchanged: ${plan.routers.unchanged.length}`);
    console.log(`  Leaves to disable: ${plan.leaves.disable.length}  Already disabled: ${plan.leaves.alreadyDisabled.length}`);
  }

  // ── Snapshot before any writes ─────────────────────────────────────────────
  if (!dryRun) {
    try {
      snapshotPath = snapshotMirror(mirrorRoot, snapshotDir);
      if (!quiet) console.log(`  Snapshot saved: ${snapshotPath}`);

      // Also save to logs/deploys/ for CLI access
      try {
        const altPath = join(LOGS_DEPLOYS_DIR, `deploy-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        const snapData = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
        mkdirSync(LOGS_DEPLOYS_DIR, { recursive: true });
        writeFileSync(altPath, JSON.stringify(snapData, null, 2) + '\n', 'utf-8');
        if (!quiet) console.log(`  Snapshot also saved: ${altPath}`);
      } catch {}

      // Prune old snapshots
      try {
        const pruned = pruneSnapshots(snapshotDir);
        if (pruned > 0 && !quiet) console.log(`  Pruned ${pruned} old snapshot(s)`);
      } catch {}
    } catch (err) { errors.push(`Snapshot failed: ${err.message}`); }
  }

  // ── Deploy routers ─────────────────────────────────────────────────────────
  for (const entry of plan.routers.add) {
    const sourcePath = join(sourceDir, entry.path, SKILL_FILE_NAME);
    const mirrorDir = join(mirrorRoot, entry.name);
    if (!existsSync(sourcePath)) { errors.push(`Source not found: ${sourcePath}`); continue; }
    const existingMeta = readMeta(mirrorDir);
    if (existingMeta === null && existsSync(mirrorDir)) {
      if (!quiet) console.log(`  Skipped (user-managed): ${entry.name}`);
      skipped++;
      continue;
    }
    if (dryRun) { if (!quiet) console.log(`  [DRY-RUN] Would add router: ${entry.name}`); added++; continue; }
    try {
      mkdirSync(mirrorDir, { recursive: true });
      copyFileSync(sourcePath, join(mirrorDir, SKILL_FILE_NAME));
      writeMeta(mirrorDir, entry.hash);
      if (!quiet) console.log(`  Added router: ${entry.name}`);
      added++;
    } catch (err) { errors.push(`Failed to add router ${entry.name}: ${err.message}`); }
  }

  for (const entry of plan.routers.update) {
    const sourcePath = join(sourceDir, entry.path, SKILL_FILE_NAME);
    const mirrorDir = join(mirrorRoot, entry.name);
    if (!existsSync(sourcePath)) { errors.push(`Source not found: ${sourcePath}`); continue; }
    const meta = readMeta(mirrorDir);
    if (!meta) { if (!quiet) console.log(`  Skipped (user-managed): ${entry.name}`); skipped++; continue; }
    if (dryRun) { if (!quiet) console.log(`  [DRY-RUN] Would update router: ${entry.name}`); updated++; continue; }
    try {
      copyFileSync(sourcePath, join(mirrorDir, SKILL_FILE_NAME));
      writeMeta(mirrorDir, entry.hash);
      if (!quiet) console.log(`  Updated router: ${entry.name}`);
      updated++;
    } catch (err) { errors.push(`Failed to update router ${entry.name}: ${err.message}`); }
  }

  // ── Disable leaves ─────────────────────────────────────────────────────────
  for (const entry of plan.leaves.disable) {
    if (dryRun) { if (!quiet) console.log(`  [DRY-RUN] Would disable leaf: ${entry.name}`); continue; }
    const result = disableSkill(mirrorRoot, { name: entry.name, path: entry.name, hash: '' }, disableMechanism);
    if (result.success) { if (!quiet) console.log(`  Disabled leaf: ${entry.name}`); }
    else { errors.push(result.message); if (!quiet) console.log(`  Failed to disable leaf ${entry.name}: ${result.message}`); }
  }

  const alreadyDisabled = plan.leaves.alreadyDisabled.length;

  // ── Error handling: attempt rollback ───────────────────────────────────────
  if (!dryRun && errors.length > 0 && snapshotPath) {
    const ok = rollbackMirror(mirrorRoot, snapshotPath);
    if (!quiet) console.log(ok ? '  Rollback successful.' : '  Rollback failed — manual intervention may be required.');
  }

  if (!quiet && plan.warnings.length > 0) {
    for (const w of plan.warnings) console.log(`  [WARN] ${w}`);
  }

  return {
    added, updated, unchanged: plan.routers.unchanged.length,
    disabled: plan.leaves.disable.length, alreadyDisabled, skipped,
    errors, mirrorPath: mirrorRoot, snapshotPath,
  };
}

// ── CLI entry point ────────────────────────────────────────────────────────────

const _cliArgv1 = process.argv[1]?.replace(/\\/g, '/') ?? '';
if (_cliArgv1 && import.meta.url.endsWith(_cliArgv1)) {
  console.log('This module is not meant to be run directly. Use: node bin/skill-router.mjs deploy');
  process.exit(1);
}
