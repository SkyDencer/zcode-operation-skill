/**
 * ONNX model-cache probe tests (review finding N4).
 *
 * `isModelCached()` used to answer "is there a `model.onnx` anywhere under the
 * transformers cache?". On a machine that has *some other* model cached but
 * not Xenova/all-MiniLM-L6-v2, that probe passed, and the first real
 * embedding then requested MiniLM over the network — inside a UserPromptSubmit
 * hook, on the branch with no timeout guard. That contradicts the documented
 * contract in src/core/embeddings/resolve.mjs ("a cold ONNX cache costs one
 * directory scan and no network access").
 *
 * The probe is now model-specific: it only accepts the layout the library
 * actually writes, `<cacheDir>/<org>/<repo>/onnx/model.onnx`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { isModelCached, resolveCacheDir, MODEL_ID } from '../../src/core/embeddings/providers/onnx-cache.mjs';
import { OnnxProvider } from '../../src/core/embeddings/providers/onnx.mjs';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.error(`  ✗ ${message}`); }
}

/**
 * Write a model.onnx at a given cache-relative path.
 *
 * @param {string} cacheDir
 * @param {string[]} parts — path segments under the cache dir
 */
function plantModel(cacheDir, parts) {
  const dir = resolve(cacheDir, ...parts);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'model.onnx'), 'not-a-real-onnx-file');
}

const root = mkdtempSync(resolve(tmpdir(), 'sr-onnx-probe-'));

try {
  console.log('\n=== ONNX model-cache probe ===\n');
  assert(MODEL_ID === 'Xenova/all-MiniLM-L6-v2', 'the probe knows which model it is looking for');

  // 1. Missing directory.
  console.log('\n1. Absent cache');
  assert(isModelCached(resolve(root, 'does-not-exist')) === false, 'a missing directory is not cached');
  assert(isModelCached(undefined) === false, 'undefined cacheDir is not cached');
  assert(isModelCached(null) === false, 'null cacheDir is not cached');
  assert(isModelCached('') === false, 'empty cacheDir is not cached');

  // 2. Empty directory.
  console.log('\n2. Empty cache directory');
  const emptyDir = resolve(root, 'empty');
  mkdirSync(emptyDir, { recursive: true });
  assert(isModelCached(emptyDir) === false, 'an empty directory is not cached');

  // 3. The regression the review described: a different model is cached.
  console.log('\n3. A different model is cached');
  const foreignDir = resolve(root, 'foreign');
  plantModel(foreignDir, ['Xenova', 'all-MiniLM-L12-v2', 'onnx']);
  assert(isModelCached(foreignDir) === false, 'a cached model with a different name does not satisfy the probe');
  assert(new OnnxProvider({ cacheDir: foreignDir }).isAvailable() === false, 'and the provider reports unavailable, so the hook falls back instead of downloading');

  // 4. Same repo, wrong file.
  console.log('\n4. Right repository, wrong artefact');
  const strayDir = resolve(root, 'stray');
  mkdirSync(resolve(strayDir, 'Xenova', 'all-MiniLM-L6-v2'), { recursive: true });
  writeFileSync(resolve(strayDir, 'Xenova', 'all-MiniLM-L6-v2', 'README.md'), 'no weights here');
  assert(isModelCached(strayDir) === false, 'a repository folder without model.onnx is not cached');

  // 5. Deeply nested foreign model: the old recursive scan would have found it.
  console.log('\n5. Deeply nested foreign model');
  const nestedDir = resolve(root, 'nested');
  plantModel(nestedDir, ['some-org', 'other-model', 'onnx']);
  assert(isModelCached(nestedDir) === false, 'a nested model.onnx for another repo is not cached');

  // 6. The real layout is accepted.
  console.log('\n6. The real layout is accepted');
  const goodDir = resolve(root, 'good');
  plantModel(goodDir, ['Xenova', 'all-MiniLM-L6-v2', 'onnx']);
  assert(isModelCached(goodDir) === true, '<cacheDir>/Xenova/all-MiniLM-L6-v2/onnx/model.onnx is cached');
  assert(new OnnxProvider({ cacheDir: goodDir }).isAvailable() === true, 'and the provider agrees');

  // 7. Alternate layouts the library may write.
  console.log('\n7. Alternate layouts');
  const flatDir = resolve(root, 'flat');
  plantModel(flatDir, ['Xenova', 'all-MiniLM-L6-v2']);
  assert(isModelCached(flatDir) === true, '<repo>/model.onnx is accepted');
  const quantDir = resolve(root, 'quant');
  mkdirSync(resolve(quantDir, 'Xenova', 'all-MiniLM-L6-v2', 'onnx'), { recursive: true });
  writeFileSync(resolve(quantDir, 'Xenova', 'all-MiniLM-L6-v2', 'onnx', 'model_quantized.onnx'), 'q');
  assert(isModelCached(quantDir) === true, 'a quantized model.onnx is accepted');
  assert(isModelCached(quantDir, 'someone/other') === false, 'but only for the model id asked about');

  // 8. The probe stays a pure filesystem check on this machine.
  console.log('\n8. Probe contract');
  const cacheDir = resolveCacheDir();
  assert(typeof cacheDir === 'string' && cacheDir.length > 0, 'resolveCacheDir returns a path');
  assert(typeof isModelCached(cacheDir) === 'boolean', 'isModelCached returns a boolean for the real cache');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);
if (failed > 0) process.exit(1);
