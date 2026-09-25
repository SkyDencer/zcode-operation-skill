/**
 * Embedding provider abstraction tests.
 *
 * Verifies:
 *  - createProvider('fnv1a') returns a working Fnv1aProvider
 *  - Fnv1aProvider produces identical embeddings to the legacy engine
 *  - Fnv1aProvider dimensions match the configured default (256)
 *  - Unknown provider type throws UnknownProviderError
 *  - OnnxProvider throws ProviderNotAvailableError on embed() and buildIndex()
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createProvider } from '../../src/core/embeddings/provider.mjs';
import { ProviderNotAvailableError, UnknownProviderError } from '../../src/core/embeddings/errors.mjs';
import { Fnv1aProvider } from '../../src/core/embeddings/providers/fnv1a.mjs';
import { OnnxProvider } from '../../src/core/embeddings/providers/onnx.mjs';
import { embed as legacyEmbed, buildEmbeddingIndex as legacyBuildIndex } from '../../src/core/embeddings/engine.mjs';

const INDEX_PATH = resolve('data/skill-index.json');
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

// ─── Test suite ──────────────────────────────────────────────────────────────

console.log('\n=== Provider Abstraction Tests ===\n');

// 1. createProvider returns Fnv1aProvider for 'fnv1a'
console.log('1. createProvider(fnv1a)');
const fnv1a = createProvider('fnv1a');
assert(fnv1a instanceof Fnv1aProvider, 'creates Fnv1aProvider');
assert(fnv1a.name === 'fnv1a', 'provider name is "fnv1a"');
assert(fnv1a.dimensions === 256, 'dimensions is 256');
assert(fnv1a.isAvailable() === true, 'isAvailable() is true');

// 2. Fnv1aProvider embed output matches legacy engine exactly
console.log('\n2. Fnv1aProvider embed matches legacy engine');
const testText = 'react hooks for state management';
const providerVec = fnv1a.embed(testText);
const legacyVec = legacyEmbed(testText);
assert(providerVec instanceof Float32Array, 'returns Float32Array');
assert(providerVec.length === legacyVec.length, 'same length as legacy');
for (let i = 0; i < providerVec.length; i++) {
  if (Math.abs(providerVec[i] - legacyVec[i]) > 1e-10) {
    assert(false, `vector[${i}] matches legacy (${providerVec[i]} vs ${legacyVec[i]})`);
    break;
  }
  if (i === providerVec.length - 1) {
    assert(true, 'all dimensions match legacy engine output exactly');
  }
}

// 3. Fnv1aProvider buildIndex matches legacy engine
console.log('\n3. Fnv1aProvider buildIndex matches legacy engine');
const providerIndex = fnv1a.buildIndex(index);
const legacyIndex = legacyBuildIndex(index);
assert(providerIndex instanceof Map, 'returns a Map');
assert(providerIndex.size === legacyIndex.size, `same size: ${providerIndex.size}`);
let allMatch = true;
for (const name of providerIndex.keys()) {
  const pv = providerIndex.get(name);
  const lv = legacyIndex.get(name);
  if (!pv || !lv || pv.length !== lv.length) {
    allMatch = false;
    break;
  }
  for (let i = 0; i < pv.length; i++) {
    if (Math.abs(pv[i] - lv[i]) > 1e-10) {
      allMatch = false;
      break;
    }
  }
  if (!allMatch) break;
}
assert(allMatch, 'all skill embeddings match legacy engine');

// 4. Unknown provider type throws UnknownProviderError
console.log('\n4. Unknown provider type throws');
let threwUnknown = false;
try {
  createProvider('nonexistent');
} catch (err) {
  threwUnknown = err instanceof UnknownProviderError;
  assert(threwUnknown, `threw UnknownProviderError (got ${err?.name ?? 'none'})`);
}
assert(threwUnknown, 'throws UnknownProviderError for unknown type');

// 5. OnnxProvider is not available and throws on embed
console.log('\n5. OnnxProvider stub throws');
const onnx = new OnnxProvider();
assert(onnx.name === 'onnx', 'name is "onnx"');
assert(onnx.isAvailable() === false, 'isAvailable() is false');
let onnxEmbedThrows = false;
try {
  onnx.embed('test');
} catch (err) {
  onnxEmbedThrows = err instanceof ProviderNotAvailableError;
}
assert(onnxEmbedThrows, 'embed() throws ProviderNotAvailableError');
let onnxBuildThrows = false;
try {
  onnx.buildIndex(index);
} catch (err) {
  onnxBuildThrows = err instanceof ProviderNotAvailableError;
}
assert(onnxBuildThrows, 'buildIndex() throws ProviderNotAvailableError');

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
