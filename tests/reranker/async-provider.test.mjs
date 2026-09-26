/**
 * Reranker tests with an asynchronous embedding provider (review finding N2).
 *
 * `extractFeatures` computes `embeddingSimilarity` through the provider, and
 * the real `OnnxProvider.embed()` returns a Promise. The reranker used to read
 * the feature object synchronously, so with an async provider every feature
 * read `undefined`, fell through `?? 0`, and produced `featureScore = 0`:
 * a silent no-op reranker that still returned plausible-looking scores
 * (0.99x the unreranked score) and never threw.
 *
 * These tests pin the fixed mixed sync/async contract: `rerank()` returns a
 * Promise when the provider is async, and `hybridRetrieve()` awaits it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rerank } from '../../src/core/reranker/engine.mjs';
import { extractFeatures } from '../../src/core/reranker/features.mjs';
import { hybridRetrieve } from '../../src/core/retriever/hybrid.mjs';

const index = JSON.parse(readFileSync(resolve('data/skill-index.json'), 'utf-8'));
const leafIndex = index.filter((s) => !s.name.startsWith('router-'));

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.error(`  ✗ ${message}`); }
}

/**
 * Build a provider whose embed() is asynchronous, like OnnxProvider.
 *
 * @param {number} dims — vector width
 * @returns {object} provider stub
 */
function asyncProvider(dims = 8) {
  const vec = (text) => {
    const v = new Float32Array(dims);
    for (let i = 0; i < dims; i++) v[i] = ((text.length + i) % 7) / 7;
    let mag = 0;
    for (let i = 0; i < dims; i++) mag += v[i] * v[i];
    mag = Math.sqrt(mag) || 1;
    for (let i = 0; i < dims; i++) v[i] /= mag;
    return v;
  };
  return {
    name: 'async-stub',
    dimensions: dims,
    isAvailable: () => true,
    embed: (text) => Promise.resolve(vec(text)),
    buildIndex: (skills) => Promise.resolve(new Map(skills.map((s) => [s.name, vec(s.description)]))),
  };
}

const CANDIDATES = leafIndex.slice(0, 4).map((s) => ({
  skill: s,
  rrfScore: 0.01,
  bm25Score: 0.5,
  bm25Rrf: 0.006,
  semanticRrf: 0.004,
}));

console.log('\n=== Reranker with an async provider ===\n');

// 1. extractFeatures reports the Promise shape rather than pretending to be sync.
console.log('1. extractFeatures is async-aware');
const feats = extractFeatures('laravel migration', leafIndex[0], { provider: asyncProvider() });
assert(feats instanceof Promise, 'extractFeatures returns a Promise for an async provider');
const resolved = await feats;
assert(typeof resolved.embeddingSimilarity === 'number', 'and it resolves to a feature object');
assert(resolved.embeddingSimilarity > 0, 'with a non-zero embeddingSimilarity');
assert(typeof resolved.titleMatch === 'number', 'the lexical features survive the async path');

// 2. rerank returns a Promise and computes real feature scores.
console.log('\n2. rerank returns a Promise with real feature scores');
const pending = rerank('laravel migration', CANDIDATES, { topK: 4, provider: asyncProvider() });
assert(pending instanceof Promise, 'rerank returns a Promise for an async provider');
const rows = await pending;
assert(rows.length === 4, 'all candidates come back');
assert(rows.every((r) => r.skill && typeof r.skill.name === 'string'), 'each row carries its skill');
assert(rows.every((r) => Number.isFinite(r.rerankScore)), 'each row has a finite score');
assert(rows.every((r) => r.featureScore > 0), 'featureScore is non-zero (it was 0 before the fix)');
assert(
  rows.every((r) => Math.abs(r.rerankScore - (0.99 * 0.01 + 0.01 * r.featureScore)) < 1e-12),
  'the blend is (1 - BLEND) * rrf + BLEND * feature'
);
const sorted = [...rows].sort((a, b) => b.rerankScore - a.rerankScore);
assert(rows.every((r, i) => r.rerankScore === sorted[i].rerankScore), 'rows are sorted descending');
assert(rows.length <= 4, 'truncated to topK');

// 3. A sync provider keeps the synchronous contract.
console.log('\n3. A sync provider keeps the synchronous contract');
const syncRows = rerank('laravel migration', CANDIDATES, { topK: 4 });
assert(Array.isArray(syncRows), 'rerank returns an array when no provider is given');
assert(syncRows.every((r) => typeof r.rerankScore === 'number'), 'with numeric scores');

// 4. hybridRetrieve awaits the async reranker instead of emitting garbage.
console.log('\n4. hybridRetrieve awaits an async reranker');
const hybrid = await hybridRetrieve('laravel migration', leafIndex, {
  provider: asyncProvider(),
  rerank: true,
  _weightBm25: 0.4,
  _weightSemantic: 0.6,
});
assert(Array.isArray(hybrid), 'resolves to an array, not a Promise');
assert(hybrid.length > 0, 'with results');
assert(hybrid.every((r) => r.skill && r.skill.name), 'every entry is a real skill record');
assert(hybrid.every((r) => Number.isFinite(r.score)), 'every entry has a finite score');

// 5. The ordering guard the review asked for: reranking must actually change
//    something when it is on. (N1 — `doRerank` was computed and never used.)
console.log('\n5. rerank:false and the default differ (doRerank is honoured)');
const off = await hybridRetrieve('laravel migration', leafIndex, {
  provider: asyncProvider(),
  rerank: false,
  _weightBm25: 0.4,
  _weightSemantic: 0.6,
});
const on = await hybridRetrieve('laravel migration', leafIndex, {
  provider: asyncProvider(),
  _weightBm25: 0.4,
  _weightSemantic: 0.6,
});
assert(off.length === on.length, 'same result count with and without reranking');
const sameOrder = off.every((r, i) => r.skill.name === on[i].skill.name);
assert(!sameOrder || off.every((r, i) => Math.abs(r.score - on[i].score) > 0), 'the two paths are not identical');
const engineSource = readFileSync(resolve('src/core/reranker/engine.mjs'), 'utf-8');
const hybridSource = readFileSync(resolve('src/core/retriever/hybrid.mjs'), 'utf-8');
assert(hybridSource.includes('if (doRerank && results.length > 1)'), 'hybrid.mjs gates on doRerank, not on options.rerank === true');
assert(/rerank\(prompt, results, \{ topK, provider \}\)/.test(hybridSource), 'the provider is still handed to the reranker');
assert(/features instanceof Promise/.test(engineSource), 'engine.mjs branches on the Promise shape of extractFeatures');

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);
if (failed > 0) process.exit(1);
