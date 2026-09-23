#!/usr/bin/env node
/**
 * One-command install script for the ZCode Skill Router plugin.
 *
 * Usage:
 *   node scripts/install.mjs              # interactive (prompts for confirmation)
 *   node scripts/install.mjs --yes        # skip confirmation
 *   node scripts/install.mjs --dry-run    # show plan only, do not install
 *
 * Steps:
 *   1. Verify Node >= 20
 *   2. Verify repo location
 *   3. Build the skill index
 *   4. Run sync --dry-run and show plan
 *   5. Ask for confirmation (unless --yes)
 *   6. Run sync
 *   7. Run verify
 *   8. Print next steps
 */

import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Parse args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const yesFlag = args.includes('--yes');
const dryRunOnly = args.includes('--dry-run');

// ── Helpers ───────────────────────────────────────────────────────────────────

function node(...args) {
  return execFileSync('node', args, {
    cwd: ROOT,
    stdio: 'inherit',
    encoding: 'utf-8',
  });
}

function runStep(label, fn) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${label}`);
  console.log('─'.repeat(60));
  fn();
}

function exitError(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

// ── Step 1: Verify Node version ───────────────────────────────────────────────

runStep('Step 1/6 — Checking Node.js version …', () => {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (isNaN(major) || major < 20) {
    exitError(`Node.js >= 20 is required, but found v${process.versions.node}.`);
  }
  console.log(`  Node.js v${process.versions.node} ✓`);
});

// ── Step 2: Verify repo location ──────────────────────────────────────────────

runStep('Step 2/6 — Verifying repository location …', () => {
  const buildIndex = join(ROOT, 'hooks', 'build-index.mjs');
  const skillRouter = join(ROOT, 'bin', 'skill-router.mjs');
  const pkgJson = join(ROOT, 'package.json');

  if (!existsSync(pkgJson)) {
    exitError(
      'package.json not found. Run this script from the repository root.\n' +
      `  Expected: ${pkgJson}`
    );
  }
  if (!existsSync(buildIndex)) {
    exitError(
      'hooks/build-index.mjs not found. Run this script from the repository root.\n' +
      `  Expected: ${buildIndex}`
    );
  }
  if (!existsSync(skillRouter)) {
    exitError(
      'bin/skill-router.mjs not found. Run this script from the repository root.\n' +
      `  Expected: ${skillRouter}`
    );
  }
  console.log(`  Repository: ${ROOT} ✓`);
});

// ── Step 3: Build the skill index ─────────────────────────────────────────────

runStep('Step 3/6 — Building skill index …', () => {
  try {
    node('hooks/build-index.mjs');
    console.log('  Index built ✓');
  } catch (err) {
    exitError('Failed to build skill index. See output above.');
  }
});

// ── Step 4: Dry-run sync — show plan ──────────────────────────────────────────

runStep('Step 4/6 — Sync plan (dry-run) …', () => {
  let output;
  try {
    output = node('bin/skill-router.mjs', 'sync', '--dry-run');
  } catch (err) {
    output = err.stdout?.toString() ?? '';
  }
  console.log(output);
});

if (dryRunOnly) {
  console.log('\n── Dry-run mode. No changes were made. ──\n');
  process.exit(0);
}

// ── Step 5: Confirm with user ─────────────────────────────────────────────────

runStep('Step 5/6 — Confirm installation …', () => {
  if (yesFlag) {
    console.log('  --yes flag provided, skipping confirmation.');
    return;
  }

  // In non-interactive mode (piped input), skip confirmation silently
  if (!process.stdin.isTTY) {
    console.log('  Non-interactive mode detected, skipping confirmation.');
    return;
  }

  process.stdout.write('\n  This will install the Skill Router plugin into your ZCode workspace.\n');
  process.stdout.write('  Proceed? [y/N] ');

  const answer = process.stdin.readline()?.trim().toLowerCase();
  if (answer !== 'y' && answer !== 'yes') {
    console.log('\n  Installation cancelled.');
    process.exit(0);
  }
  console.log('  Confirmed ✓');
});

// ── Step 6: Sync to ZCode mirror ──────────────────────────────────────────────

runStep('Step 6/6 — Syncing to ZCode mirror …', () => {
  try {
    const output = node('bin/skill-router.mjs', 'sync');
    console.log(output);
  } catch (err) {
    const output = err.stdout?.toString() ?? '';
    console.log(output);
    exitError('Sync failed. See output above.');
  }
});

// ── Step 7: Verify ────────────────────────────────────────────────────────────

runStep('Post-install verification …', () => {
  let output;
  try {
    output = node('bin/skill-router.mjs', 'verify');
    console.log(output);
  } catch (err) {
    output = err.stdout?.toString() ?? '';
    console.log(output);
  }
});

// ── Next steps ────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(60));
console.log('  INSTALLATION COMPLETE');
console.log('═'.repeat(60));
console.log('');
console.log('  Next steps:');
console.log('');
console.log('  1. Restart ZCode so it picks up the new plugin.');
console.log('');
console.log('  2. Open a workflow in ZCode and start typing — the skill');
console.log('     router will surface relevant subagents automatically.');
console.log('');
console.log('  3. Optional: add more skills by running:');
console.log('       node bin/skill-router.mjs import /path/to/skills');
console.log('     Then re-run:');
console.log('       node scripts/install.mjs --yes');
console.log('');
console.log('  4. Run the benchmark to confirm everything works:');
console.log('       node bin/skill-router.mjs benchmark --mode bm25');
console.log('');
console.log('  For troubleshooting, run:');
console.log('       node bin/skill-router.mjs doctor');
console.log('');
console.log('═'.repeat(60) + '\n');
