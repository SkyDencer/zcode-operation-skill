/**
 * Corpus validator rule tests (Sub-Phase 7.2).
 *
 * Classifies the eight SKILL.md fixtures under tests/corpus/fixtures —
 * five valid, three invalid — and pins each of the four corpus rules
 * individually with purpose-built files in a temporary directory.
 *
 * Under test: src/corpus/validator.mjs
 */
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { validateSkill, validateSkills, MIN_DESC_LEN, MAX_DESC_LEN, NAME_SHAPE } from '../../src/corpus/validator.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, 'fixtures');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  + ${message}`);
  } else {
    failed++;
    console.error(`  x ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

function fields(result) {
  return result.issues.map((i) => i.field);
}

// ── Section 1: the eight fixtures ─────────────────────────────────────────────

console.log('\n=== Section 1: fixture corpus classification ===');

const EXPECTED = [
  { file: 'backend/cache-priming/SKILL.md', valid: true, name: 'backend-cache-priming' },
  { file: 'backend/queue-backoff/SKILL.md', valid: true, name: 'backend-queue-backoff' },
  { file: 'frontend/streaming-ssr/SKILL.md', valid: true, name: 'frontend-streaming-ssr' },
  { file: 'testing/contract-first/SKILL.md', valid: true, name: 'testing-contract-first' },
  { file: 'router-python/SKILL.md', valid: true, name: 'router-python' },
  { file: 'broken/no-frontmatter/SKILL.md', valid: false, name: '' },
  { file: 'broken/overlong-description/SKILL.md', valid: false, name: 'backend-overlong-description' },
  { file: 'broken/bad-name-shape/SKILL.md', valid: false, name: 'Observability' },
];

const results = await validateSkills(EXPECTED.map((e) => join(FIXTURES, e.file)));
const byPath = new Map(results.map((r) => [r.path, r.result]));

assertEqual(results.length, 8, 'validateSkills() finds all 8 fixtures');
for (const expected of EXPECTED) {
  const result = byPath.get(join(FIXTURES, expected.file));
  const label = `${expected.valid ? 'valid' : 'invalid'}: ${expected.file}`;
  assert(Boolean(result), `${label} was read`);
  if (!result) continue;
  assertEqual(result.valid, expected.valid, `${label} classified correctly`);
  assertEqual(result.parsed.name, expected.name, `${label} parsed name`);
  assert(Array.isArray(result.issues), `${label} carries an issues array`);
}

const validCount = results.filter((r) => r.result.valid).length;
assertEqual(validCount, 5, 'exactly 5 fixtures are valid');
assertEqual(results.length - validCount, 3, 'exactly 3 fixtures are invalid');

// ── Section 2: each invalid fixture fails the expected rule ───────────────────

console.log('\n=== Section 2: rule attribution for the invalid fixtures ===');

const noFm = byPath.get(join(FIXTURES, 'broken/no-frontmatter/SKILL.md'));
assert(fields(noFm).includes('frontmatter'), 'no-frontmatter: fails the frontmatter rule');
assert(fields(noFm).includes('name'), 'no-frontmatter: also fails the name rule');
assert(fields(noFm).includes('description'), 'no-frontmatter: also fails the description rule');
assertEqual(noFm.parsed.hasFrontmatter, false, 'no-frontmatter: hasFrontmatter is false');

const overlong = byPath.get(join(FIXTURES, 'broken/overlong-description/SKILL.md'));
assertEqual(overlong.parsed.hasFrontmatter, true, 'overlong-description: has frontmatter');
assert(overlong.parsed.descriptionLength > MAX_DESC_LEN, 'overlong-description: description is over the ceiling');
assertEqual(fields(overlong).join(','), 'description', 'overlong-description: fails only the description rule');

const badName = byPath.get(join(FIXTURES, 'broken/bad-name-shape/SKILL.md'));
assertEqual(fields(badName).join(','), 'name', 'bad-name-shape: fails only the name-shape rule');
assertEqual(badName.parsed.descriptionLength >= MIN_DESC_LEN, true, 'bad-name-shape: its description is long enough');

// ── Section 3: rule boundaries with purpose-built files ───────────────────────

console.log('\n=== Section 3: rule boundaries ===');

const tmp = mkdtempSync(join(tmpdir(), 'corpus-validator-'));

function writeFixture(name, body) {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), body, 'utf-8');
  return join(dir, 'SKILL.md');
}

const desc40 = 'a'.repeat(MIN_DESC_LEN);
const desc400 = 'b'.repeat(MAX_DESC_LEN);

try {
  const at40 = await validateSkill(
    writeFixture('at-40', `---\nname: backend-exact-min\ndescription: ${desc40}\n---\n\nbody\n`),
  );
  assertEqual(at40.valid, true, 'a 40-char description is accepted (inclusive lower bound)');

  const at400 = await validateSkill(
    writeFixture('at-400', `---\nname: backend-exact-max\ndescription: ${desc400}\n---\n\nbody\n`),
  );
  assertEqual(at400.valid, true, 'a 400-char description is accepted (inclusive upper bound)');

  const at39 = await validateSkill(
    writeFixture('at-39', `---\nname: backend-one-short\ndescription: ${'a'.repeat(MIN_DESC_LEN - 1)}\n---\n\nbody\n`),
  );
  assertEqual(at39.valid, false, 'a 39-char description is rejected');
  assertEqual(fields(at39).join(','), 'description', 'the 39-char case is a description issue');

  const at401 = await validateSkill(
    writeFixture('at-401', `---\nname: backend-one-long\ndescription: ${'b'.repeat(MAX_DESC_LEN + 1)}\n---\n\nbody\n`),
  );
  assertEqual(at401.valid, false, 'a 401-char description is rejected');
  assertEqual(fields(at401).join(','), 'description', 'the 401-char case is a description issue');

  const noName = await validateSkill(
    writeFixture('no-name', `---\ndescription: ${desc40}\n---\n\nbody\n`),
  );
  assertEqual(noName.valid, false, 'a manifest with no name is rejected');
  assertEqual(fields(noName).join(','), 'name', 'the no-name case is a name issue');

  const noDesc = await validateSkill(
    writeFixture('no-desc', `---\nname: backend-no-desc\n---\n\nbody\n`),
  );
  assertEqual(noDesc.valid, false, 'a manifest with no description is rejected');
  assertEqual(fields(noDesc).join(','), 'description', 'the no-description case is a description issue');

  const emptyDesc = await validateSkill(
    writeFixture('empty-desc', `---\nname: backend-empty-desc\ndescription:\n---\n\nbody\n`),
  );
  assertEqual(emptyDesc.valid, false, 'an empty description is rejected');

  // The name shape rule.
  for (const good of ['backend-eloquent', 'testing-contract-first', 'router-python', 'frontend-x']) {
    const r = await validateSkill(
      writeFixture(`good-${good}`, `---\nname: ${good}\ndescription: ${desc40}\n---\n\nbody\n`),
    );
    assert(r.valid, `name "${good}" matches the {domain}-{specific} shape`);
  }
  for (const bad of ['Observability', 'backend', 'Backend-Eloquent', 'backend-', '-backend', 'backend_eloquent', 'backend--eloquent', 'back end eloquent']) {
    const r = await validateSkill(
      writeFixture(`bad-${bad.replace(/[^a-z0-9]+/gi, '_')}`, `---\nname: ${bad}\ndescription: ${desc40}\n---\n\nbody\n`),
    );
    assert(!r.valid, `name "${bad}" is rejected`);
    assert(fields(r).includes('name'), `name "${bad}" is rejected on the name rule`);
  }

  // The {domain}-{specific} regex is the shape the shipped corpus uses.
  assert(NAME_SHAPE.test('backend-api-resources'), 'NAME_SHAPE accepts a three-segment shipped name');
  assert(NAME_SHAPE.test('testing-integration-testing'), 'NAME_SHAPE accepts testing-integration-testing');
  assert(!NAME_SHAPE.test('debugging'), 'NAME_SHAPE rejects a single segment');

  // A read error is an issue, not a crash.
  const missing = await validateSkills([join(tmp, 'does-not-exist', 'SKILL.md')]);
  assertEqual(missing.length, 1, 'validateSkills() returns an entry for an unreadable file');
  assertEqual(missing[0].result.valid, false, 'an unreadable file is invalid, not a thrown error');
  assertEqual(fields(missing[0].result).join(','), 'file', 'an unreadable file is reported on the file field');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n=== Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) process.exit(1);
