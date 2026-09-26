/**
 * Phase 7.1 (decision D29): the default embedding mode is `bm25-only`, and the
 * ONNX mode is experimental and says so at runtime.
 *
 * Phase 6 measured the semantic path and it lost: ONNX gains +5.18 pp Set
 * Recall@5 over FNV-1a with the channel on, but costs 1445 ms median against a
 * 100 ms budget, and both semantic-on configurations score *below* the pure
 * BM25 configuration that ships (Set Recall@5 1.0000). The code is kept; the
 * capability is forced off and labelled experimental, so this file pins:
 *
 *   1. `getDefaults().embeddings.provider` is `'bm25-only'`, not `'onnx'` and
 *      not the old `'fnv1a'` spelling;
 *   2. the provider registry maps that mode onto the FNV-1a provider and marks
 *      only the onnx entry `experimental: true`;
 *   3. `resolveProvider()` honours the mode without a spurious fallback;
 *   4. the REAL hook, run with SKILL_ROUTER_EMBEDDING_PROVIDER=onnx, emits the
 *      `experimental_mode` telemetry event with exactly the three contracted
 *      fields and a stderr warning, and still exits 0 with a decision;
 *   5. the default path emits no such event and no stderr at all.
 *
 * Registered in the package.json `test` chain:
 *   node tests/embeddings-defaults.test.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDefaults } from '../src/config/defaults.mjs';
import { getConfig } from '../src/config/env.mjs';
import { createProvider } from '../src/core/embeddings/provider.mjs';
import { resolveProvider } from '../src/core/embeddings/resolve.mjs';
import {
  DEFAULT_MODE,
  EXPERIMENTAL_EVENT,
  experimentalModeEvent,
  getProviderEntry,
  isExperimentalMode,
  resolveProviderType,
} from '../src/core/embeddings/experimental.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const HOOK_PATH = resolve(PROJECT_ROOT, 'hooks', 'route.mjs');
const ZCODE_OUT = resolve(PROJECT_ROOT, '.zcode', 'output.json');
const PROMPT = 'how do I write a laravel database migration';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log(`  \u2713 ${message}`); }
  else { failed++; console.error(`  \u2717 ${message}`); }
}

const LOG_PATH = resolve(PROJECT_ROOT, 'logs', `${new Date().toISOString().slice(0, 10)}.jsonl`);

/** All `experimental_mode` telemetry lines currently in today's log. */
function experimentalEvents() {
  if (!existsSync(LOG_PATH)) return [];
  return readFileSync(LOG_PATH, 'utf-8')
    .split('\n')
    .filter((l) => l.includes(`"${EXPERIMENTAL_EVENT}"`))
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

/**
 * Run the real hook with extra environment variables.
 *
 * @param {Record<string,string>} [env] — extra environment variables
 * @returns {Promise<{exitCode:number, output:object|null, stderr:string}>}
 */
function runHook(env = {}) {
  return new Promise((done) => {
    if (existsSync(ZCODE_OUT)) rmSync(ZCODE_OUT, { force: true });
    const child = spawn(process.execPath, [HOOK_PATH], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, ...env },
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
      done({ exitCode: code ?? 0, output: out, stderr: err });
    });
  });
}

// ── 1. The default mode ──────────────────────────────────────────────────────

console.log('\n1. Default provider mode');
const defaults = getDefaults();
assert(
  defaults.embeddings.provider === 'bm25-only',
  `getDefaults().embeddings.provider is "bm25-only" (got ${JSON.stringify(defaults.embeddings.provider)})`,
);
assert(defaults.embeddings.provider !== 'onnx', 'the default is not the onnx provider');
assert(getConfig().embeddings.provider === 'bm25-only', 'getConfig() resolves the same default');
assert(DEFAULT_MODE === 'bm25-only', 'DEFAULT_MODE is bm25-only');

// ── 2. The provider registry ─────────────────────────────────────────────────

console.log('\n2. Provider registry');
const registry = defaults.embeddings.providers;
assert(registry !== undefined && typeof registry === 'object', 'embeddings.providers is a registry object');
assert(registry['bm25-only'].type === 'fnv1a', 'the bm25-only mode maps onto the fnv1a provider');
assert(registry['bm25-only'].experimental === false, 'the bm25-only mode is not experimental');
assert(registry.onnx.type === 'onnx', 'the onnx mode maps onto the onnx provider');
assert(registry.onnx.experimental === true, 'the onnx mode is flagged experimental');
assert(registry.onnx.risk === 'untested_scale', 'the onnx mode carries the untested_scale risk label');
assert(resolveProviderType(defaults, 'onnx') === 'onnx', 'resolveProviderType maps onnx to onnx');
assert(resolveProviderType(defaults, 'bm25-only') === 'fnv1a', 'resolveProviderType maps bm25-only to fnv1a');
assert(getProviderEntry(defaults, 'onnx').risk === 'untested_scale', 'getProviderEntry exposes the risk label');
assert(getProviderEntry(defaults, 'gpt5') === null, 'an unknown mode resolves to null instead of throwing');
assert(isExperimentalMode(defaults, 'onnx') === true, 'isExperimentalMode(onnx) is true');
assert(isExperimentalMode(defaults, 'bm25-only') === false, 'isExperimentalMode(bm25-only) is false');
assert(
  createProvider('bm25-only').name === 'fnv1a',
  'createProvider("bm25-only") builds the fnv1a provider',
);

// ── 3. Resolution honours the default mode ───────────────────────────────────

console.log('\n3. resolveProvider with the shipped default');
const defaultResolution = resolveProvider(getDefaults(), { onWarn: () => {} });
assert(defaultResolution.requested === 'bm25-only', 'the requested mode is bm25-only');
assert(defaultResolution.used === 'fnv1a', 'the fnv1a provider is what gets constructed');
assert(defaultResolution.provider !== null, 'a provider is returned on the default path');
assert(defaultResolution.fellBack === false, 'the default path is not a fallback');
assert(defaultResolution.warning === null, 'the default path emits no degradation warning');

// ── 4. The onnx mode is experimental ─────────────────────────────────────────

console.log('\n4. experimental_mode event shape');
const onnxEvent = experimentalModeEvent(getDefaults(), 'onnx');
assert(onnxEvent !== null, 'the onnx mode produces an experimental_mode event');
assert(onnxEvent.event === 'experimental_mode', `event is "${EXPERIMENTAL_EVENT}"`);
assert(onnxEvent.mode === 'onnx', 'mode is "onnx"');
assert(onnxEvent.risk === 'untested_scale', 'risk is "untested_scale"');
assert(
  Object.keys(onnxEvent).length === 3,
  `the event carries exactly the three contracted fields (got ${Object.keys(onnxEvent).join(',')})`,
);
assert(experimentalModeEvent(getDefaults(), 'bm25-only') === null, 'the default mode produces no event');
assert(experimentalModeEvent(getDefaults(), 'gpt5') === null, 'an unknown mode produces no event');

// ── 5. The real hook, onnx requested ─────────────────────────────────────────

console.log('\n5. Real hook with SKILL_ROUTER_EMBEDDING_PROVIDER=onnx');
const before = experimentalEvents().length;
const onnxRun = await runHook({ SKILL_ROUTER_EMBEDDING_PROVIDER: 'onnx' });
const after = experimentalEvents();
assert(onnxRun.exitCode === 0, 'the hook exits 0 (fail-open) with the experimental provider selected');
assert(onnxRun.output !== null, 'the hook still writes output.json with the experimental provider');
assert(
  /experimental_mode/.test(onnxRun.stderr) && /EXPERIMENTAL/.test(onnxRun.stderr),
  'the hook warns on stderr that the mode is experimental',
);
assert(
  /untested_scale/.test(onnxRun.stderr) && /onnx/.test(onnxRun.stderr),
  'the warning names the mode and its risk label',
);
assert(after.length === before + 1, `exactly one experimental_mode telemetry event was written (${before} -> ${after.length})`);
const emitted = after[after.length - 1];
assert(
  emitted.event === 'experimental_mode' && emitted.mode === 'onnx' && emitted.risk === 'untested_scale',
  `the logged event is { event: "experimental_mode", mode: "onnx", risk: "untested_scale" } (got ${JSON.stringify(emitted)})`,
);

// ── 6. The real hook, default mode ───────────────────────────────────────────

console.log('\n6. Real hook on the default path');
const beforeDefault = experimentalEvents().length;
const defaultEnv = { ...process.env };
delete defaultEnv.SKILL_ROUTER_EMBEDDING_PROVIDER;
const defaultRun = await new Promise((done) => {
  const child = spawn(process.execPath, [HOOK_PATH], { cwd: PROJECT_ROOT, env: defaultEnv });
  let err = '';
  child.stderr.on('data', (c) => { err += c; });
  child.stdout.on('data', () => {});
  child.stdin.write(JSON.stringify({ prompt: PROMPT, cwd: PROJECT_ROOT }) + '\n');
  child.stdin.end();
  child.on('close', (code) => done({ exitCode: code ?? 0, stderr: err }));
});
assert(defaultRun.exitCode === 0, 'the hook exits 0 on the default path');
assert(defaultRun.stderr.trim() === '', 'the default path writes nothing to stderr');
assert(
  experimentalEvents().length === beforeDefault,
  'the default path emits no experimental_mode event',
);

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) process.exit(1);
