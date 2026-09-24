/**
 * Deploy CLI — main entry point for the deploy subcommand.
 *
 * Usage:
 *   node bin/skill-router.mjs deploy [--dry-run] [--rollback <file>] [--verify]
 *     [--zcode-dir <dir>] [--project-dir <dir>] [--with-hook] [--no-hook]
 *     [--list-snapshots] [--restore <timestamp>]
 */
import { resolve, join } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { planDeploy } from '../deploy/planner.mjs';
import { applyDeploy, listSnapshots, restoreFromSnapshot, pruneSnapshots } from '../deploy/writer.mjs';
import { verifyDeploy } from '../deploy/verifier.mjs';
import { registerHook, unregisterHook, isHookRegistered, detectHookConfigPath } from '../deploy/hook-registrar.mjs';

const SNAPSHOT_PREFIX = 'deploy-snapshot-';
const LOGS_DEPLOYS_DIR = resolve('logs', 'deploys');

export async function main(argv) {
  let dryRun = false;
  let rollbackFile = null;
  let doVerify = false;
  let zcodeDir = process.env.SKILL_ROUTER_ZCODE_DIR;
  let projectDir = process.cwd();
  let quiet = false;
  let withHook = true;
  let listSnapshotsFlag = false;
  let restoreTimestamp = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') {
      dryRun = true;
    } else if (argv[i] === '--rollback' && argv[i + 1]) {
      rollbackFile = resolve(argv[++i]);
    } else if (argv[i] === '--verify') {
      doVerify = true;
    } else if (argv[i] === '--quiet') {
      quiet = true;
    } else if (argv[i] === '--with-hook') {
      withHook = true;
    } else if (argv[i] === '--no-hook') {
      withHook = false;
    } else if (argv[i] === '--list-snapshots') {
      listSnapshotsFlag = true;
    } else if (argv[i] === '--restore' && argv[i + 1]) {
      restoreTimestamp = argv[++i];
    } else if (argv[i] === '--zcode-dir' && argv[i + 1]) {
      zcodeDir = resolve(argv[++i]);
    } else if (argv[i] === '--project-dir' && argv[i + 1]) {
      projectDir = resolve(argv[++i]);
    } else if (!argv[i].startsWith('--')) {
      projectDir = resolve(argv[i]);
    }
  }

  // ── List snapshots ─────────────────────────────────────────────────────────
  if (listSnapshotsFlag) {
    const snaps = listSnapshots(LOGS_DEPLOYS_DIR);
    if (snaps.length === 0) {
      console.log('No deploy snapshots found.');
      return;
    }
    console.log(`Deploy snapshots (${snaps.length}):`);
    console.log('');
    console.log('  Timestamp                              | Mirror Root                              | Ops');
    console.log('  ' + '-'.repeat(80));
    for (const s of snaps) {
      const ts = s.timestamp.slice(0, 23);
      const mirror = (s.mirrorRoot ?? '<default>').slice(0, 40);
      console.log(`  ${ts.padEnd(32)} | ${mirror.padEnd(40)} | ${s.operationCount}`);
    }
    return;
  }

  // ── Restore from snapshot ────────────────────────────────────────────────────
  if (restoreTimestamp) {
    const snaps = listSnapshots(LOGS_DEPLOYS_DIR);
    const snap = snaps.find((s) => s.timestamp.startsWith(restoreTimestamp) || s.path.includes(restoreTimestamp));
    if (!snap) {
      console.error(`Snapshot not found for: ${restoreTimestamp}`);
      console.error('Use --list-snapshots to see available snapshots.');
      process.exit(1);
    }
    console.log(`Restoring from: ${snap.path}`);
    const result = restoreFromSnapshot(snap.path, zcodeDir);
    if (result.success) {
      console.log(`  Restored ${result.restored} router(s).`);
    } else {
      console.error(`  Restore failed:`);
      for (const e of result.errors) console.error(`    - ${e}`);
      process.exit(1);
    }
    return;
  }

  // ── Rollback mode ────────────────────────────────────────────────────────────
  if (rollbackFile) {
    console.log(`Rolling back from: ${rollbackFile}`);
    try {
      const snapshot = JSON.parse(readFileSync(rollbackFile, 'utf-8'));
      const mirrorRoot = resolve(snapshot.mirrorRoot ?? zcodeDir ?? join(homedir(), '.zcode', 'skills'));
      console.log(`  Snapshot state: ${Object.keys(snapshot.state || {}).length} router(s) recorded.`);
      console.log('  Note: full rollback requires restoring from snapshot via --restore.');
    } catch (err) {
      console.error(`  Failed to read rollback file: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // ── Plan ─────────────────────────────────────────────────────────────────────
  if (!quiet) {
    console.log('Planning deploy...');
    console.log(`  Project: ${projectDir}`);
    console.log(`  ZCode mirror: ${zcodeDir ?? '<default: ~/.zcode/skills>'}`);
    if (dryRun) console.log('  Mode: DRY-RUN');
    console.log(`  Hook: ${withHook ? 'yes' : 'no'}`);
  }

  let plan;
  try {
    plan = planDeploy(projectDir, zcodeDir);
  } catch (err) {
    console.error(`Planning failed: ${err.message}`);
    process.exit(1);
  }

  if (!quiet) {
    console.log('\nPlan:');
    console.log(`  Routers to add:       ${plan.routers.add.length}`);
    console.log(`  Routers to update:    ${plan.routers.update.length}`);
    console.log(`  Routers unchanged:    ${plan.routers.unchanged.length}`);
    console.log(`  Leaves to disable:    ${plan.leaves.disable.length}`);
    console.log(`  Leaves already disabled: ${plan.leaves.alreadyDisabled.length}`);
    if (plan.warnings.length > 0) {
      console.log('\n  Warnings:');
      for (const w of plan.warnings) console.log(`    - ${w}`);
    }
  }

  // ── Apply (unless dry-run) ──────────────────────────────────────────────────
  let result;
  if (dryRun) {
    result = {
      added: plan.routers.add.length,
      updated: plan.routers.update.length,
      unchanged: plan.routers.unchanged.length,
      disabled: plan.leaves.disable.length,
      alreadyDisabled: plan.leaves.alreadyDisabled.length,
      skipped: 0,
      errors: [],
      mirrorPath: plan.mirrorPath,
      snapshotPath: null,
    };
    if (!quiet) console.log('\n[Dry-run complete — no changes applied]');
  } else {
    try {
      result = applyDeploy(plan, projectDir, zcodeDir, { quiet });
    } catch (err) {
      console.error(`Deploy failed: ${err.message}`);
      process.exit(1);
    }

    if (!quiet) {
      console.log('\nResult:');
      console.log(`  Added routers:      ${result.added}`);
      console.log(`  Updated routers:    ${result.updated}`);
      console.log(`  Unchanged routers:  ${result.unchanged}`);
      console.log(`  Disabled leaves:    ${result.disabled}`);
      console.log(`  Already disabled:   ${result.alreadyDisabled}`);
      console.log(`  Skipped:            ${result.skipped}`);
      if (result.snapshotPath) console.log(`  Snapshot:           ${result.snapshotPath}`);
      if (result.errors.length > 0) {
        console.log('\n  Errors:');
        for (const e of result.errors) console.log(`    - ${e}`);
      }
    }
  }

  // ── Hook registration ────────────────────────────────────────────────────────
  if (withHook && !dryRun && result.errors.length === 0) {
    try {
      const configPath = detectHookConfigPath(zcodeDir);
      if (configPath) {
        if (!isHookRegistered(configPath)) {
          registerHook(configPath, { pluginRoot: process.cwd() });
          if (!quiet) console.log('\n  Hook registered in ZCode CLI config.');
        } else {
          if (!quiet) console.log('\n  Hook already registered — skipping.');
        }
      }
    } catch (err) {
      console.warn(`  [WARN] Hook registration failed: ${err.message}`);
    }
  }

  // ── Verify (if requested) ────────────────────────────────────────────────────
  if (doVerify || (!dryRun && result.errors.length === 0)) {
    if (!quiet) console.log('\nVerifying deploy...');
    const report = verifyDeploy(projectDir, zcodeDir);

    if (!quiet) {
      console.log(`  Routers healthy:    ${report.routersOk ? 'YES' : 'NO'}`);
      console.log(`  Leaves healthy:     ${report.leavesOk ? 'YES' : 'NO'}`);
      if (report.warnings.length > 0) {
        console.log('\n  Warnings:');
        for (const w of report.warnings) console.log(`    - ${w}`);
      }
    }

    if (!report.routersOk || !report.leavesOk) {
      console.error('\nVerification FAILED — see warnings above.');
      process.exit(1);
    }
  }

  if (!quiet) {
    const total = result.added + result.updated + result.disabled;
    console.log(`\nDeploy complete: ${total} change(s) applied${dryRun ? ' (dry-run)' : ''}.`);
  }
}
