/**
 * Shipped RRF weight tests (Sub-Phase 6.9 review fix, blocking finding B2).
 *
 * The shipped default was bm25=0.4 / semantic=0.6, chosen on the assumption
 * that "embeddings are more reliable with the real model". Measured on the
 * 130-prompt real-corpus benchmark, that assumption is false: the semantic
 * channel is a net negative for Top-1 at every weight and with both
 * providers (full table in src/config/defaults.mjs). Shipping 0.4/0.6 meant
 * the default production routing path scored 0.4846 against a 0.9231 BM25
 * baseline.
 *
 * The fix ships bm25=1.0 / semantic=0.0 and keeps the semantic channel
 * reachable through environment variables, so the weights are configurable
 * at runtime rather than only by editing source (review finding N12).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hybridRetrieve } from '../../src/core/retriever/hybrid.mjs';
import { createProvider } from '../../src/core/embeddings/provider.mjs';
import { getDefaults } from '../../src/config/defaults.mjs';

const index = JSON.parse(readFileSync(resolve('data/skill-index.json'), 'utf-8'));
const leafIndex = index.filter((s) => !s.name.startsWith('router-'));
const QUERY = 'how do I write a laravel database migration';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.error(`  ✗ ${message}`); }
}

console.log('\n=== Shipped RRF weight tests ===\n');

const weights = getDefaults().embeddings.weights;

// 1. The shipped default.
console.log('1. Shipped default weights');
assert(weights.bm25 === 1.0, `bm25 weight is 1.0 (got ${weights.bm25})`);
assert(weights.semantic === 0.0, `semantic weight is 0.0 (got ${weights.semantic})`);
assert(
  Math.abs(weights.bm25 + weights.semantic - 1.0) < 1e-12,
  'the weights still form a convex combination (sum to 1.0)'
);

// 2. With no semantic weight the provider is never touched. This is what
//    keeps the default routing path synchronous and free of a model load.
console.log('\n2. Semantic weight 0 skips the provider entirely');
let touched = 0;
const spy = {
  name: 'spy',
  dimensions: 256,
  isAvailable: () => true,
  embed() { touched++; return new Float32Array(256); },
  buildIndex() { touched++; return new Map(); },
};
const withoutProvider = hybridRetrieve(QUERY, leafIndex, { provider: spy, rerank: false });
assert(touched === 0, 'embed()/buildIndex() were never called');
assert(withoutProvider.length > 0, 'and the prompt still routes');
assert(withoutProvider.every((r) => r.semanticRrf === 0), 'every semantic RRF term is 0');
assert(withoutProvider.every((r) => Math.abs(r.bm25Rrf - r.score) < 1e-12), 'score == bm25Rrf');

// 3. A non-zero semantic weight does use the provider.
console.log('\n3. A non-zero semantic weight uses the provider');
touched = 0;
const withProvider = hybridRetrieve(QUERY, leafIndex, {
  provider: spy,
  rerank: false,
  _weightBm25: 0.5,
  _weightSemantic: 0.5,
});
assert(touched > 0, 'embed()/buildIndex() were called');
assert(withProvider.some((r) => r.semanticRrf > 0), 'semantic RRF terms are non-zero');

// 4. The weights are configurable at runtime through the environment, not
//    only by editing source (review finding N12).
console.log('\n4. Environment overrides');
const defaultsSource = readFileSync(resolve('src/config/defaults.mjs'), 'utf-8');
const envSource = readFileSync(resolve('src/config/env.mjs'), 'utf-8');
assert(
  defaultsSource.includes("override('embeddings.weights.bm25', 'SKILL_ROUTER_RRF_BM25_WEIGHT')"),
  'mergeWithEnv maps SKILL_ROUTER_RRF_BM25_WEIGHT'
);
assert(
  defaultsSource.includes("override('embeddings.weights.semantic', 'SKILL_ROUTER_RRF_SEMANTIC_WEIGHT')"),
  'mergeWithEnv maps SKILL_ROUTER_RRF_SEMANTIC_WEIGHT'
);
assert(envSource.includes("SKILL_ROUTER_RRF_BM25_WEIGHT: ['embeddings', 'weights', 'bm25']"), 'env.mjs routes the BM25 weight');
assert(envSource.includes("SKILL_ROUTER_RRF_SEMANTIC_WEIGHT: ['embeddings', 'weights', 'semantic']"), 'env.mjs routes the semantic weight');
assert(/getConfig\(\)/.test(readFileSync(resolve('src/core/retriever/hybrid.mjs'), 'utf-8')), 'hybrid.mjs reads getConfig(), not getDefaults()');

const overridden = await import('../../src/config/env.mjs');
{
  process.env.SKILL_ROUTER_RRF_SEMANTIC_WEIGHT = '0.25';
  process.env.SKILL_ROUTER_RRF_BM25_WEIGHT = '0.75';
  const cfg = overridden.mergeEnvOverrides(getDefaults());
  assert(cfg.embeddings.weights.semantic === 0.25, 'the semantic weight override lands in config');
  assert(cfg.embeddings.weights.bm25 === 0.75, 'the BM25 weight override lands in config');
  delete process.env.SKILL_ROUTER_RRF_SEMANTIC_WEIGHT;
  delete process.env.SKILL_ROUTER_RRF_BM25_WEIGHT;
}

// 5. The measurement that justifies the default is recorded where a reader
//    of the config will actually see it.
console.log('\n5. The decision is documented in the config');
assert(/MEASURED, not assumed/.test(defaultsSource), 'defaults.mjs states the weights are measured');
assert(/0\.4 \/ 0\.6/.test(defaultsSource), 'and records the old 0.4/0.6 numbers for comparison');

// 6. The provider is still reachable when the operator asks for it.
console.log('\n6. The semantic channel is still available on request');
const explicit = hybridRetrieve(QUERY, leafIndex, {
  provider: createProvider('fnv1a'),
  rerank: false,
  _weightBm25: 0.4,
  _weightSemantic: 0.6,
});
assert(explicit.some((r) => r.embeddingScore > 0), 'embedding similarity is populated when a weight is set');
assert(createProvider('fnv1a').name === 'fnv1a', 'the provider factory is unaffected');

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);
if (failed > 0) process.exit(1);
