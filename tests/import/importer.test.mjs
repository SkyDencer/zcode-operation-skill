/**
 * Importer tests.
 *
 * Tests:
 *   1. Valid candidates are imported
 *   2. Invalid candidates are rejected with reasons
 *   3. Duplicate names are skipped (without --force)
 *   4. Duplicate names are overwritten (with --force)
 *   5. Path traversal is blocked
 *   6. Missing source file is rejected
 *   7. Empty candidate list returns empty result
 *   8. Report format is correct
 *   9. CLI integration works end-to-end
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importSkills } from '../../src/import/importer.mjs';
import { reportImport, formatConsoleReport } from '../../src/import/reporter.mjs';
import { scanSource } from '../../src/import/scanner.mjs';
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';

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

// ── Helpers ────────────────────────────────────────────────────────────────────

function cleanTmp() {
  if (existsSync(TMP)) {
    rmSync(TMP, { recursive: true, force: true });
  }
  mkdirSync(TMP, { recursive: true });
}

function buildCandidate(name, desc, kws, doms, extra = {}) {
  const fixtureDir = resolve(FIXTURES, name);
  mkdirSync(fixtureDir, { recursive: true });
  const content = [
    '---',
    `name: ${name}`,
    `description: ${desc}`,
    'keywords:',
    ...kws.map((k) => `  - ${k}`),
    'domains:',
    ...doms.map((d) => `  - ${d}`),
    '---',
    '',
    '## Instructions',
    '',
    ...Array.from({ length: 10 }, (_, i) => `${i + 1}. Instruction step ${i + 1} with enough words to pass validation requirements consistently.`).join('\n'),
  ].join('\n');
  writeFileSync(resolve(fixtureDir, 'SKILL.md'), content, 'utf-8');
  return {
    name,
    description: desc,
    keywords: kws,
    domains: doms,
    sourcePath: resolve(fixtureDir, 'SKILL.md'),
    content: 'parsed content',
    ...extra,
  };
}

// ── 1. Valid candidates are imported ───────────────────────────────────────────

console.log('\n=== 1. Valid Candidates Imported ===');

cleanTmp();
const target1 = resolve(TMP, 'import-target-1');

const validCandOne = buildCandidate('testing-import-valid-one',
  'A comprehensive guide to writing effective unit tests for JavaScript applications covering mocking strategies.',
  ['unit', 'testing', 'javascript', 'mocking', 'coverage'],
  ['testing']);

const validCandTwo = buildCandidate('testing-import-valid-two',
  'Best practices for integration testing web applications with Playwright and modern frontend frameworks.',
  ['integration', 'playwright', 'e2e', 'testing', 'web'],
  ['testing', 'frontend']);

const result1 = importSkills([validCandOne, validCandTwo], { skillsDir: target1, force: true });

assertEqual(result1.imported, 2, 'imports both valid candidates');
assertEqual(result1.rejected, 0, 'rejects none');
assertEqual(result1.skipped, 0, 'skips none');
assertEqual(result1.total, 2, 'total matches candidate count');

for (const item of result1.items.filter((i) => i.status === 'imported')) {
  assertTrue(existsSync(item.targetPath), `${item.name} target file exists`);
}

// ── 2. Invalid candidates are rejected ─────────────────────────────────────────

console.log('\n=== 2. Invalid Candidates Rejected ===');

cleanTmp();
const target2 = resolve(TMP, 'import-target-2');

const missingNameCand = buildCandidate('testing-missing-name',
  'A well-written skill with a short description.',
  ['test'],
  ['testing']);
// Overwrite to remove name
writeFileSync(missingNameCand.sourcePath, [
  '---',
  'description: A well-written skill with a short description.',
  'keywords:',
  '  - test',
  'domains:',
  '  - testing',
  '---',
  '',
    ...Array.from({ length: 10 }, (_, i) => `${i + 1}. Step ${i + 1}.`).join('\n'),
].join('\n'), 'utf-8');
missingNameCand.name = 'unknown'; // scanner would have set this

const shortDescCand = buildCandidate('testing-short-desc',
  'Short.',
  ['a', 'b', 'c'],
  ['testing']);

const result2 = importSkills([missingNameCand, shortDescCand], { skillsDir: target2, force: true });

assertEqual(result2.imported, 0, 'imports nothing');
assertEqual(result2.rejected, 2, 'rejects both invalid candidates');
assertTrue(result2.items.every((i) => i.status === 'rejected'), 'all items are rejected');

const missingNameIssue = result2.items[0].issues?.some((iss) => iss.field === 'name');
assertTrue(!!missingNameIssue, 'missing name flagged in issues');

// ── 3. Duplicates are skipped without --force ──────────────────────────────────

console.log('\n=== 3. Duplicates Skipped Without --force ===');

cleanTmp();
const target3 = resolve(TMP, 'import-target-3');

const dupCand = buildCandidate('testing-dup-skill',
  'A duplicate skill for testing collision detection logic.',
  ['duplicate', 'test', 'collision', 'detection'],
  ['testing']);

// Import once
const firstImport = importSkills([dupCand], { skillsDir: target3 });
assertEqual(firstImport.imported, 1, 'first import succeeds');
assertEqual(firstImport.skipped, 0, 'first import skips none');

// Import again without --force
const secondImport = importSkills([dupCand], { skillsDir: target3 });
assertEqual(secondImport.imported, 0, 'second import imports nothing');
assertEqual(secondImport.skipped, 1, 'second import skips the duplicate');

// ── 4. Duplicates overwritten with --force ─────────────────────────────────────

console.log('\n=== 4. Duplicates Overwritten With --force ===');

const thirdImport = importSkills([dupCand], { skillsDir: target3, force: true });
assertEqual(thirdImport.imported, 1, 'force import overwrites existing');
assertEqual(thirdImport.skipped, 0, 'force import skips none');

// ── 5. Path traversal blocked ──────────────────────────────────────────────────

console.log('\n=== 5. Path Traversal Blocked ===');

cleanTmp();
const target5 = resolve(TMP, 'import-target-5');

// Create a candidate with path traversal in sourcePath
const maliciousCand = {
  name: 'testing-malicious',
  description: 'A malicious skill with path traversal.',
  keywords: ['malicious', 'test', 'security'],
  domains: ['testing'],
  sourcePath: '..\\..\\windows\\system32\\SKILL.md',
  content: 'malicious content',
};

const result5 = importSkills([maliciousCand], { skillsDir: target5, force: true });
assertEqual(result5.imported, 0, 'imports nothing with traversal');
assertEqual(result5.rejected, 1, 'rejects the malicious candidate');
assert(result5.items[0].issues?.some((i) => i.field === 'path'), 'path traversal flagged');

// ── 6. Missing source file rejected ────────────────────────────────────────────

console.log('\n=== 6. Missing Source File Rejected ===');

cleanTmp();
const target6 = resolve(TMP, 'import-target-6');

const missingSourceCand = {
  name: 'testing-missing-source',
  description: 'A skill whose source file does not exist.',
  keywords: ['missing', 'source', 'test'],
  domains: ['testing'],
  sourcePath: '/nonexistent/path/SKILL.md',
  content: 'no content',
};

const result6 = importSkills([missingSourceCand], { skillsDir: target6, force: true });
assertEqual(result6.imported, 0, 'imports nothing');
assertEqual(result6.rejected, 1, 'rejects missing source');
assert(result6.items[0].issues?.some((i) => i.field === 'file'), 'file error flagged');

// ── 7. Empty candidate list ────────────────────────────────────────────────────

console.log('\n=== 7. Empty Candidate List ===');

cleanTmp();
const target7 = resolve(TMP, 'import-target-7');

const result7 = importSkills([], { skillsDir: target7 });
assertEqual(result7.total, 0, 'total is 0');
assertEqual(result7.imported, 0, 'imported is 0');
assertEqual(result7.rejected, 0, 'rejected is 0');
assertEqual(result7.skipped, 0, 'skipped is 0');
assertEqual(result7.items.length, 0, 'items array is empty');

// ── 8. Reporter output ─────────────────────────────────────────────────────────

console.log('\n=== 8. Reporter Output ===');

const mockResult = {
  items: [
    { name: 'skill-a', status: 'imported', targetPath: '/target/skill-a/SKILL.md', score: 100, sourcePath: '/src/skill-a/SKILL.md' },
    { name: 'skill-b', status: 'rejected', issues: [{ field: 'name', message: 'bad name' }], sourcePath: '/src/skill-b/SKILL.md' },
    { name: 'skill-c', status: 'skipped', targetPath: '/target/skill-c/SKILL.md' },
  ],
  total: 3,
  imported: 1,
  rejected: 1,
  skipped: 1,
};

const mdReport = reportImport(mockResult);
assert(mdReport.includes('# Skill Import Report'), 'markdown has title');
assert(mdReport.includes('Imported:** 1'), 'markdown shows imported count');
assert(mdReport.includes('Rejected:** 1'), 'markdown shows rejected count');
assert(mdReport.includes('Skipped:** 1'), 'markdown shows skipped count');
assert(mdReport.includes('skill-a'), 'markdown includes imported skill');
assert(mdReport.includes('skill-b'), 'markdown includes rejected skill');
assert(mdReport.includes('skill-c'), 'markdown includes skipped skill');
assert(mdReport.includes('[name] bad name'), 'markdown shows rejection reason');

const plainReport = formatConsoleReport(mockResult);
assert(plainReport.includes('SKILL IMPORT REPORT'), 'console has header');
assert(plainReport.includes('✓ skill-a'), 'console shows imported checkmark');
assert(plainReport.includes('✗ skill-b'), 'console shows rejected cross');
assert(plainReport.includes('skill-c'), 'console includes skipped skill');

// ── 9. End-to-end with real fixtures ───────────────────────────────────────────

console.log('\n=== 9. End-to-End With Real Fixtures ===');

cleanTmp();
const target9 = resolve(TMP, 'import-target-9');

// Scan the real fixtures
const realCandidates = await scanSource(FIXTURES);
assertTrue(realCandidates.length >= 3, 'scans at least 3 real fixtures');

const realResult = importSkills(realCandidates, { skillsDir: target9, force: true });
assert(realResult.imported >= 1, 'imports at least one real candidate');
assert(realResult.total === realCandidates.length, 'total matches scan count');

// Verify at least one file was actually written
const importedPaths = realResult.items
  .filter((i) => i.status === 'imported')
  .map((i) => i.targetPath);
assert(importedPaths.length > 0, 'at least one target file exists');
for (const p of importedPaths) {
  assert(existsSync(p), `imported file exists: ${p}`);
}

// ── Cleanup ────────────────────────────────────────────────────────────────────

cleanTmp();

// ── Summary ────────────────────────────────────────────────────────────────────

console.log('\n=== Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
