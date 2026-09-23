/**
 * Quality validator tests.
 *
 * Tests:
 *   1. Valid skill passes all checks
 *   2. Weak skill fails with correct issues
 *   3. Edge cases: empty desc, too many keywords, bad name
 *   4. CLI batch validation on real corpus
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { validateSkill, validateSkillsDir } from '../../src/quality/validator.mjs';
import { reportValidation } from '../../src/quality/reporter.mjs';

const TEST_DIR = resolve('tests/quality');
const FIXTURES_DIR = resolve(TEST_DIR, 'fixtures');

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

// ── Fixture helpers ───────────────────────────────────────────────────────────

/**
 * Create a temporary SKILL.md file with the given frontmatter and content.
 */
function createFixture(name, frontmatter, content = '## Instructions\n\n1. Step one.\n2. Step two.\n3. Step three.\n') {
  const dir = join(FIXTURES_DIR, name);
  mkdirSync(dir, { recursive: true });
  const fmLines = ['---'];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      fmLines.push(`${key}:`);
      for (const item of value) {
        fmLines.push(`  - ${item}`);
      }
    } else {
      fmLines.push(`${key}: ${value}`);
    }
  }
  fmLines.push('---');
  fmLines.push('');
  fmLines.push(content);
  const filePath = join(dir, 'SKILL.md');
  writeFileSync(filePath, fmLines.join('\n'), 'utf-8');
  return filePath;
}

/**
 * Create a skill with enough content (>100 tokens).
 */
function longContent() {
  const steps = [];
  for (let i = 1; i <= 20; i++) {
    steps.push(`${i}. This is step number ${i} of the instructions for this skill. It contains important details.`);
  }
  return steps.join('\n') + '\n';
}

// ── 1. Valid skill ─────────────────────────────────────────────────────────────

console.log('\n=== 1. Valid Skill ===');

const validFixture = createFixture('valid', {
  name: 'backend-api-routes',
  description: 'Design and implement RESTful API routes following industry best practices for versioning, error handling, and documentation.',
  keywords: ['api', 'rest', 'routes', 'versioning', 'errors', 'documentation'],
  domains: ['backend', 'api'],
}, longContent());

const validResult = validateSkill(validFixture, ['backend', 'api', 'design', 'frontend']);
assert(validResult.valid, 'valid skill is valid');
assertEqual(validResult.score, 100, 'valid skill score is 100');
assertEqual(validResult.issues.length, 0, 'valid skill has no issues');

// ── 2. Weak skill ─────────────────────────────────────────────────────────────

console.log('\n=== 2. Weak Skill ===');

const weakFixture = createFixture('weak', {
  name: 'bad-name',
  description: 'Too short.',
  keywords: ['only'],
  domains: ['nonexistent'],
}, 'short');

const weakResult = validateSkill(weakFixture, ['backend', 'api', 'design', 'frontend']);
assert(!weakResult.valid, 'weak skill is not valid');
assert(weakResult.score < 100, 'weak skill score is below 100');

const weakFields = weakResult.issues.map((i) => i.field);
assert(weakFields.includes('name'), 'weak skill flags bad name');
assert(weakFields.includes('description'), 'weak skill flags short description');
assert(weakFields.includes('keywords'), 'weak skill flags too few keywords');
assert(weakFields.includes('content'), 'weak skill flags short content');

// ── 3. Edge cases ─────────────────────────────────────────────────────────────

console.log('\n=== 3. Edge Cases ===');

// 3a. Empty description
const emptyDesc = createFixture('empty-desc', {
  name: 'backend-empty-desc',
  description: '',
  keywords: ['a', 'b', 'c'],
  domains: ['backend'],
}, longContent());
const emptyDescResult = validateSkill(emptyDesc, ['backend']);
assert(!emptyDescResult.valid, 'empty description fails');
assert(emptyDescResult.issues.some((i) => i.field === 'description'), 'empty desc flagged as description issue');

// 3b. Too many keywords
const tooManyKws = createFixture('too-many-kws', {
  name: 'backend-too-many-kws',
  description: 'A sufficiently long description that exceeds the minimum character requirement for validation checks to pass this particular field without any issues.',
  keywords: Array.from({ length: 20 }, (_, i) => `keyword-${i}`),
  domains: ['backend'],
}, longContent());
const tooManyKwsResult = validateSkill(tooManyKws, ['backend']);
assert(!tooManyKwsResult.valid, 'too many keywords fails');
assert(tooManyKwsResult.issues.some((i) => i.field === 'keywords'), 'too many keywords flagged');

// 3c. Bad name pattern
const badName = createFixture('bad-name', {
  name: 'noprivate',
  description: 'A sufficiently long description that exceeds the minimum character requirement for validation checks to pass this particular field without any issues.',
  keywords: ['a', 'b', 'c'],
  domains: ['backend', 'api'],
}, longContent());
const badNameResult = validateSkill(badName, ['backend', 'api']);
assert(!badNameResult.valid, 'bad name pattern fails');
assert(badNameResult.issues.some((i) => i.field === 'name'), 'bad name flagged');

// 3d. Unknown domain
const unknownDomain = createFixture('unknown-domain', {
  name: 'backend-unknown-domain',
  description: 'A sufficiently long description that exceeds the minimum character requirement for validation checks to pass this particular field without any issues.',
  keywords: ['a', 'b', 'c'],
  domains: ['backend', 'nonexistent-domain'],
}, longContent());
const unknownDomainResult = validateSkill(unknownDomain, ['backend']);
assert(!unknownDomainResult.valid, 'unknown domain fails');
assert(unknownDomainResult.issues.some((i) => i.field === 'domains'), 'unknown domain flagged');

// 3e. Description too long
const longDesc = createFixture('long-desc', {
  name: 'backend-long-desc',
  description: 'A'.repeat(401),
  keywords: ['a', 'b', 'c'],
  domains: ['backend'],
}, longContent());
const longDescResult = validateSkill(longDesc, ['backend']);
assert(!longDescResult.valid, 'too-long description fails');
assert(longDescResult.issues.some((i) => i.field === 'description'), 'long description flagged');

// 3f. Content too long
const longContentFixture = createFixture('long-content', {
  name: 'backend-long-content',
  description: 'A sufficiently long description that exceeds the minimum character requirement for validation checks to pass this particular field without any issues.',
  keywords: ['a', 'b', 'c'],
  domains: ['backend'],
}, 'word '.repeat(900));
const longContentResult = validateSkill(longContentFixture, ['backend']);
assert(!longContentResult.valid, 'too-long content fails');
assert(longContentResult.issues.some((i) => i.field === 'content'), 'long content flagged');

// 3g. Content too short
const shortContentFixture = createFixture('short-content', {
  name: 'backend-short-content',
  description: 'A sufficiently long description that exceeds the minimum character requirement for validation checks to pass this particular field without any issues.',
  keywords: ['a', 'b', 'c'],
  domains: ['backend'],
}, 'tiny');
const shortContentResult = validateSkill(shortContentFixture, ['backend']);
assert(!shortContentResult.valid, 'too-short content fails');
assert(shortContentResult.issues.some((i) => i.field === 'content'), 'short content flagged');

// 3h. Score boundaries
const perfectResult = validateSkill(validFixture, ['backend', 'api', 'design', 'frontend']);
const allFailResult = validateSkill(weakFixture, ['backend', 'api', 'design', 'frontend']);
assert(perfectResult.score === 100, 'perfect score is 100');
assert(allFailResult.score < 50, 'all-issues score is low');

// ── 4. Reporter ───────────────────────────────────────────────────────────────

console.log('\n=== 4. Reporter Output ===');

const testResults = [
  { path: '/some/path/backend/api-routes/SKILL.md', result: { valid: true, issues: [], score: 100 } },
  { path: '/some/path/backend/errors/SKILL.md', result: { valid: false, issues: [{ field: 'name', message: 'bad name' }], score: 83 } },
];
const mdReport = reportValidation(testResults);
assert(mdReport.includes('# Skill Quality Report'), 'report has title');
assert(mdReport.includes('| Skill | Score | Status | Issues |'), 'report has table header');
assert(mdReport.includes('✅'), 'report shows pass icon');
assert(mdReport.includes('❌'), 'report shows fail icon');
assert(mdReport.includes('api-routes'), 'report includes skill name');

// ── 5. Batch validation (in-memory) ───────────────────────────────────────────

console.log('\n=== 5. Batch Validation ===');

const batchResults = validateSkill(join(FIXTURES_DIR, 'valid', 'SKILL.md'), ['backend', 'api']) ||
  validateSkill(join(FIXTURES_DIR, 'valid', 'SKILL.md'), ['backend', 'api']);
assert(batchResults.valid, 'batch valid fixture passes');

// ── 6. Real corpus validation ─────────────────────────────────────────────────

console.log('\n=== 6. Real Corpus Validation ===');

const corpusResults = validateSkillsDir(resolve('data/skills'));
const corpusValid = corpusResults.filter((r) => r.result.valid).length;
const corpusInvalid = corpusResults.length - corpusValid;
const corpusAvgScore = Math.round(
  corpusResults.reduce((s, r) => s + r.result.score, 0) / corpusResults.length,
);

console.log(`  Total:  ${corpusResults.length}`);
console.log(`  Valid:  ${corpusValid}`);
console.log(`  Invalid: ${corpusInvalid}`);
console.log(`  Avg Score: ${corpusAvgScore}/100`);

assert(corpusResults.length > 0, 'corpus has at least one skill');

// Print summary of corpus issues
if (corpusInvalid > 0) {
  const issueTypes = {};
  for (const { result } of corpusResults) {
    for (const issue of result.issues) {
      const key = issue.field;
      issueTypes[key] = (issueTypes[key] || 0) + 1;
    }
  }
  console.log('\n  Corpus issue breakdown:');
  for (const [field, count] of Object.entries(issueTypes)) {
    console.log(`    ${field}: ${count} skill(s)`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n=== Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
