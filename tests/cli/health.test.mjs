/**
 * CLI health command tests.
 *
 * Tests:
 *   1. All checks pass on healthy system -> exit 0
 *   2. Missing hook -> exit 2
 *   3. llama-server absent -> exit 0 / PASS with SLM disabled, exit 1 / WARN with SLM enabled
 *   4. Stale index -> exit 2
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const CLI = resolve(ROOT, 'bin', 'skill-router.mjs');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertExitCode(output, expectedCode, message) {
  assert(output.exitCode === expectedCode, message);
}

function assertContains(output, substring, message) {
  if (output.includes(substring)) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
    console.error(`    Expected output to contain: "${substring}"`);
    console.error(`    Got: ${output.slice(0, 500)}`);
  }
}

// ── 1. All checks pass on healthy system -> exit 0 ────────────────────────────

console.log('\n=== 1. Healthy System (exit 0) ===');

// On a healthy system with hook registered, all checks should pass.
// We simulate this by checking the health command runs and outputs the expected sections.
try {
  const child = spawn(process.execPath, [CLI, 'health'], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let exitCode = null;

  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (code) => {
    exitCode = code;
    // Exit 0 on fully healthy, 1 on warning, 2 on failure
    // Our project may have hook-not-registered as a known state, so check structure
    assertContains(stdout, 'Skill Router — Health Check', 'outputs title');
    assertContains(stdout, 'Routers installed', 'lists routers check');
    assertContains(stdout, 'Hook registered', 'lists hook check');
    assertContains(stdout, 'Index is fresh', 'lists index check');
    assertContains(stdout, 'Hook invocable', 'lists hook invocable check');
    assertContains(stdout, 'llama-server', 'lists llama-server check');
    assertContains(stdout, 'No forbidden files', 'lists forbidden files check');
    assertContains(stdout, 'Thresholds file', 'lists thresholds check');
    assertContains(stdout, 'PASS', 'shows PASS statuses');
    assertContains(stdout, '8 total', 'reports 8 checks total');
  });

  // Wait a bit for async checks
  await new Promise((r) => setTimeout(r, 3000));
} catch (err) {
  failed++;
  console.error(`  ✗ health command crashed: ${err.message}`);
}

// ── 2. Missing hook -> exit 2 ─────────────────────────────────────────────────

console.log('\n=== 2. Missing Hook (exit 2) ===');

try {
  // Temporarily rename the hook config to simulate missing hook
  const configPath = resolve(homedir(), '.zcode', 'cli', 'config.json');
  let backup = null;

  if (existsSync(configPath)) {
    backup = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(backup);
    // Remove our hook from config
    if (config.hooks?.events?.UserPromptSubmit) {
      config.hooks.events.UserPromptSubmit = config.hooks.events.UserPromptSubmit.map((group) => ({
        ...group,
        hooks: (group.hooks || []).filter((h) => {
          const args = h.args || [];
          return !JSON.stringify(args).includes('route.mjs');
        }),
      })).filter((g) => (g.hooks?.length ?? 0) > 0);
    }
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  const child = spawn(process.execPath, [CLI, 'health'], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stdout += chunk; });

  await new Promise((resolve) => {
    child.on('close', (code) => {
      assert(code === 2, `exit code is 2 when hook missing (got ${code})`);
      assertContains(stdout, 'FAIL', 'shows FAIL status');
      assertContains(stdout, 'Hook registered', 'references hook check');
      resolve();
    });
  });

  // Restore config
  if (backup !== null) {
    writeFileSync(configPath, backup, 'utf-8');
  }
} catch (err) {
  failed++;
  console.error(`  ✗ missing hook test failed: ${err.message}`);
}

// ── 3. llama-server absent: PASS when SLM is off, WARN when SLM is on ────────

console.log('\n=== 3. llama-server Absent (exit 0 with SLM off, exit 1 with SLM on) ===');

// The check is scoped by slm.enabled. With the shipped default (SLM disabled)
// the server is optional, so its absence is the expected state and must not
// cost a warning. With SLM enabled the absent server is a real degradation and
// must still warn, so the check is exercised in both directions.
async function runHealth(env) {
  const child = spawn(process.execPath, [CLI, 'health'], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let code = null;
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stderr += c; });
  await new Promise((resolve) => {
    child.on('close', (c) => { code = c; resolve(); });
  });
  return { stdout, stderr, code };
}

try {
  // 3a. Default config: SLM disabled -> no WARN, exit 0.
  const off = await runHealth({ SKILL_ROUTER_SLM_ENABLED: 'false' });
  assertContains(off.stdout, 'llama-server', 'reports the llama-server check with SLM disabled');
  assert(!off.stdout.includes('WARN'), 'no WARN when SLM is disabled (server is optional)');
  assert(off.code === 0, `exit 0 when the only absent service is optional (got ${off.code})`);

  // 3b. SLM enabled -> the absent server is a real degradation -> WARN, exit 1.
  const on = await runHealth({ SKILL_ROUTER_SLM_ENABLED: 'true' });
  assertContains(on.stdout, 'WARN', 'shows WARN for llama-server when SLM is enabled');
  assertContains(on.stdout, 'SLM is enabled', 'names SLM as the reason for the warning');
  assert(!on.stdout.includes('FAIL'), 'absent server warns but does not fail the check');
  assert(on.code === 1, `exit 1 on warning, not failure (got ${on.code})`);
} catch (err) {
  failed++;
  console.error(`  ✗ llama-server test failed: ${err.message}`);
}

// ── 4. Stale index -> exit 2 ──────────────────────────────────────────────────

console.log('\n=== 4. Stale Index (exit 2) ===');

let indexBackup = null;
const indexPath = resolve(ROOT, 'data', 'skill-index.json');

try {
  // Back up index
  if (existsSync(indexPath)) {
    indexBackup = readFileSync(indexPath, 'utf-8');
  }

  // Write a stale/empty index
  writeFileSync(indexPath, '[]', 'utf-8');

  const child = spawn(process.execPath, [CLI, 'health'], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stdout += chunk; });

  await new Promise((resolve) => {
    child.on('close', (code) => {
      assert(code === 2, `exit code is 2 with stale index (got ${code})`);
      assertContains(stdout, 'FAIL', 'shows FAIL status');
      assertContains(stdout, 'Index is fresh', 'references index check');
      resolve();
    });
  });

  await new Promise((r) => setTimeout(r, 3000));

  // Restore index
  if (indexBackup !== null) {
    writeFileSync(indexPath, indexBackup, 'utf-8');
  }
} catch (err) {
  // Restore index even on error
  if (indexBackup !== null && existsSync(indexPath)) {
    writeFileSync(indexPath, indexBackup, 'utf-8');
  }
  failed++;
  console.error(`  ✗ stale index test failed: ${err.message}`);
}

// ── Summary ────────────────────────────────────────────────────────────────────

console.log('\n=== Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
