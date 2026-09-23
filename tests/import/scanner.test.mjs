/**
 * Scanner tests.
 *
 * Tests:
 *   1. Basic scan finds all SKILL.md files
 *   2. Scan ignores non-SKILL.md files
 *   3. Scan handles nested directories
 *   4. Scan reports sourcePath correctly
 *   5. Scan extracts frontmatter fields
 *   6. Scan throws on missing directory
 *   7. Scan handles empty directory
 *   8. Scan respects maxDepth
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSource } from '../../src/import/scanner.mjs';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, 'fixtures');
const TMP = resolve(__dirname, 'tmp');

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

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
  }
}

function assertTrue(actual, message) {
  if (actual) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message} (expected truthy, got ${JSON.stringify(actual)})`);
  }
}

// ── 1. Basic scan ──────────────────────────────────────────────────────────────

console.log('\n=== 1. Basic Scan ===');

const candidates = await scanSource(FIXTURES);
assert(candidates.length >= 3, 'finds at least 3 candidates in fixtures');
assert(candidates.every((c) => c.name && typeof c.name === 'string'), 'all candidates have name strings');
assert(candidates.every((c) => c.sourcePath && typeof c.sourcePath === 'string'), 'all candidates have sourcePath strings');
assert(candidates.every((c) => Array.isArray(c.keywords)), 'all candidates have keywords array');
assert(candidates.every((c) => Array.isArray(c.domains)), 'all candidates have domains array');
assert(candidates.every((c) => typeof c.content === 'string'), 'all candidates have content string');

// ── 2. Ignores non-SKILL.md files ─────────────────────────────────────────────

console.log('\n=== 2. Ignores Non-SKILL.md Files ===');

const readmeCandidates = candidates.filter((c) => c.sourcePath.includes('README') || c.sourcePath.includes('NOTES'));
assert(readmeCandidates.length === 0, 'no README or NOTES files are included');

// ── 3. Nested directories ─────────────────────────────────────────────────────

console.log('\n=== 3. Nested Directories ===');

const nested = candidates.find((c) => c.name === 'testing-nested-deep');
assertTrue(!!nested, 'finds deeply nested skill');
assert(nested.sourcePath.includes('normal-nested'), 'nested skill path contains correct directory');
assert(nested.sourcePath.includes('SKILL.md'), 'nested skill path ends with SKILL.md');

// ── 4. Source path correctness ─────────────────────────────────────────────────

console.log('\n=== 4. Source Path Correctness ===');

const validOne = candidates.find((c) => c.name === 'testing-valid-skill-one');
assertTrue(!!validOne, 'finds valid-skill-one');
assertEqual(validOne.sourcePath.endsWith('SKILL.md'), true, 'sourcePath ends with SKILL.md');
assert(validOne.sourcePath.includes('fixtures'), 'sourcePath is under fixtures');

// ── 5. Frontmatter extraction ──────────────────────────────────────────────────

console.log('\n=== 5. Frontmatter Extraction ===');

const validTwo = candidates.find((c) => c.name === 'testing-valid-skill-two');
assertTrue(!!validTwo, 'finds valid-skill-two');
assertEqual(validTwo.name, 'testing-valid-skill-two', 'name extracted correctly');
assertEqual(validTwo.description.length > 0, true, 'description is non-empty');
assertEqual(Array.isArray(validTwo.keywords), true, 'keywords is array');
assertEqual(validTwo.keywords.length >= 3, true, 'keywords has at least 3 entries');
assertEqual(Array.isArray(validTwo.domains), true, 'domains is array');
assert(validTwo.domains.includes('testing'), 'domains includes testing');
assert(validTwo.content.length > 100, 'content has meaningful length');

// ── 6. Missing directory throws ────────────────────────────────────────────────

console.log('\n=== 6. Missing Directory Throws ===');

try {
  await scanSource('/nonexistent/path/that/does/not/exist');
  assert(false, 'should throw on missing directory');
} catch (err) {
  assert(err.message.includes('not found'), 'error mentions not found');
  assertTrue(err.message.length > 20, 'error message is descriptive');
}

// ── 7. Empty directory ─────────────────────────────────────────────────────────

console.log('\n=== 7. Empty Directory ===');

const emptyDir = resolve(TMP, 'empty');
try {
  mkdirSync(emptyDir, { recursive: true });
  const emptyResult = await scanSource(emptyDir);
  assertEqual(emptyResult.length, 0, 'returns empty array for empty directory');
} finally {
  rmSync(emptyDir, { recursive: true, force: true });
}

// ── 8. Max depth limit ─────────────────────────────────────────────────────────

console.log('\n=== 8. Max Depth Limit ===');

const deepDir = resolve(TMP, 'deep');
try {
  mkdirSync(resolve(deepDir, 'a', 'b', 'c', 'd', 'e'), { recursive: true });
  writeFileSync(resolve(deepDir, 'a', 'b', 'c', 'd', 'e', 'SKILL.md'), [
    '---',
    'name: deep-skill',
    'description: A skill buried very deep in the directory tree.',
    'keywords:',
    '  - deep',
    '  - nested',
    '  - test',
    'domains:',
    '  - testing',
    '---',
    '',
    'Content here.',
  ].join('\n'), 'utf-8');

  // With default maxDepth (10), should find it
  const withDepth = await scanSource(deepDir);
  assert(withDepth.length >= 1, 'finds deep skill with default maxDepth');

  // With maxDepth=2, should NOT find it (it's at depth 5)
  const shallow = await scanSource(deepDir, { maxDepth: 2 });
  assertEqual(shallow.length, 0, 'respects maxDepth limit');
} finally {
  rmSync(deepDir, { recursive: true, force: true });
}

// ── Summary ────────────────────────────────────────────────────────────────────

console.log('\n=== Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
