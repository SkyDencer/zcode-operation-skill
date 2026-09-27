#!/usr/bin/env node
/**
 * End-to-end test preparation script for ZCode Skill Router.
 *
 * Prepares the environment for a real ZCode end-to-end test by delegating to
 * the existing install and deploy scripts from this repository, then running
 * the router deploy step so the six router-* dispatcher skills are present in
 * the ZCode mirror before the human runs prompts. Finally it verifies the
 * deployment and prints the steps the human should take next.
 *
 * Delegation:
 *   - scripts/install.mjs  — Node.js install path (steps 1–6: node check, repo
 *                            verify, index build, sync dry-run, confirmation,
 *                            sync, post-install verification).
 *   - scripts/deploy.ps1   — Windows PowerShell full-deploy path (file-level
 *                            copy of the plugin to ~/.zcode/workspace/...).
 *   - bin/skill-router.mjs deploy — router-skill deploy subcommand (only the
 *                            router-* skills land in ~/.zcode/skills/).
 *
 * Usage:
 *   node scripts/zcode-e2e-prepare.mjs              # interactive
 *   node scripts/zcode-e2e-prepare.mjs --yes        # skip confirmation
 *   node scripts/zcode-e2e-prepare.mjs --dry-run    # show plan only
 */

import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Compute ROOT robustly ──────────────────────────────────────────────────────

const scriptPath = process.argv[1];
const __dirname = scriptPath
  ? dirname(resolve(scriptPath))
  : dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Parse args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const yesFlag = args.includes('--yes');
const dryRunOnly = args.includes('--dry-run');

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Run a Node.js script synchronously, inheriting stdio so its output appears
 * inline, and return its stdout. Exits on non-zero status.
 *
 * @param {string[]} cmdArgs — argv passed to `node`.
 * @param {string}   label   — printed before the command runs.
 * @returns {string} stdout captured from the child.
 */
function runNodeScript(cmdArgs, label) {
  console.log(`\n  Running: ${label}`);
  try {
    const result = execFileSync('node', cmdArgs, {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: 'inherit',
    });
    return result;
  } catch (err) {
    const output = err.stdout?.toString() ?? '';
    if (output) console.log(output);
    console.error(`\n✗ ${label} failed with exit code ${err.status ?? err.code ?? '?'}`);
    process.exit(1);
  }
}

/**
 * Attempt to run a PowerShell script synchronously. Falls back to the provided
 * fallbackFn when PowerShell is unavailable or the .ps1 file does not exist.
 * Returns the captured stdout.
 *
 * @param {string}   ps1Path    — absolute path to the .ps1 file.
 * @param {string}   label      — printed before the command runs.
 * @param {() => string} fallbackFn — called when PowerShell delegation is skipped.
 * @returns {string}
 */
function runDeployScript(ps1Path, label, fallbackFn) {
  if (!existsSync(ps1Path)) {
    console.log(`  [skip] ${label} — script not found at ${ps1Path}`);
    return fallbackFn();
  }

  try {
    const args = ['--ExecutionPolicy', 'Bypass', '-File', ps1Path];
    console.log(`\n  Running: ${label}`);
    const result = execFileSync('powershell.exe', args, {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: 'inherit',
    });
    return result;
  } catch (err) {
    console.warn(
      `  [warn] ${label} — powershell.exe failed (${err.message}); ` +
      'falling back to CLI deploy command.'
    );
    return fallbackFn();
  }
}

function runStep(label, fn) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${label}`);
  console.log('─'.repeat(60));
  try {
    fn();
  } catch (err) {
    console.error(`\n✗ Step failed: ${err.message}`);
    process.exit(1);
  }
}

function exitError(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

// ── Step 1–6: delegate to scripts/install.mjs ─────────────────────────────────

runStep('Steps 1–6 — Install (delegates to scripts/install.mjs) …', () => {
  const installArgs = ['scripts/install.mjs'];
  if (yesFlag) installArgs.push('--yes');
  if (dryRunOnly) installArgs.push('--dry-run');
  runNodeScript(installArgs, 'Installing via scripts/install.mjs');
});

if (dryRunOnly) {
  console.log('\n-- Dry-run mode. No changes were made. --\n');
  process.exit(0);
}

// ── Step 7: Deploy router skills to the ZCode mirror ─────────────────────────

runStep('Step 7/7 — Deploying router skills …', () => {
  const deployPs1 = join(ROOT, 'scripts', 'deploy.ps1');
  runDeployScript(
    deployPs1,
    'Full deploy via scripts/deploy.ps1',
    () => {
      // Fallback: invoke the router-skill deploy subcommand directly.
      runNodeScript(
        ['bin/skill-router.mjs', 'deploy'],
        'Deploying router skills via CLI'
      );
      return '';
    }
  );
});

// ── Step 8: Register hook (if not already registered) ─────────────────────────

runStep('Hook registration check …', async () => {
  const { registerHook, isHookRegistered, detectHookConfigPath } = await import(
    new URL('../src/deploy/hook-registrar.mjs', import.meta.url)
  ).then(m => m.default || m);

  const configPath = detectHookConfigPath();
  if (!configPath) {
    console.log('  WARNING: Could not detect ZCode CLI config path');
    console.log('  The hook may need manual registration.');
    return;
  }

  if (isHookRegistered(configPath)) {
    console.log(`  Hook already registered in: ${configPath}`);
  } else {
    console.log(`  Registering hook in: ${configPath}`);
    const result = registerHook(configPath);
    if (result.changed) {
      console.log('  Hook registered successfully');
    } else {
      console.log('  Hook registration returned unchanged (may already exist)');
    }
  }
});

// ── Step 9: Verify deployment ─────────────────────────────────────────────────

runStep('Post-install verification …', () => {
  runNodeScript(
    ['bin/skill-router.mjs', 'verify'],
    'Running verification'
  );
});

// ── Next steps ────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(60));
console.log('  E2E TEST PREPARATION COMPLETE');
console.log('═'.repeat(60));
console.log('');
console.log('  Next steps for the human test:');
console.log('');
console.log('  1. Restart ZCode so it picks up any config changes.');
console.log('');
console.log('  2. Open a workflow in ZCode and start typing — the skill');
console.log('     router will surface relevant subagents automatically.');
console.log('');
console.log('  3. Run these 6 prompts in order:');
console.log('');
console.log('     (1) Fix the N+1 query in the Order model.');
console.log('         Expected: implicit routing to backend-laravel skill');
console.log('');
console.log('     (2) $laravel write a Pest test for the Order model');
console.log('         Expected: explicit routing via router-laravel');
console.log('');
console.log('     (3) $next how do I add middleware');
console.log('         Expected: explicit routing via router-next');
console.log('');
console.log('     (4) Make the checkout component responsive on mobile.');
console.log('         Expected: implicit routing to frontend-react skill');
console.log('');
console.log('     (5) What is the weather today?');
console.log('         Expected: abstention (no [SKILL ROUTER] block)');
console.log('');
console.log('     (6) Refactor the payment module and update the React checkout.');
console.log('         Expected: multi-domain routing (backend + frontend)');
console.log('');
console.log('  4. For each prompt, record:');
console.log('     - Whether the model received a [SKILL ROUTER] block');
console.log('     - Which skill(s) were selected');
console.log('     - How long it took (latency)');
console.log('');
console.log('  5. After running all prompts, run:');
console.log('       node scripts/zcode-e2e-verify.mjs');
console.log('');
console.log('  6. Review the pass/fail report and compare against expected outcomes.');
console.log('');
console.log('  For troubleshooting, run:');
console.log('       node bin/skill-router.mjs doctor');
console.log('');
console.log('═'.repeat(60) + '\n');
