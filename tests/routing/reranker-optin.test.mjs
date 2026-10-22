/**
 * P6-H-026 (Sub-Phase A.7) — the reranker is off by default, opt-in only.
 *
 * Its held-out R² is −4.58 (fit to itself; docs/reranker.md), so the
 * production routing path must not run it unless an operator sets
 * SKILL_ROUTER_RERANKER=enabled.
 *
 *   1. Config layer: `reranker.enabled` is false by default, true when the
 *      env var says so, and stays false for "disabled"/unrecognised values.
 *   2. Real hook spawns: the route telemetry record carries `rerankEnabled`
 *      (false by default, true when opted in), and the opt-in emits an
 *      `experimental_mode` telemetry event with mode 'reranker'.
 *   3. Source guard: the hook drives the rerank flag from config, not a
 *      hardcoded `rerank: false`.
 */
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const PROJECT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const HOOK = join(PROJECT, 'hooks', 'route.mjs');
const TODAY_LOG = join(PROJECT, 'logs', `${new Date().toISOString().slice(0, 10)}.jsonl`);

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

// ── 1. Config layer ────────────────────────────────────────────────────────────

console.log('\n=== 1. Config: reranker.enabled is false by default, opt-in via env ===');
const { getDefaults, mergeWithEnv } = await import('../../src/config/defaults.mjs');

function resolveRerankerEnabled() {
  delete process.env.SKILL_ROUTER_RERANKER;
  const base = mergeWithEnv(getDefaults());
  if (process.env.SKILL_ROUTER_RERANKER === undefined) return base.reranker.enabled;
  return base.reranker.enabled;
}

assert(resolveRerankerEnabled() === false, 'default config: reranker.enabled is false');
assert(getDefaults().reranker.experimental === true, 'default config: reranker.experimental is true');

process.env.SKILL_ROUTER_RERANKER = 'enabled';
assert(mergeWithEnv(getDefaults()).reranker.enabled === true, 'SKILL_ROUTER_RERANKER=enabled turns it on');

process.env.SKILL_ROUTER_RERANKER = 'disabled';
assert(mergeWithEnv(getDefaults()).reranker.enabled === false, 'SKILL_ROUTER_RERANKER=disabled keeps it off');

process.env.SKILL_ROUTER_RERANKER = 'yes-please';
const warns = [];
const origWarn = console.warn;
console.warn = (msg) => warns.push(msg);
try {
  assert(mergeWithEnv(getDefaults()).reranker.enabled === false, 'unrecognised value keeps it off');
  assert(
    warns.some((w) => String(w).includes('SKILL_ROUTER_RERANKER')),
    'unrecognised value prints a warning',
  );
} finally {
  console.warn = origWarn;
  delete process.env.SKILL_ROUTER_RERANKER;
}

// ── 2. Real hook spawns ───────────────────────────────────────────────────────

console.log('\n=== 2. Hook: rerankEnabled telemetry + experimental_mode event ===');

/**
 * Spawn the real hook with a prompt. The process cwd is the project root so
 * telemetry lands in <project>/logs/ (the logger resolves logs/ relative to
 * cwd); the payload's cwd field steers .zcode/output.json into a temp dir.
 * Returns the child's exit code and stderr.
 */
async function spawnHook(extraEnv, prompt) {
  const outCwd = mkdtempSync(join(tmpdir(), 'sr-rerank-'));
  try {
    return await new Promise((res) => {
      const child = spawn(process.execPath, [HOOK], {
        cwd: PROJECT,
        env: { ...process.env, ...extraEnv },
      });
      child.stdin.write(JSON.stringify({ prompt, cwd: outCwd }));
      child.stdin.end();
      let err = '';
      child.stderr.on('data', (d) => { err += d; });
      child.on('close', (code) => res({ code, stderr: err }));
    });
  } finally {
    rmSync(outCwd, { recursive: true, force: true });
  }
}

/** Events appended to today's telemetry log since `startLen`. */
function logEventsSince(startLen) {
  if (!existsSync(TODAY_LOG)) return [];
  const text = readFileSync(TODAY_LOG, 'utf-8').slice(startLen);
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);
}

const prompt = 'fix the n+1 query in the order model';

// 2.1 Default: rerankEnabled false, no reranker experimental event.
if (!existsSync(join(PROJECT, 'data', 'skill-index.json'))) {
  console.log('  (index missing — skipping spawn sections; run reindex first)');
} else {
  const start1 = existsSync(TODAY_LOG) ? readFileSync(TODAY_LOG, 'utf-8').length : 0;
  const def = await spawnHook({}, prompt);
  const defEvents = logEventsSince(start1);
  const defRoute = defEvents.find((e) => e.event === 'route' && e.rerankEnabled !== undefined);
  assert(def.code === 0, 'default hook spawn exits 0 (fail-open preserved)');
  assert(defRoute && defRoute.rerankEnabled === false, 'default route record has rerankEnabled: false');
  assert(
    !defEvents.some((e) => e.event === 'experimental_mode' && e.mode === 'reranker'),
    'default run emits no reranker experimental_mode event',
  );

  // 2.2 Opt-in: rerankEnabled true + experimental_mode event + stderr warning.
  const start2 = existsSync(TODAY_LOG) ? readFileSync(TODAY_LOG, 'utf-8').length : 0;
  const on = await spawnHook({ SKILL_ROUTER_RERANKER: 'enabled' }, prompt);
  const onEvents = logEventsSince(start2);
  const onRoute = onEvents.find((e) => e.event === 'route' && e.rerankEnabled !== undefined);
  assert(on.code === 0, 'opt-in hook spawn exits 0 (fail-open preserved)');
  assert(onRoute && onRoute.rerankEnabled === true, 'opt-in route record has rerankEnabled: true');
  assert(
    onEvents.some((e) => e.event === 'experimental_mode' && e.mode === 'reranker'),
    'opt-in run emits the reranker experimental_mode event',
  );
  assert(
    on.stderr.includes('experimental_mode') || on.stderr.includes('reranker'),
    'opt-in run warns about the experimental reranker on stderr',
  );
}

// ── 3. Source guard ─────────────────────────────────────────────────────────────

console.log('\n=== 3. Source guard: the hook drives rerank from config ===');
const hookSrc = readFileSync(HOOK, 'utf-8');
assert(hookSrc.includes('rerank: rerankerEnabled'), 'route.mjs passes rerank: rerankerEnabled');
assert(!/rerank:\s*false/.test(hookSrc), 'route.mjs does not hardcode rerank: false');
assert(
  hookSrc.includes('config.reranker?.enabled === true'),
  'the flag is read from config (env-merged), not process.env directly',
);

console.log('\n=== Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) process.exit(1);
