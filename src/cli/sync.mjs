/**
 * sync — CLI handler for the sync subcommand.
 *
 * Usage:
 *   node bin/skill-router.mjs sync [--dry-run] [--force] [--quiet]
 *     [--skills-dir <dir>] [--zcode-dir <dir>]
 *     [--disable <skill-name>] [--enable <skill-name>]
 */
import { resolve, join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { planSync } from '../sync/planner.mjs';
import { applySync } from '../sync/writer.mjs';
import { readSyncState, mergeSyncResult } from '../sync/state.mjs';
import { readDisabledRegistry, writeDisabledRegistry } from '../sync/disabler.mjs';

export async function main(argv) {
  let dryRun = false;
  let force = false;
  let quiet = false;
  let projectSkillsDir = null;
  let zcodeSkillsDir = process.env.SKILL_ROUTER_ZCODE_DIR;
  let projectRoot = process.cwd();
  const disableNames = [];
  const enableNames = [];
  let disableMechanism = 'mirror';

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') {
      dryRun = true;
    } else if (argv[i] === '--force') {
      force = true;
    } else if (argv[i] === '--quiet') {
      quiet = true;
    } else if (argv[i] === '--skills-dir' && argv[i + 1]) {
      projectSkillsDir = resolve(argv[++i]);
    } else if (argv[i] === '--zcode-dir' && argv[i + 1]) {
      zcodeSkillsDir = resolve(argv[++i]);
    } else if (argv[i] === '--project-root' && argv[i + 1]) {
      projectRoot = resolve(argv[++i]);
    } else if (argv[i] === '--disable' && argv[i + 1]) {
      disableNames.push(argv[++i]);
    } else if (argv[i] === '--enable' && argv[i + 1]) {
      enableNames.push(argv[++i]);
    } else if (argv[i] === '--disable-mechanism' && argv[i + 1]) {
      disableMechanism = argv[++i];
    } else if (!argv[i].startsWith('--')) {
      // positional arg treated as project skills dir
      projectSkillsDir = resolve(argv[i]);
    }
  }

  // ── Update disabled registry ───────────────────────────────────────────────
  if (disableNames.length > 0 || enableNames.length > 0) {
    const registry = readDisabledRegistry(projectRoot);
    const currentDisabled = new Set(registry.disabled);

    for (const name of disableNames) {
      currentDisabled.add(name);
    }
    for (const name of enableNames) {
      currentDisabled.delete(name);
    }

    writeDisabledRegistry([...currentDisabled], projectRoot);

    if (!quiet) {
      console.log('Disabled registry updated.');
      for (const name of disableNames) {
        console.log(`  Disabled: ${name}`);
      }
      for (const name of enableNames) {
        console.log(`  Enabled: ${name}`);
      }
    }
  }

  // Resolve project skills dir default
  if (!projectSkillsDir) {
    projectSkillsDir = resolve(projectRoot, 'data', 'skills');
  }

  if (!quiet) {
    console.log('Syncing skills...');
    console.log(`  Project skills: ${projectSkillsDir}`);
    console.log(`  ZCode mirror:   ${zcodeSkillsDir ?? '<default>'}`);
    if (dryRun) console.log('  Mode: DRY-RUN');
    if (force) console.log('  Force: on');
    if (disableNames.length > 0) console.log(`  Disable: ${disableNames.join(', ')}`);
    if (enableNames.length > 0) console.log(`  Enable: ${enableNames.join(', ')}`);
    if (disableMechanism !== 'mirror') console.log(`  Disable mechanism: ${disableMechanism}`);
  }

  // Plan
  let plan;
  try {
    plan = await planSync(projectSkillsDir, zcodeSkillsDir, { projectRoot });
  } catch (err) {
    console.error(`Planning failed: ${err.message}`);
    process.exit(1);
  }

  if (!quiet) {
    console.log('\nPlan:');
    console.log(`  Add:       ${plan.add.length}`);
    console.log(`  Update:    ${plan.update.length}`);
    console.log(`  Remove:    ${plan.remove.length}`);
    console.log(`  Disabled:  ${plan.disabled.length}`);
    console.log(`  Unchanged: ${plan.unchanged.length}`);
  }

  // Apply
  let result;
  try {
    result = applySync(plan, projectSkillsDir, { dryRun, force, quiet, disableMechanism });
  } catch (err) {
    console.error(`Sync failed: ${err.message}`);
    process.exit(1);
  }

  if (!quiet) {
    console.log('\nResult:');
    console.log(`  Added:     ${result.added}`);
    console.log(`  Updated:   ${result.updated}`);
    console.log(`  Removed:   ${result.removed}`);
    console.log(`  Disabled:  ${result.disabled}`);
    console.log(`  Skipped:   ${result.skipped}`);
    console.log(`  Errors:    ${result.errors.length}`);
  }

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      console.error(`  Error: ${err}`);
    }
  }

  // Persist state (unless dry-run)
  if (!dryRun) {
    try {
      const currentState = readSyncState(projectRoot);
      mergeSyncResult(currentState, {
        add: plan.add,
        update: plan.update,
        remove: plan.remove,
        unchanged: plan.unchanged,
        mirrorPath: plan.mirrorPath,
      }, projectRoot);
      if (!quiet) console.log(`  State saved.`);
    } catch (err) {
      console.error(`  Failed to save state: ${err.message}`);
    }
  }

  // Summary
  if (!quiet) {
    const total = result.added + result.updated + result.removed + result.disabled;
    console.log(`\nSync complete: ${total} change(s) applied${dryRun ? ' (dry-run)' : ''}.`);
  }
}
