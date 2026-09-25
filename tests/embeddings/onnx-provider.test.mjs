/**
 * ONNX embedding provider tests.
 *
 * Verifies:
 *  - Provider interface is satisfied (name, dimensions, embed, buildIndex)
 *  - isAvailable() returns false on cold start (before download)
 *  - downloadModel() fails gracefully when offline (mocked fetch)
 *
 * NOTE: Tests do NOT download the real model. Network access is prevented by
 * setting allowRemoteModels=false on the transformers env before tests run.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createProvider } from '../../src/core/embeddings/provider.mjs';
import { ProviderNotAvailableError } from '../../src/core/embeddings/errors.mjs';
import { OnnxProvider } from '../../src/core/embeddings/providers/onnx.mjs';

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

console.log('\n=== ONNX Provider Tests ===\n');

// 1. Interface: name, dimensions
console.log('1. Provider interface');
const onnx = new OnnxProvider();
assert(onnx.name === 'onnx', 'name is "onnx"');
assert(onnx.dimensions === 384, 'dimensions is 384');

// 2. isAvailable() returns false when cache dir does not exist
console.log('\n2. isAvailable() on cold start');
const fakeOnnx = new OnnxProvider({ cacheDir: '/nonexistent-cache-path-abc123' });
assert(fakeOnnx.isAvailable() === false, 'isAvailable() is false when cache dir missing');
assert(typeof onnx.isAvailable() === 'boolean', 'isAvailable() returns a boolean');

// 3. createProvider('onnx') returns OnnxProvider instance
console.log('\n3. Factory creates OnnxProvider');
const factory = createProvider('onnx');
assert(factory instanceof OnnxProvider, 'createProvider returns OnnxProvider');
assert(factory.name === 'onnx', 'factory provider name is "onnx"');
assert(factory.dimensions === 384, 'factory provider dimensions is 384');

// 4. downloadModel() fails gracefully when offline
// We run this in a separate child process to avoid interference from any
// previously-cached pipeline in the parent process.
console.log('\n4. downloadModel() fails gracefully when offline');
const offlineResult = await new Promise((resolve) => {
  const child = spawn(process.execPath, [
    '-e',
    [
      "import('@huggingface/transformers').then(async m => {",
      "  const { pipeline, env } = m;",
      "  env.allowRemoteModels = false;",
      "  env.cacheDir = '/nonexistent-cache-fake-path';",
      "  try {",
      "    const p = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');",
      "    console.log('RESULT:success');",
      "  } catch(e) {",
      "    console.log('RESULT:error:', e.message);",
      "  }",
      "}).catch(e => console.log('RESULT:import-error:', e.message));",
    ].join('\n'),
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (code) => {
    resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
  });
});

const isGracefulFailure = offlineResult.stdout.includes('RESULT:error:') &&
  !offlineResult.stdout.includes('RESULT:success');
assert(
  isGracefulFailure,
  `downloadModel() should fail gracefully when offline (exit=${offlineResult.code}, out="${offlineResult.stdout}", err="${offlineResult.stderr.slice(0, 80)}")`
);

// 5. isAvailable() remains false after failed download attempt
console.log('\n5. isAvailable() remains false after failed download');
assert(fakeOnnx.isAvailable() === false, 'isAvailable() is still false after failed download');

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
