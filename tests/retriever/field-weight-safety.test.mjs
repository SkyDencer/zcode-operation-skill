/**
 * Regression tests — Sub-Phase 6.4 static audit (Critical: fractional BM25 weights).
 *
 * Context: src/core/retriever/bm25.mjs and src/core/routing/detector.mjs build each
 * document's token array by repeating a field's tokens `weight` times. Before the
 * 6.4 fix they passed the configured weight straight into `Array(n * weight)` and
 * `String.repeat(weight)`, so any fractional weight — which data/weights.json and
 * src/core/retriever/weights.mjs both produce — raised
 *   RangeError: Invalid array length
 * and took the whole ranking down.
 *
 * Verified pre-fix (Sub-Phase 6.4 audit):
 *   data/weights.json = {"name":2.71,"description":2.71,"keywords":0.57}
 *     rankSkills('eloquent relationship', index) -> THREW RangeError: Invalid array length
 *
 * This file covers:
 *   - resolveFieldWeight() normalisation rules
 *   - buildWeightedDocTokens() output shape under hostile weights
 *   - rankSkills() end-to-end in a child process whose data/weights.json is fractional
 *   - detectDomains() under the same fractional weights
 */
import { resolveFieldWeight } from '../../src/scorer.mjs';
import { buildWeightedDocTokens, rankSkills } from '../../src/core/retriever/bm25.mjs';
import { detectDomains } from '../../src/core/routing/detector.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log('  ✓', message);
  } else {
    failed++;
    console.error('  ✗', message);
  }
}

console.log('\n=== Field Weight Safety Tests ===\n');

// 1. resolveFieldWeight normalisation
console.log('1. resolveFieldWeight()');
assert(resolveFieldWeight(3) === 3, 'integer weight 3 stays 3');
assert(resolveFieldWeight(2.71) === 3, 'fractional 2.71 rounds to 3');
assert(resolveFieldWeight(0.57) === 1, 'fractional 0.57 clamps to 1 (never below 1)');
assert(resolveFieldWeight(0) === 1, 'zero weight clamps to 1');
assert(resolveFieldWeight(-2) === 1, 'negative weight clamps to 1');
assert(resolveFieldWeight(NaN) === 1, 'NaN falls back to 1');
assert(resolveFieldWeight(undefined) === 1, 'undefined falls back to 1');
assert(resolveFieldWeight('2') === 2, 'numeric string coerces');

// 2. buildWeightedDocTokens under hostile weights
console.log('\n2. buildWeightedDocTokens() with fractional weights');
const skill = {
  name: 'backend-eloquent',
  description: 'Eloquent ORM relationships and eager loading',
  keywords: ['hydration'],
};

const hostile = {
  nameWeight: 2.71,
  descriptionWeight: 2.71,
  keywordWeight: 0.57,
};
let tokens;
try {
  tokens = buildWeightedDocTokens(skill, hostile);
  assert(Array.isArray(tokens) && tokens.length > 0, 'fractional weights build a token array (no RangeError)');
} catch (err) {
  assert(false, `fractional weights build a token array (threw ${err.constructor.name}: ${err.message})`);
}
// Multiplicity formula (unchanged by the 6.4 fix, pinned here so the
// normalisation cannot silently change relative field weighting):
//   name field        -> nameTokens.length * nameReps occurrences per token
//   description field -> descTokens.length * descReps occurrences per token
//   keyword field     -> keywordReps occurrences per token
// 'backend-eloquent' = 2 name tokens, description = 5 tokens, 'hydration' is keyword-only.
assert(
  tokens.filter((t) => t === 'backend').length === 2 * 3,
  'name-only token repeats 2 (name tokens) x 3 (round(2.71)) times'
);
assert(
  tokens.filter((t) => t === 'loading').length === 5 * 3,
  'description-only token repeats 5 (desc tokens) x 3 (round(2.71)) times'
);
assert(
  tokens.filter((t) => t === 'hydration').length === 1,
  'keyword-only token repeats max(1, round(0.57))=1x'
);

const negative = buildWeightedDocTokens(skill, { nameWeight: -5, descriptionWeight: 0, keywordWeight: -1 });
assert(negative.length > 0, 'negative / zero weights do not throw and still produce tokens');

const missing = buildWeightedDocTokens({ name: 'x', description: 'y' }, {});
assert(Array.isArray(missing), 'missing keywords array is handled');

// 3. rankSkills end-to-end with a fractional data/weights.json
console.log('\n3. rankSkills() with fractional data/weights.json (child process)');
const workDir = mkdtempSync(join(tmpdir(), 'skill-router-weights-'));
mkdirSync(join(workDir, 'data'), { recursive: true });
writeFileSync(
  join(workDir, 'data', 'weights.json'),
  JSON.stringify({ name: 2.71, description: 2.71, keywords: 0.57 }),
  'utf-8'
);

const bm25Path = resolve('src/core/retriever/bm25.mjs').replace(/\\/g, '/');
const detectorPath = resolve('src/core/routing/detector.mjs').replace(/\\/g, '/');
const childScript = `
  const url = (p) => 'file:///' + p;
  const { rankSkills } = await import(url('${bm25Path}'));
  const { detectDomains } = await import(url('${detectorPath}'));
  const index = [
    { name: 'backend-eloquent', description: 'Eloquent ORM relationships and eager loading', keywords: ['eloquent', 'orm'], domains: ['backend'] },
    { name: 'design-color-theory', description: 'Colour theory and contrast rules', keywords: ['color', 'contrast'], domains: ['design'] },
  ];
  const ranked = rankSkills('eloquent relationship', index);
  const domains = detectDomains('eloquent relationship', index);
  console.log(JSON.stringify({
    top: ranked[0].skill.name,
    n: ranked.length,
    domain: domains[0] ? domains[0].domain : null,
  }));
`;

try {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', childScript], {
    cwd: workDir,
    encoding: 'utf-8',
  });
  const result = JSON.parse(out.trim());
  assert(result.n === 2, 'rankSkills ranks every document under fractional weights');
  assert(result.top === 'backend-eloquent', 'rankSkills still picks the matching skill');
  assert(result.domain === 'backend', 'detectDomains still resolves the right domain');
} catch (err) {
  assert(false, `child process ranks without RangeError (${err.message.split('\n')[0]})`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

// 4. Current repository weights still rank correctly (no regression)
console.log('\n4. rankSkills() with the committed data/weights.json');
const index = [
  { name: 'backend-eloquent', description: 'Eloquent ORM relationships and eager loading', keywords: ['eloquent', 'orm'], domains: ['backend'] },
  { name: 'design-color-theory', description: 'Colour theory and contrast rules', keywords: ['color', 'contrast'], domains: ['design'] },
];
const ranked = rankSkills('contrast ratio for accessible palette', index);
assert(ranked[0].skill.name === 'design-color-theory', 'colour query ranks the colour skill first');
assert(ranked.every((r) => Number.isFinite(r.score)), 'all scores are finite numbers');

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) process.exit(1);
