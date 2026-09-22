/**
 * CLI list command tests.
 *
 * Tests:
 *   1. help subcommand exits cleanly
 *   2. list subcommand outputs skill groups
 *   3. list groups skills by domain
 *   4. list shows quality scores
 *   5. stats shows corpus statistics
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

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

// ── 1. Help ────────────────────────────────────────────────────────────────────

console.log('\n=== 1. Help Subcommand ===');

try {
  const helpOutput = execSync(`node "${CLI}" help`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assert(helpOutput.includes('skill-router'), 'help output mentions skill-router');
  assertContains(helpOutput, 'list', 'help lists list subcommand');
  assertContains(helpOutput, 'add', 'help lists add subcommand');
  assertContains(helpOutput, 'remove', 'help lists remove subcommand');
  assertContains(helpOutput, 'validate', 'help lists validate subcommand');
  assertContains(helpOutput, 'reindex', 'help lists reindex subcommand');
  assertContains(helpOutput, 'benchmark', 'help lists benchmark subcommand');
  assertContains(helpOutput, 'stats', 'help lists stats subcommand');
} catch (err) {
  failed++;
  console.error(`  ✗ help command failed: ${err.message}`);
}

// ── 2. Unknown subcommand ──────────────────────────────────────────────────────

console.log('\n=== 2. Unknown Subcommand ===');

try {
  execSync(`node "${CLI}" foobar`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  failed++;
  console.error('  ✗ unknown subcommand should exit non-zero');
} catch (err) {
  const output = (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '');
  assert(err.status !== 0, 'unknown subcommand exits non-zero');
  assertContains(output, 'foobar', 'error mentions the unknown subcommand');
}

// ── 3. List subcommand ─────────────────────────────────────────────────────────

console.log('\n=== 3. List Subcommand ===');

try {
  const listOutput = execSync(`node "${CLI}" list`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assert(listOutput.length > 100, 'list output is substantial');
  assertContains(listOutput, 'backend', 'list shows backend domain');
  assertContains(listOutput, 'frontend', 'list shows frontend domain');
  assertContains(listOutput, 'design', 'list shows design domain');
  assertContains(listOutput, 'testing', 'list shows testing domain');
  assertContains(listOutput, '✅', 'list shows valid skill icon');
  assertContains(listOutput, '| Skill |', 'list shows table header');
  assertContains(listOutput, 'Summary', 'list shows summary section');
  assertContains(listOutput, 'Total skills:', 'list shows total count');

  // Verify we see actual skill names
  assertContains(listOutput, 'backend-eloquent', 'list shows a backend skill');
  assertContains(listOutput, 'frontend-hooks-basics', 'list shows a frontend skill');
} catch (err) {
  failed++;
  console.error(`  ✗ list command failed: ${err.message}`);
  if (err.stderr) console.error(`  stderr: ${err.stderr.toString()}`);
}

// ── 4. Stats subcommand ────────────────────────────────────────────────────────

console.log('\n=== 4. Stats Subcommand ===');

try {
  const statsOutput = execSync(`node "${CLI}" stats`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assert(statsOutput.includes('Total skills:'), 'stats shows total count');
  assert(statsOutput.includes('Domains'), 'stats shows domain section');
  assert(statsOutput.includes('Top Keywords'), 'stats shows keywords section');
  // Should show some number > 0
  const totalMatch = statsOutput.match(/Total skills:\s*(\d+)/);
  if (totalMatch) {
    assert(parseInt(totalMatch[1]) > 0, 'total skills is positive');
  }
} catch (err) {
  failed++;
  console.error(`  ✗ stats command failed: ${err.message}`);
}

// ── 5. Validate subcommand (basic smoke test) ─────────────────────────────────

console.log('\n=== 5. Validate Subcommand ===');

try {
  const validateOutput = execSync(`node "${CLI}" validate`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assert(validateOutput.includes('Validating skills'), 'validate starts with header');
  assert(validateOutput.includes('Total skills:'), 'validate shows total');
  assert(validateOutput.includes('Summary'), 'validate shows summary');
} catch (err) {
  // Validate may exit non-zero if there are quality issues — that's OK for this test
  const output = err.stdout?.toString() ?? err.stderr?.toString() ?? '';
  assert(output.includes('Total skills:'), 'validate still shows output even with issues');
}

// ── Summary ────────────────────────────────────────────────────────────────────

console.log('\n=== Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
