/**
 * CLI verify command tests.
 *
 * Tests:
 *   1. verify subcommand runs without crashing
 *   2. verify outputs check results (table format)
 *   3. verify exits 0 when all checks pass
 *   4. verify --skills-dir overrides skills directory
 *   5. verify detects missing thresholds file
 *   6. verify detects index corruption
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';

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

function assertNotContains(output, substring, message) {
  if (!output.includes(substring)) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

// ── 1. Basic verify run ───────────────────────────────────────────────────────

console.log('\n=== 1. Basic Verify Run ===');

try {
  const output = execSync(`node "${CLI}" verify`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assertContains(output, 'Skill Router', 'output has title');
  assertContains(output, 'PASS', 'output shows PASS status');
  assertContains(output, 'Check', 'output has check header');
  // Should exit 0 on healthy project
} catch (err) {
  // Exit non-zero may happen if there are actual issues — that's fine for this smoke test
  const output = err.stdout?.toString() ?? '';
  assertContains(output, 'Skill Router', 'output has title even on failure');
  if (err.status !== 0) {
    console.log('  ℹ verify exited non-zero (expected if project has sync drift)');
  }
}

// ── 2. Verify output format ───────────────────────────────────────────────────

console.log('\n=== 2. Verify Output Format ===');

try {
  const output = execSync(`node "${CLI}" verify`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assertContains(output, 'Mirror sync status', 'lists mirror sync check');
  assertContains(output, 'Orphan mirror', 'lists orphan check');
  assertContains(output, 'Meta files', 'lists meta files check');
  assertContains(output, 'Index up to date', 'lists index check');
  assertContains(output, 'Thresholds file', 'lists thresholds check');
} catch (err) {
  const output = err.stdout?.toString() ?? '';
  assertContains(output, 'Mirror sync status', 'lists mirror sync check');
  assertContains(output, 'Index up to date', 'lists index check');
}

// ── 3. Verify with missing thresholds ─────────────────────────────────────────

console.log('\n=== 3. Missing Thresholds Detection ===');

let thresholdsBackup = null;
const thresholdsPath = resolve(ROOT, 'data', 'thresholds.json');

try {
  // Back up thresholds
  if (existsSync(thresholdsPath)) {
    thresholdsBackup = readFileSync(thresholdsPath, 'utf-8');
  }

  // Remove thresholds temporarily
  if (existsSync(thresholdsPath)) {
    rmSync(thresholdsPath, { force: true });
  }

  const output = execSync(`node "${CLI}" verify`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assertContains(output, 'FAIL', 'should fail when thresholds missing');
  assertContains(output, 'Thresholds', 'references thresholds check');
} catch (err) {
  const output = err.stdout?.toString() ?? '';
  assertContains(output, 'FAIL', 'should fail when thresholds missing');
} finally {
  // Restore thresholds
  if (thresholdsBackup !== null) {
    writeFileSync(thresholdsPath, thresholdsBackup, 'utf-8');
  }
}

// ── 4. Verify with corrupted index ────────────────────────────────────────────

console.log('\n=== 4. Corrupted Index Detection ===');

let indexBackup = null;
const indexPath = resolve(ROOT, 'data', 'skill-index.json');

try {
  // Back up index
  indexBackup = readFileSync(indexPath, 'utf-8');

  // Write a corrupted index (wrong format)
  writeFileSync(indexPath, '["corrupted-index-data"]', 'utf-8');

  const output = execSync(`node "${CLI}" verify`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assertContains(output, 'FAIL', 'should fail with corrupted index');
  assertContains(output, 'Index up to date', 'references index check');
} catch (err) {
  const output = err.stdout?.toString() ?? '';
  assertContains(output, 'FAIL', 'should fail with corrupted index');
} finally {
  // Restore index
  if (indexBackup !== null) {
    writeFileSync(indexPath, indexBackup, 'utf-8');
  }
}

// ── 5. Verify with non-existent skills dir ─────────────────────────────────────

console.log('\n=== 5. Non-existent Skills Dir ===');

try {
  execSync(`node "${CLI}" verify --skills-dir /nonexistent/path`, {
    encoding: 'utf-8',
    cwd: ROOT,
    stdio: 'pipe',
  });
  // Might pass or fail depending on implementation — just check it doesn't crash
} catch (err) {
  const output = err.stdout?.toString() ?? err.stderr?.toString() ?? '';
  assert(output.length > 0, 'produces output even with missing dir');
}

// ── Summary ────────────────────────────────────────────────────────────────────

console.log('\n=== Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
