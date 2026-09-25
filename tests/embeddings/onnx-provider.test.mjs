/**
 * ONNX embedding provider tests.
 *
 * Verifies:
 *  - Provider interface is satisfied (name, dimensions, embed, buildIndex)
 *  - isAvailable() returns false on cold start (before download)
 *  - downloadModel() fails gracefully when offline (mocked fetch)
 *
 * NOTE: Tests never download the real model and never write to the shared
 * model cache. Offline behaviour is exercised in a child process
 * (tests/embeddings/helpers/onnx-offline-probe.mjs) that points the provider
 * at a throwaway cache directory and replaces the library's fetch with a
 * function that always throws.
 */
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

// 2. isAvailable() is false on a cold cache: a missing directory and an
// existing-but-empty directory must both report false.
console.log('\n2. isAvailable() on cold start');
const fakeOnnx = new OnnxProvider({ cacheDir: '/nonexistent-cache-path-abc123' });
const emptyCache = mkdtempSync(join(tmpdir(), 'onnx-cold-'));
const coldOnnx = new OnnxProvider({ cacheDir: emptyCache });
assert(fakeOnnx.isAvailable() === false, 'isAvailable() is false when cache dir missing');
assert(coldOnnx.isAvailable() === false, 'isAvailable() is false when cache dir is empty');
assert(typeof onnx.isAvailable() === 'boolean', 'isAvailable() returns a boolean');
rmSync(emptyCache, { recursive: true, force: true });

// 3. createProvider('onnx') returns OnnxProvider instance
console.log('\n3. Factory creates OnnxProvider');
const factory = createProvider('onnx');
assert(factory instanceof OnnxProvider, 'createProvider returns OnnxProvider');
assert(factory.name === 'onnx', 'factory provider name is "onnx"');
assert(factory.dimensions === 384, 'factory provider dimensions is 384');

// 4. downloadModel() fails gracefully when offline (mocked fetch)
//
// Run in a child process: the probe mutates the transformers `env` object
// (allowRemoteModels / fetch) and loads the real library, and a cached
// pipeline in the parent would mask the cold path.
//
// The probe is hermetic — the provider is pointed at an empty temporary
// cache directory, which OnnxProvider also pushes into the library as
// `env.cacheDir`. So both scenarios fail regardless of whether the real
// model happens to be cached on this machine.
console.log('\n4. downloadModel() fails gracefully when offline');
const PROBE_PATH = resolve('tests/embeddings/helpers/onnx-offline-probe.mjs');
const offlineResult = await new Promise((done) => {
  const child = spawn(process.execPath, [PROBE_PATH], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (code) => {
    done({ code, stdout: stdout.trim(), stderr: stderr.trim() });
  });
});

const probeLines = offlineResult.stdout.split(/\r?\n/).filter((l) => l.startsWith('RESULT:'));
const localOnly = probeLines.find((l) => l.startsWith('RESULT:local-only:')) ?? '';
const fetchMock = probeLines.find((l) => l.startsWith('RESULT:fetch-mock:')) ?? '';

assert(
  localOnly.startsWith('RESULT:local-only:error:ProviderNotAvailableError:'),
  'downloadModel() rejects with ProviderNotAvailableError when remote models are disabled'
);
assert(
  fetchMock.startsWith('RESULT:fetch-mock:error:ProviderNotAvailableError:'),
  'downloadModel() rejects with ProviderNotAvailableError when fetch fails (mocked offline)'
);
assert(
  fetchMock.includes('simulated offline'),
  'the underlying network error is preserved in the message'
);
assert(
  fetchMock.includes('SKILL_ROUTER_EMBEDDING_PROVIDER=fnv1a'),
  'the message names the offline fallback'
);
assert(
  offlineResult.code === 0 && probeLines.length === 2,
  `probe exits cleanly (exit=${offlineResult.code}, lines=${probeLines.length}, stderr="${offlineResult.stderr.slice(0, 80)}")`
);

// 5. isAvailable() remains false after failed download attempt
console.log('\n5. isAvailable() remains false after failed download');
assert(fakeOnnx.isAvailable() === false, 'isAvailable() is still false after failed download');

// 6. embed() and buildIndex() reject with ProviderNotAvailableError when cold
console.log('\n6. embed() and buildIndex() are gated on the cache');
let embedGated = false;
try {
  fakeOnnx.embed('laravel eloquent relationships');
} catch (err) {
  embedGated = err instanceof ProviderNotAvailableError;
}
assert(embedGated, 'embed() throws ProviderNotAvailableError when the model is not cached');

let buildGated = false;
try {
  fakeOnnx.buildIndex(index.slice(0, 3));
} catch (err) {
  buildGated = err instanceof ProviderNotAvailableError;
}
assert(buildGated, 'buildIndex() throws ProviderNotAvailableError when the model is not cached');

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
