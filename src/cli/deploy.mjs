/**
 * Deploy CLI — main entry point for the deploy subcommand.
 *
 * Usage:
 *   node bin/skill-router.mjs deploy [--dry-run] [--rollback <file>] [--verify]
 *     [--zcode-dir <dir>] [--project-dir <dir>]
 */
import { resolve } from 'node:path';
import { planDeploy } from '../deploy/planner.mjs';
import { applyDeploy } from '../deploy/writer.mjs';
import { verifyDeploy } from '../deploy/verifier.mjs';

export async function main(argv) {
  let dryRun = false;
  let rollbackFile = null;
  let doVerify = false;
  let zcodeDir = process.env.SKILL_ROUTER_ZCODE_DIR;
  let projectDir = process.cwd();
  let quiet = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') {
      dryRun = true;
    } else if (argv[i] === '--rollback' && argv[i + 1]) {
      rollbackFile = resolve(argv[++i]);
    } else if (argv[i] === '--verify') {
      doVerify = true;
    } else if (argv[i] === '--quiet') {
      quiet = true;
    } else if (argv[i] === '--zcode-dir' && argv[i + 1]) {
      zcodeDir = resolve(argv[++i]);
    } else if (argv[i] === '--project-dir' && argv[i + 1]) {
      projectDir = resolve(argv[++i]);
    } else if (!argv[i].startsWith('--')) {
      // positional arg treated as project dir
      projectDir = resolve(argv[i]);
    }
  }

  // ── Rollback mode ──────────────────────────────────────────────────────────
  if (rollbackFile) {
    console.log(`Rolling back from: ${rollbackFile}`);
    // Read snapshot and restore
    const fs = await import('node:fs');
    const path = await import('node:path');
    try {
      const snapshot = JSON.parse(fs.readFileSync(rollbackFile, 'utf-8'));
      const mirrorRoot = resolve(snapshot.mirrorRoot ?? zcodeDir ?? path.join((await import('node:os')).homedir(), '.zcode', 'skills'));
      const snapshotDir = path.dirname(rollbackFile);
      // Use writer's rollback by calling applyDeploy with no changes
      const plan = planDeploy(projectDir, zcodeDir);
      // We'd need a dedicated rollback function — for now just note it
      console.log('  Note: full rollback requires restoring from snapshot.');
      console.log(`  Snapshot state: ${Object.keys(snapshot.state || {}).length} router(s) recorded.`);
    } catch (err) {
      console.error(`  Failed to read rollback file: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // ── Plan ───────────────────────────────────────────────────────────────────
  if (!quiet) {
    console.log('Planning deploy...');
    console.log(`  Project: ${projectDir}`);
    console.log(`  ZCode mirror: ${zcodeDir ?? '<default: ~/.zcode/skills>'}`);
    if (dryRun) console.log('  Mode: DRY-RUN');
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

  // ── Apply (unless dry-run) ─────────────────────────────────────────────────
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
        for (const err of result.errors) console.log(`    - ${err}`);
      }
    }
  }

  // ── Verify (if requested) ──────────────────────────────────────────────────
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
