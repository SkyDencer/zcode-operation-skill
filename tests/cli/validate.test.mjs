/**
 * CLI validate command tests.
 *
 * Tests:
 *   1. validate subcommand runs without crashing
 *   2. validate --json outputs valid JSON
 *   3. validate reports correct total count
 *   4. validate output includes per-skill details
 *   5. validate with custom --skills-dir works
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const CLI = resolve(ROOT, 'bin', 'skill-router.mjs');
const TEST_FIXTURES = resolve(ROOT, 'tests', 'cli', 'fixtures');

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
    console.error(`    Expected: "${substring}"`);
    console.error(`    Got: ${output.slice(0, 500)}`);
  }
}

function assertJSONParseable(jsonStr, message) {
  try {
    const parsed = JSON.parse(jsonStr);
    passed++;
    console.log(`  ✓ ${message}`);
    return parsed;
  } catch {
    failed++;
    console.error(`  ✗ ${message}`);
    console.error(`    Not valid JSON: ${jsonStr.slice(0, 200)}`);
    return null;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function createFixtureSkill(dir, name, description, keywords, domains, contentTokens = 5) {
  const keywordLines = keywords.map((kw) => `  - ${kw}`).join('\n');
  const domainLines = domains.map((d) => `  - ${d}`).join('\n');
  const content = Array.from({ length: contentTokens }, (_, i) =>
    `${i + 1}. This is instruction step ${i + 1} with enough words to pass token minimums.`,
  ).join('\n');

  const fm = `---
name: ${name}
description: ${description}
keywords:
${keywordLines}
domains:
${domainLines}
---

## Instructions

${content}
`;

  const skillDir = resolve(dir, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(resolve(skillDir, 'SKILL.md'), fm, 'utf-8');
  return skillDir;
}

// ── 1. Basic validate run ──────────────────────────────────────────────────────

console.log('\n=== 1. Basic Validate Run ===');

try {
  const output = execSync(`node "${CLI}" validate`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assertContains(output, 'Validating skills', 'starts with validation header');
  assertContains(output, 'Total skills:', 'shows total count');
  assertContains(output, 'Valid:', 'shows valid count');
  assertContains(output, 'Issues:', 'shows issues count');
  assertContains(output, 'Avg score:', 'shows average score');
} catch (err) {
  // Exit code 1 is expected if there are quality issues
  const output = err.stdout?.toString() ?? '';
  assertContains(output, 'Total skills:', 'still produces output despite non-zero exit');
}

// ── 2. JSON output ─────────────────────────────────────────────────────────────

console.log('\n=== 2. JSON Output ===');

try {
  const output = execSync(`node "${CLI}" validate --json`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  const parsed = assertJSONParseable(output, 'validate --json produces valid JSON');
  if (parsed) {
    assert(typeof parsed.total === 'number', 'JSON has numeric total');
    assert(typeof parsed.valid === 'number', 'JSON has numeric valid');
    assert(Array.isArray(parsed.results), 'JSON has results array');
    if (parsed.results.length > 0) {
      const first = parsed.results[0];
      assert(typeof first.path === 'string', 'each result has path string');
      assert(typeof first.valid === 'boolean', 'each result has valid boolean');
      assert(typeof first.score === 'number', 'each result has score number');
    }
  }
} catch (err) {
  failed++;
  console.error(`  ✗ validate --json failed: ${err.message}`);
}

// ── 3. Custom skills dir with fixtures ─────────────────────────────────────────

console.log('\n=== 3. Custom Skills Dir ===');

// Clean up any previous fixtures
try { rmSync(TEST_FIXTURES, { recursive: true, force: true }); } catch { /* ignore */ }

try {
  // Create a valid skill and an invalid skill
  const validDir = createFixtureSkill(TEST_FIXTURES, 'backend-valid-skill',
    'A well-written skill about backend development patterns and best practices.',
    ['backend', 'patterns', 'best practices', 'development'],
    ['backend'],
    10,
  );

  const invalidDir = createFixtureSkill(TEST_FIXTURES, 'bad-name',
    'short',
    ['only'],
    ['nonexistent'],
    2,
  );

  const output = execSync(`node "${CLI}" validate --skills-dir "${TEST_FIXTURES}" --json`, {
    encoding: 'utf-8',
    cwd: ROOT,
    stdio: 'pipe',
  });
  const parsed = assertJSONParseable(output, 'custom dir validate produces valid JSON');
  if (parsed) {
    assert(parsed.total === 2, `expected 2 skills, got ${parsed.total}`);
    const valid = parsed.results.filter((r) => r.valid);
    const invalid = parsed.results.filter((r) => !r.valid);
    assert(valid.length === 1, 'one valid skill in fixtures');
    assert(invalid.length === 1, 'one invalid skill in fixtures');
    assert(valid[0].score === 100, 'valid skill scores 100');
    assert(invalid[0].score < 100, 'invalid skill scores below 100');
  }
} catch (err) {
  failed++;
  console.error(`  ✗ custom dir test failed: ${err.message}`);
  if (err.stderr) console.error(`  stderr: ${err.stderr.toString()}`);
} finally {
  // Clean up fixtures
  try { rmSync(TEST_FIXTURES, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ── 4. Missing directory ───────────────────────────────────────────────────────

console.log('\n=== 4. Missing Directory ===');

try {
  execSync(`node "${CLI}" validate --skills-dir /nonexistent/path`, {
    encoding: 'utf-8',
    cwd: ROOT,
    stdio: 'pipe',
  });
  failed++;
  console.error('  ✗ missing dir should exit non-zero');
} catch (err) {
  const output = (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '');
  assert(err.status !== 0, 'missing dir exits non-zero');
  assertContains(output, 'not found', 'error mentions directory not found');
}

// ── Summary ────────────────────────────────────────────────────────────────────

console.log('\n=== Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
