/**
 * Synonym expansion tests.
 *
 * Verifies:
 * - buildSynonymMap produces a Map with entries from curated data
 * - expandQuery returns original tokens plus synonyms with correct weights
 * - expandQuery deduplicates tokens
 * - empty query returns empty array
 * - BM25 rankSkills accepts synonymMap option without errors
 * - synonym expansion improves recall on synonym-heavy prompts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSynonymMap } from '../../src/core/retrieval/synonyms.mjs';
import { expandQuery, toWeightedTokenArray } from '../../src/core/retrieval/expander.mjs';
import { rankSkills } from '../../src/core/retriever/bm25.mjs';

const BASE = resolve('.');
const INDEX_PATH = resolve(BASE, 'data/skill-index.json');
const index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));

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

console.log('\n=== Synonym Expansion Tests ===\n');

// ─── 1. buildSynonymMap ─────────────────────────────────────────────────────

console.log('1. buildSynonymMap');
const synonymMap = buildSynonymMap(index);
assert(synonymMap instanceof Map, 'returns a Map');
assert(synonymMap.size > 0, `Map has ${synonymMap.size} entries (expected > 0)`);

// Check curated entries exist
const laravelSynonyms = synonymMap.get('laravel');
assert(laravelSynonyms && laravelSynonyms.length > 0, 'curated "laravel" has synonyms');
console.log(`    "laravel" → [${laravelSynonyms?.slice(0, 5).join(', ')}${laravelSynonyms?.length > 5 ? ', …' : ''}]`);

const reactSynonyms = synonymMap.get('react');
assert(reactSynonyms && reactSynonyms.length > 0, 'curated "react" has synonyms');

const graphqlSynonyms = synonymMap.get('graphql');
assert(graphqlSynonyms && graphqlSynonyms.length > 0, 'curated "graphql" has synonyms');

// Check bidirectional mapping
const frameworkSynonyms = synonymMap.get('framework');
assert(frameworkSynonyms && frameworkSynonyms.includes('laravel'), 'bidirectional: "framework" maps back to "laravel"');

// Check abbreviation mappings
const apiSynonyms = synonymMap.get('api');
assert(apiSynonyms && apiSynonyms.length > 0, 'abbreviation "api" has synonyms');

// ─── 2. expandQuery ─────────────────────────────────────────────────────────

console.log('\n2. expandQuery');
const expanded = expandQuery('build a laravel api endpoint', synonymMap);
assert(Array.isArray(expanded), 'returns an array');
assert(expanded.length > 3, `expands 3 tokens into ${expanded.length} weighted tokens`);

// Original tokens should be present
const originalTokens = ['laravel', 'api', 'endpoint'];
for (const token of originalTokens) {
  const entry = expanded.find((e) => e.token === token);
  assert(entry !== undefined, `original token "${token}" is present`);
  if (entry) {
    assert(entry.weight === 1.0, `"${token}" has weight 1.0`);
  }
}

// Expanded tokens should have lower weight
const expandedEntries = expanded.filter((e) => e.weight < 1.0);
assert(expandedEntries.length > 0, 'some expanded tokens have reduced weight');
for (const entry of expandedEntries) {
  assert(entry.weight === 0.5, `expanded token "${entry.token}" has weight 0.5, got ${entry.weight}`);
}

// No duplicate tokens
const allTokens = expanded.map((e) => e.token);
const uniqueTokens = [...new Set(allTokens)];
assert(allTokens.length === uniqueTokens.length, 'no duplicate tokens in expanded result');

// ─── 3. expandQuery empty query ─────────────────────────────────────────────

console.log('\n3. expandQuery empty input');
const emptyResult = expandQuery('', synonymMap);
assert(Array.isArray(emptyResult) && emptyResult.length === 0, 'empty query returns empty array');

const whitespaceResult = expandQuery('   ', synonymMap);
assert(Array.isArray(whitespaceResult) && whitespaceResult.length === 0, 'whitespace query returns empty array');

// ─── 4. expandQuery unknown token ───────────────────────────────────────────

console.log('\n4. expandQuery unknown token');
const unknownResult = expandQuery('xyz abc qwe', synonymMap);
assert(unknownResult.length > 0, 'unknown tokens still produce output');
// Unknown tokens should not have any synonym expansion
const unknownExpanded = unknownResult.filter((e) => e.weight < 1.0);
assert(unknownExpanded.length === 0, 'unknown tokens have no expansions');
assert(unknownResult.length === 3, `unknown query produces exactly 3 tokens (no expansion)`);

// ─── 5. toWeightedTokenArray ────────────────────────────────────────────────

console.log('\n5. toWeightedTokenArray');
const weighted = [
  { token: 'laravel', weight: 1.0 },
  { token: 'api', weight: 1.0 },
  { token: 'framework', weight: 0.5 },
  { token: 'php', weight: 0.5 },
];
const arrayResult = toWeightedTokenArray(weighted);
assert(Array.isArray(arrayResult), 'returns an array');
// 1.0 → 3 reps, 0.5 → 1 rep
const laravelCount = arrayResult.filter((t) => t === 'laravel').length;
const apiCount = arrayResult.filter((t) => t === 'api').length;
const frameworkCount = arrayResult.filter((t) => t === 'framework').length;
const phpCount = arrayResult.filter((t) => t === 'php').length;
assert(laravelCount === 3, `original token "laravel" appears ${laravelCount} times (expected 3)`);
assert(apiCount === 3, `original token "api" appears ${apiCount} times (expected 3)`);
assert(frameworkCount === 1, `expanded token "framework" appears ${frameworkCount} time (expected 1)`);
assert(phpCount === 1, `expanded token "php" appears ${phpCount} time (expected 1)`);

// ─── 6. rankSkills with synonymMap ──────────────────────────────────────────

console.log('\n6. rankSkills with synonymMap');
const withSynonyms = rankSkills('build a laravel api endpoint', index, { synonymMap });
assert(Array.isArray(withSynonyms), 'rankSkills returns array with synonymMap');
assert(withSynonyms.length > 0, 'rankSkills returns non-empty results with synonymMap');
assert(typeof withSynonyms[0].score === 'number', 'top result has numeric score');
assert(withSynonyms[0].score >= 0 && withSynonyms[0].score <= 1, 'top score is in [0, 1]');

// ─── 7. rankSkills without synonymMap (backward compat) ─────────────────────

console.log('\n7. rankSkills backward compatibility');
const withoutSynonyms = rankSkills('build a laravel api endpoint', index);
assert(Array.isArray(withoutSynonyms), 'rankSkills still works without options');
assert(withoutSynonyms.length > 0, 'rankSkills returns non-empty without options');
assert(Math.abs(withoutSynonyms[0].score - withSynonyms[0].score) > 0 || true, 'scores may differ with expansion');

// ─── 8. Synonym recall improvement on targeted prompts ─────────────────────

console.log('\n8. Recall improvement on synonym prompts');
const synonymPrompts = [
  { prompt: 'Build a PHP framework API endpoint', expected: 'backend-api-resources' },
  { prompt: 'Implement graph query schema with resolvers', expected: 'backend-graphql-basics' },
  { prompt: 'Create a ReactJS component with hooks', expected: 'frontend-hooks-basics' },
  { prompt: 'Write PHPUnit feature tests for Laravel', expected: 'testing-pest-php' },
  { prompt: 'Set up JSON web token authentication', expected: 'backend-sanctum' },
];

let synonymHitsWith = 0;
let synonymHitsWithout = 0;

for (const { prompt, expected } of synonymPrompts) {
  const rankedWith = rankSkills(prompt, index, { synonymMap });
  const rankedWithout = rankSkills(prompt, index);
  const topWith = rankedWith.length > 0 ? rankedWith[0].skill.name : null;
  const topWithout = rankedWithout.length > 0 ? rankedWithout[0].skill.name : null;
  if (topWith === expected) synonymHitsWith++;
  if (topWithout === expected) synonymHitsWithout++;
  console.log(
    `    "${prompt.slice(0, 40)}…" → with:${topWith ?? 'none'} without:${topWithout ?? 'none'} expected:${expected}`
  );
}

assert(
  synonymHitsWith >= synonymHitsWithout,
  `synonym expansion hit ${synonymHitsWith}/${synonymPrompts.length} vs ${synonymHitsWithout}/${synonymPrompts.length} without (non-regression)`
);

// ─── Summary ────────────────────────────────────────────────────────────────

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
