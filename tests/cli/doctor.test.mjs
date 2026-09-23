/**
 * CLI doctor command tests.
 *
 * Tests:
 *   1. doctor subcommand runs without crashing
 *   2. doctor outputs environment info
 *   3. doctor outputs corpus stats
 *   4. doctor outputs sync state
 *   5. doctor outputs benchmark data
 *   6. doctor outputs environment variables
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';

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
    console.error(`    Got: ${output.slice(0, 800)}`);
  }
}

// ── 1. Basic doctor run ───────────────────────────────────────────────────────

console.log('\n=== 1. Basic Doctor Run ===');

try {
  const output = execSync(`node "${CLI}" doctor`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assertContains(output, 'Diagnostic Report', 'output has title');
  assertContains(output, 'Environment', 'shows environment section');
  assertContains(output, 'Node version', 'shows Node version');
  assertContains(output, 'Platform', 'shows platform');
  assert(output.includes('skill-router'), 'mentions skill-router');
} catch (err) {
  failed++;
  console.error(`  ✗ doctor command failed: ${err.message}`);
  if (err.stderr) console.error(`  stderr: ${err.stderr.toString()}`);
}

// ── 2. Doctor — ZCode directory ───────────────────────────────────────────────

console.log('\n=== 2. ZCode Directory Section ===');

try {
  const output = execSync(`node "${CLI}" doctor`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assertContains(output, 'ZCode Integration', 'shows ZCode section');
  assertContains(output, 'ZCode skills dir', 'shows ZCode dir path');
} catch (err) {
  failed++;
  console.error(`  ✗ ZCode section test failed: ${err.message}`);
}

// ── 3. Doctor — Corpus stats ──────────────────────────────────────────────────

console.log('\n=== 3. Corpus Section ===');

try {
  const output = execSync(`node "${CLI}" doctor`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assertContains(output, 'Corpus', 'shows corpus section');
  assertContains(output, 'SKILL.md count', 'shows skill count');
  assertContains(output, 'Index entries', 'shows index entry count');
  // Corpus should have a positive number of skills
  const countMatch = output.match(/SKILL\.md count\s+(\d+)/);
  if (countMatch) {
    assert(parseInt(countMatch[1]) > 0, `corpus has ${countMatch[1]} skills (> 0)`);
  }
} catch (err) {
  failed++;
  console.error(`  ✗ corpus section test failed: ${err.message}`);
}

// ── 4. Doctor — Thresholds ────────────────────────────────────────────────────

console.log('\n=== 4. Thresholds Section ===');

try {
  const output = execSync(`node "${CLI}" doctor`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assertContains(output, 'Thresholds', 'shows thresholds section');
  assertContains(output, 'High threshold', 'shows high threshold');
  assertContains(output, 'Medium threshold', 'shows medium threshold');
} catch (err) {
  failed++;
  console.error(`  ✗ thresholds section test failed: ${err.message}`);
}

// ── 5. Doctor — Sync state ────────────────────────────────────────────────────

console.log('\n=== 5. Sync State Section ===');

try {
  const output = execSync(`node "${CLI}" doctor`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assertContains(output, 'Sync State', 'shows sync state section');
  assertContains(output, 'Last sync', 'shows last sync time');
} catch (err) {
  failed++;
  console.error(`  ✗ sync state section test failed: ${err.message}`);
}

// ── 6. Doctor — Benchmark baseline ─────────────────────────────────────────────

console.log('\n=== 6. Benchmark Baseline Section ===');

try {
  const output = execSync(`node "${CLI}" doctor`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assertContains(output, 'Benchmark Baseline', 'shows benchmark section');
  // If thresholds.json has benchmark data, we should see Top-1
  if (output.includes('Top-1 accuracy')) {
    assertContains(output, '%', 'benchmark shows percentage');
  }
} catch (err) {
  failed++;
  console.error(`  ✗ benchmark section test failed: ${err.message}`);
}

// ── 7. Doctor — Environment overrides ──────────────────────────────────────────

console.log('\n=== 7. Environment Overrides Section ===');

try {
  const output = execSync(`node "${CLI}" doctor`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assertContains(output, 'Environment Overrides', 'shows env overrides section');
  // Should mention SKILL_ROUTER vars or "(none set)"
  assert(
    output.includes('SKILL_ROUTER') || output.includes('(none set)'),
    'references env var prefix',
  );
} catch (err) {
  failed++;
  console.error(`  ✗ env overrides section test failed: ${err.message}`);
}

// ── 8. Doctor — Config defaults ───────────────────────────────────────────────

console.log('\n=== 8. Config Defaults Section ===');

try {
  const output = execSync(`node "${CLI}" doctor`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assertContains(output, 'Config Defaults', 'shows config defaults section');
  assertContains(output, 'BM25 k1', 'shows BM25 k1');
  assertContains(output, 'RRF k', 'shows RRF k');
} catch (err) {
  failed++;
  console.error(`  ✗ config defaults section test failed: ${err.message}`);
}

// ── 9. Doctor is read-only (no filesystem changes) ────────────────────────────

console.log('\n=== 9. Read-only Check ===');

try {
  const beforeStats = {};
  const indexPath = resolve(ROOT, 'data', 'skill-index.json');
  const thresholdsPath = resolve(ROOT, 'data', 'thresholds.json');

  if (existsSync(indexPath)) {
    beforeStats.indexMtime = statSync(indexPath).mtimeMs;
  }
  if (existsSync(thresholdsPath)) {
    beforeStats.thresholdsMtime = statSync(thresholdsPath).mtimeMs;
  }

  execSync(`node "${CLI}" doctor`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });

  // Verify files were not modified
  if (existsSync(indexPath)) {
    const afterMtime = statSync(indexPath).mtimeMs;
    assert(afterMtime === beforeStats.indexMtime, 'index file not modified by doctor');
  }
  if (existsSync(thresholdsPath)) {
    const afterMtime = statSync(thresholdsPath).mtimeMs;
    assert(afterMtime === beforeStats.thresholdsMtime, 'thresholds file not modified by doctor');
  }
  assert(true, 'doctor is read-only (no files changed)');
} catch (err) {
  failed++;
  console.error(`  ✗ read-only test failed: ${err.message}`);
}

// ── Summary ────────────────────────────────────────────────────────────────────

console.log('\n=== Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
