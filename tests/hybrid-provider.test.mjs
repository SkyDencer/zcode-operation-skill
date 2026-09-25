/**
 * Hybrid retriever provider integration tests.
 *
 * Verifies that hybridRetrieve works correctly when given a provider
 * instance, and falls back to Fnv1aProvider when none is supplied.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hybridRetrieve } from '../src/core/retriever/hybrid.mjs';
import { createProvider } from '../src/core/embeddings/provider.mjs';
import { ProviderNotAvailableError } from '../src/core/embeddings/errors.mjs';
import { OnnxProvider } from '../src/core/embeddings/providers/onnx.mjs';

const BASE = resolve('.');
const PROMPTS_PATH = resolve(BASE, 'tests/prompts.json');
const EXPECTED_PATH = resolve(BASE, 'tests/expected-routes.json');
const INDEX_PATH = resolve(BASE, 'data/skill-index.json');

const prompts = JSON.parse(readFileSync(PROMPTS_PATH, 'utf-8'));
const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf-8'));
const index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
const leafIndex = index.filter((s) => !s.name.startsWith('router-'));

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

console.log('\n=== Hybrid Provider Integration Tests ===\n');

// 1. Default provider (no options) still works — backward compatibility
console.log('1. Default provider (backward compat)');
const defaultResult = hybridRetrieve(prompts[0].prompt, leafIndex);
assert(Array.isArray(defaultResult), 'returns array');
assert(defaultResult.length > 0, 'returns non-empty results');
assert('skill' in defaultResult[0], 'result has skill field');
assert('score' in defaultResult[0], 'result has score field');
assert('bm25Score' in defaultResult[0], 'result has bm25Score field');
assert('embeddingScore' in defaultResult[0], 'result has embeddingScore field');

// 2. Explicit Fnv1aProvider produces same results as default
console.log('\n2. Explicit Fnv1aProvider');
const fnv1a = createProvider('fnv1a');
const explicitResult = hybridRetrieve(prompts[0].prompt, leafIndex, { provider: fnv1a });
assert(Array.isArray(explicitResult), 'returns array with explicit provider');
assert(explicitResult.length > 0, 'returns non-empty with explicit provider');
assert(
  explicitResult[0].skill.name === defaultResult[0].skill.name,
  'same top result as default provider'
);

// 3. Hybrid with Fnv1aProvider on full corpus
console.log('\n3. Hybrid on full corpus with provider');
const fullResult = hybridRetrieve(prompts[0].prompt, index, { provider: fnv1a });
assert(Array.isArray(fullResult), 'full corpus returns array');
assert(fullResult.length > 0, 'full corpus non-empty');

// 4. OnnxProvider throws ProviderNotAvailableError during retrieval when not available
console.log('\n4. OnnxProvider throws in hybridRetrieve (cold start)');
// Use a cold provider (non-existent cache) to ensure it throws
const coldOnnx = new OnnxProvider({ cacheDir: '/nonexistent-cache-abc123' });
let threwOnnx = false;
try {
  hybridRetrieve(prompts[0].prompt, leafIndex, { provider: coldOnnx });
} catch (err) {
  threwOnnx = err instanceof ProviderNotAvailableError;
}
assert(threwOnnx, 'hybridRetrieve throws ProviderNotAvailableError with unavailable OnnxProvider');

// 5. Pre-built embeddings still work alongside provider
console.log('\n5. Pre-built embeddings with explicit provider');
const prebuilt = fnv1a.buildIndex(leafIndex);
const prebuiltResult = hybridRetrieve(prompts[0].prompt, leafIndex, {
  provider: fnv1a,
  embeddings: prebuilt,
});
assert(Array.isArray(prebuiltResult), 'pre-built embeddings with provider returns array');
assert(prebuiltResult.length > 0, 'pre-built embeddings non-empty');
assert(
  prebuiltResult[0].skill.name === defaultResult[0].skill.name,
  'pre-built embeddings match default result'
);

// 6. Top-1 accuracy unchanged with explicit provider
console.log('\n6. Top-1 accuracy with explicit provider');
let hits = 0;
for (const p of prompts) {
  const result = hybridRetrieve(p.prompt, leafIndex, { provider: fnv1a });
  const topSkill = result.length > 0 ? result[0].skill.name : null;
  const exp = expected.find((e) => e.id === p.id)?.expected;
  if (topSkill === exp) hits++;
}
const accuracy = (hits / prompts.length).toFixed(4);
console.log(`    Hybrid Top-1 (explicit fnv1a): ${hits}/${prompts.length} = ${accuracy}`);
assert(hits >= 72, 'hybrid Top-1 >= 55% (72/130) with explicit provider');

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
