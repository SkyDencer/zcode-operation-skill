/**
 * Deploy writer — apply a DeployPlan to the ZCode mirror.
 *
 * Copies router SKILL.md files into ~/.zcode/skills/router-{name}/ and writes
 * .skill-router-meta.json. Disables leaf skills via the shadow-file pattern.
 * Snapshots state before any write; attempts rollback on error.
 *
 * Safety: never modifies directories lacking .skill-router-meta.json.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
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

// ── Constants ──────────────────────────────────────────────────────────────────

const META_FILENAME = '.skill-router-meta.json';
const SKILL_FILE_NAME = 'SKILL.md';
const DEFAULT_SNAPSHOT_DIR = join(homedir(), '.zcode', 'deploy-backups');

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

function snapshotMirror(mirrorRoot, snapshotDir) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotPath = join(snapshotDir, `deploy-backup-${ts}.json`);
  const snapshot = { timestamp: new Date().toISOString(), mirrorRoot, state: {} };
  try {
    for (const entry of readdirSync(mirrorRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const routerDir = join(mirrorRoot, entry.name);
      const meta = readMeta(routerDir);
      const skillPath = join(routerDir, SKILL_FILE_NAME);
      let skillContent = null;
      try { if (existsSync(skillPath)) skillContent = readFileSync(skillPath, 'utf-8'); } catch {}
      snapshot.state[entry.name] = { meta: meta ?? null, skillHash: meta?.hash ?? null, skillExists: !!skillContent };
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
    if (existsSync(mirrorRoot)) {
      for (const entry of readdirSync(mirrorRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        if (!snapshot.state[entry.name]) rmSync(join(mirrorRoot, entry.name), { recursive: true, force: true });
      }
    }
    for (const [name, info] of Object.entries(snapshot.state)) {
      const routerDir = join(mirrorRoot, name);
      if (!info.skillExists) { if (existsSync(routerDir)) rmSync(routerDir, { recursive: true, force: true }); continue; }
      mkdirSync(routerDir, { recursive: true });
      if (info.meta) writeFileSync(join(routerDir, META_FILENAME), JSON.stringify(info.meta, null, 2) + '\n', 'utf-8');
    }
    return true;
  } catch { return false; }
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

  // Snapshot before any writes
  if (!dryRun) {
    try {
      snapshotPath = snapshotMirror(mirrorRoot, snapshotDir);
      if (!quiet) console.log(`  Snapshot saved: ${snapshotPath}`);
    } catch (err) { errors.push(`Snapshot failed: ${err.message}`); }
  }

  // ── Deploy routers ─────────────────────────────────────────────────────────
  for (const entry of plan.routers.add) {
    const sourcePath = join(sourceDir, entry.path, SKILL_FILE_NAME);
    const mirrorDir = join(mirrorRoot, entry.name);
    if (!existsSync(sourcePath)) { errors.push(`Source not found: ${sourcePath}`); continue; }
    // Safety: skip if mirror dir exists but is user-managed (no meta)
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
