/**
 * Sub-Phase 6.9: embedding provider selection and ONNX-to-FNV-1a fallback.
 *
 * Two defects made the documented behaviour unreachable:
 *
 *   A. `SKILL_ROUTER_EMBEDDING_PROVIDER=onnx` never reached the hook, because
 *      the hook read `config.embeddings.provider`, which had no env mapping.
 *   B. Even once the provider was selected, `createProvider('onnx')` never
 *      throws — `embed()`/`buildIndex()` do — so the hook handed an unusable
 *      provider to `hybridRetrieve()`, which threw, and the hook exited 0
 *      with no output.json at all instead of falling back to FNV-1a.
 *
 * This file pins the fixed behaviour:
 *   1. `resolveProvider()` picks the configured provider, probes it with
 *      `isAvailable()`, falls back to fnv1a with a warning, and returns null
 *      when nothing is usable.
 *   2. the REAL hook, asked for onnx with a cold model cache (simulated by
 *      redirecting the transformers cache dir via --import), still writes
 *      output.json with skills and logs the fallback.
 *   3. the REAL hook, asked for onnx with a warm cache, uses onnx and ranks
 *      differently from the fnv1a run.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { resolveProvider } from '../../src/core/embeddings/resolve.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const HOOK_PATH = resolve(PROJECT_ROOT, 'hooks', 'route.mjs');
const ZCODE_OUT = resolve(PROJECT_ROOT, '.zcode', 'output.json');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log(`  \u2713 ${message}`); }
  else { failed++; console.error(`  \u2717 ${message}`); }
}

const PROMPT = 'debug rest api authentication token failures';

/**
 * Run the real hook, optionally with extra env and node CLI arguments.
 *
 * @param {object} [options]
 * @param {Record<string,string>} [options.env] — extra environment variables
 * @param {string[]} [options.nodeArgs] — extra node CLI arguments (e.g. --import)
 * @returns {Promise<{exitCode:number, output:object|null, stderr:string, ms:number}>}
 */
function runHook(options = {}) {
  return new Promise((done) => {
    if (existsSync(ZCODE_OUT)) rmSync(ZCODE_OUT, { force: true });
    const started = Date.now();
    const child = spawn('node', [...(options.nodeArgs ?? []), HOOK_PATH], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, ...(options.env ?? {}) },
    });
    let err = '';
    child.stderr.on('data', (c) => { err += c; });
    child.stdout.on('data', () => {});
    child.stdin.write(JSON.stringify({ prompt: PROMPT, cwd: PROJECT_ROOT }) + '\n');
    child.stdin.end();
    child.on('close', (code) => {
      let out = null;
      try {
        if (existsSync(ZCODE_OUT)) out = JSON.parse(readFileSync(ZCODE_OUT, 'utf-8'));
      } catch { out = null; }
      if (existsSync(ZCODE_OUT)) rmSync(ZCODE_OUT, { force: true });
      done({ exitCode: code ?? 0, output: out, stderr: err, ms: Date.now() - started });
    });
  });
}

/** Skill names from the `Selected: a, b, c` line the hook emits. */
function selectedNames(output) {
  const line = (output?.hookSpecificOutput?.additionalContext ?? '')
    .split('\n')
    .find((l) => l.startsWith('Selected: '));
  if (!line) return [];
  return line.slice('Selected: '.length).split(',').map((s) => s.trim()).filter(Boolean);
}

/** A provider stub: `available` controls what isAvailable() reports. */
function stubProvider(name, available) {
  return { name, isAvailable: () => available, embed: () => new Float32Array([1]) };
}

// ── 1. resolveProvider unit behaviour ──────────────────────────────────────────

console.log('\n=== resolveProvider ===\n');

const collected = [];
const capture = (msg) => collected.push(msg);

const okCase = resolveProvider(
  { embeddings: { provider: 'onnx', fallbackToFnv1a: true } },
  { createProvider: () => stubProvider('onnx', true), onWarn: capture },
);
assert(okCase.used === 'onnx', 'available onnx provider is used as-is');
assert(okCase.fellBack === false, 'no fallback recorded when the provider works');
assert(okCase.warning === null, 'no warning emitted when the provider works');

const coldCase = resolveProvider(
  { embeddings: { provider: 'onnx', fallbackToFnv1a: true } },
  { createProvider: (t) => stubProvider(t, t === 'fnv1a'), onWarn: capture },
);
assert(coldCase.used === 'fnv1a', 'cold onnx cache falls back to fnv1a');
assert(coldCase.fellBack === true, 'fallback is reported');
assert(coldCase.provider?.name === 'fnv1a', 'returned provider is the fnv1a one');
assert(/onnx[\s\S]*fnv1a/.test(coldCase.warning ?? ''), 'warning names the provider and the fallback');
assert(collected.some((m) => m.includes('isAvailable()')), 'warning explains why: probe failed');

const noFallback = resolveProvider(
  { embeddings: { provider: 'onnx', fallbackToFnv1a: false } },
  { createProvider: (t) => stubProvider(t, t === 'fnv1a'), onWarn: capture },
);
assert(noFallback.provider === null, 'fallbackToFnv1a:false yields no provider (pure BM25)');
assert(noFallback.used === 'none', 'no provider is reported as used');

const unknownCase = resolveProvider(
  { embeddings: { provider: 'gpt5', fallbackToFnv1a: true } },
  {
    createProvider: (t) => {
      if (t === 'gpt5') throw new Error('Unknown provider type: gpt5');
      return stubProvider(t, true);
    },
    onWarn: capture,
  },
);
assert(unknownCase.used === 'fnv1a', 'an unknown provider type falls back to fnv1a');

const fnvDead = resolveProvider(
  { embeddings: { provider: 'fnv1a', fallbackToFnv1a: true } },
  { createProvider: () => stubProvider('fnv1a', false), onWarn: capture },
);
assert(fnvDead.provider === null, 'unusable fnv1a yields null so the hook uses pure BM25');

const defaultCase = resolveProvider({}, {
  createProvider: (t) => stubProvider(t, true),
  onWarn: capture,
});
assert(defaultCase.requested === 'fnv1a', 'missing config defaults to the fnv1a provider');

// ── 2. Real hook, onnx requested, model NOT cached ────────────────────────────

console.log('\n=== Hook fallback: onnx requested, model absent ===\n');

const coldCacheDir = mkdtempSync(resolve(tmpdir(), 'sr-cold-cache-'));
const preloadPath = resolve(coldCacheDir, 'cold-cache-preload.mjs');
const preloadSrc =
  `import { createRequire } from 'node:module';\n` +
  `const req = createRequire(${JSON.stringify(PROJECT_ROOT.replace(/\\/g, '/') + '/')});\n` +
  `const mod = req('@huggingface/transformers');\n` +
  `mod.env.cacheDir = ${JSON.stringify(coldCacheDir)};\n`;
writeFileSync(preloadPath, preloadSrc, 'utf-8');

const cold = await runHook({
  env: { SKILL_ROUTER_EMBEDDING_PROVIDER: 'onnx' },
  nodeArgs: ['--import', pathToFileURL(preloadPath).href],
});
assert(cold.exitCode === 0, 'hook exits 0 (fail-open) with a cold onnx cache');
assert(cold.output !== null, 'hook still writes output.json when onnx is unavailable');
assert(selectedNames(cold.output).length > 0, 'hook still selects skills via the fnv1a fallback');
assert(/falling back to fnv1a/.test(cold.stderr), 'fallback warning is logged to stderr');
assert(!/could not be loaded/.test(cold.stderr), 'no raw provider error leaks to stderr');

const warmDefault = await runHook({});
assert(warmDefault.output !== null, 'hook writes output.json on the default fnv1a path');
assert(warmDefault.stderr.trim() === '', 'no provider warning on the default path');

// ── 3. Real hook, onnx requested, model cached ────────────────────────────────

console.log('\n=== Hook: onnx requested, model cached ===\n');

const warm = await runHook({ env: { SKILL_ROUTER_EMBEDDING_PROVIDER: 'onnx' } });
const onnxNames = selectedNames(warm.output);
const fnv1aNames = selectedNames(warmDefault.output);
assert(warm.exitCode === 0, 'hook exits 0 with a warm onnx cache');
assert(warm.output !== null, 'hook writes output.json with the onnx provider');
assert(onnxNames.length > 0, 'hook selects skills with the onnx provider');
assert(!/falling back/.test(warm.stderr), 'no fallback warning when the model is cached');
assert(
  onnxNames.length > 0 && onnxNames.join(',') !== fnv1aNames.join(','),
  `onnx ranking differs from fnv1a (onnx: ${onnxNames.join(', ')})`,
);

rmSync(coldCacheDir, { recursive: true, force: true });

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) process.exit(1);
