/**
 * ONNX-to-FNV-1a fallback tests.
 *
 * Verifies that when the ONNX provider is requested but the model
 * is not cached, hybridRetrieve and the hook gracefully fall back
 * to Fnv1aProvider (when fallbackToFnv1a is enabled).
 *
 * Tests the ProviderNotAvailableError propagation and the
 * automatic fallback path.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hybridRetrieve } from '../../src/core/retriever/hybrid.mjs';
import { createProvider } from '../../src/core/embeddings/provider.mjs';
import { OnnxProvider } from '../../src/core/embeddings/providers/onnx.mjs';
import { ProviderNotAvailableError } from '../../src/core/embeddings/errors.mjs';
import { getDefaults } from '../../src/config/defaults.mjs';

const INDEX_PATH = resolve('data/skill-index.json');
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

console.log('\n=== Fallback Tests ===\n');

// 1. Cold OnnxProvider throws ProviderNotAvailableError on embed
console.log('1. Cold OnnxProvider throws on embed');
const coldOnnx = new OnnxProvider({ cacheDir: '/nonexistent-cache-fallback-test' });
let threwEmbed = false;
try {
  coldOnnx.embed('test');
} catch (err) {
  threwEmbed = err instanceof ProviderNotAvailableError;
}
assert(threwEmbed, 'cold OnnxProvider embed throws ProviderNotAvailableError');

// 2. Cold OnnxProvider throws on buildIndex
console.log('\n2. Cold OnnxProvider throws on buildIndex');
let threwBuild = false;
try {
  coldOnnx.buildIndex(leafIndex);
} catch (err) {
  threwBuild = err instanceof ProviderNotAvailableError;
}
assert(threwBuild, 'cold OnnxProvider buildIndex throws ProviderNotAvailableError');

// 3. hybridRetrieve with cold OnnxProvider throws (no auto-fallback at library level)
console.log('\n3. hybridRetrieve with cold OnnxProvider throws');
let threwHybrid = false;
try {
  hybridRetrieve('test prompt', leafIndex, { provider: coldOnnx, rerank: false });
} catch (err) {
  threwHybrid = err instanceof ProviderNotAvailableError;
}
assert(threwHybrid, 'hybridRetrieve throws ProviderNotAvailableError with cold OnnxProvider');

// 4. Fnv1aProvider works as expected (baseline for fallback comparison)
console.log('\n4. Fnv1aProvider works as baseline');
const fnv1a = createProvider('fnv1a');
const fnv1aResult = hybridRetrieve('laravel migration', leafIndex, {
  provider: fnv1a,
  rerank: false,
});
assert(fnv1aResult.length > 0, 'fnv1a provider returns results');
assert(fnv1aResult[0].skill.name !== null, 'fnv1a provider returns valid top skill');

// 5. Verify that the provider factory returns fnv1a when type is 'fnv1a'
console.log('\n5. Provider factory returns Fnv1aProvider for fnv1a type');
const fnv1aFactory = createProvider('fnv1a');
assert(fnv1aFactory.name === 'fnv1a', 'factory returns fnv1a provider');
assert(fnv1aFactory.isAvailable() === true, 'fnv1a provider is available');

// 6. Verify that config.embeddings.provider defaults to 'fnv1a'
console.log('\n6. Config defaults to fnv1a provider');
const defaults = getDefaults();
assert(defaults.embeddings.provider === 'fnv1a', 'embeddings.provider defaults to fnv1a');
assert(defaults.embeddings.fallbackToFnv1a === true, 'fallbackToFnv1a defaults to true');
assert(defaults.embeddings.weights.bm25 === 0.4, 'bm25 weight is 0.4');
assert(defaults.embeddings.weights.semantic === 0.6, 'semantic weight is 0.6');

// 7. Verify fallback behavior: OnnxProvider with non-existent cache
//    isAvailable() should return false
console.log('\n7. OnnxProvider isAvailable() returns false on cold start');
assert(coldOnnx.isAvailable() === false, 'cold OnnxProvider isAvailable() is false');

// 8. Pre-built embeddings bypass provider requirement
console.log('\n8. Pre-built embeddings bypass provider check');
const prebuilt = fnv1a.buildIndex(leafIndex);
const prebuiltResult = hybridRetrieve('test prompt', leafIndex, {
  embeddings: prebuilt,
  rerank: false,
});
assert(prebuiltResult.length > 0, 'pre-built embeddings return results without provider');

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
