/**
 * End-to-end implicit-routing abstention tests (review findings B1, N6, N7).
 *
 * These spawn the REAL hook (hooks/route.mjs) with a JSON payload on stdin,
 * exactly as ZCode does, and read .zcode/output.json back.
 *
 * What the review found, reproduced through the hook before the fix:
 *
 *   prompt   "zzzz qqqq unrelated gibberish xyzzy"
 *   before   Tier: bm25, 5 Laravel backend skills, 20394 injected chars,
 *            Confidence: 0.016026625704045058
 *   after    no output.json at all — the hook abstains and exits 0
 *
 * The same run exposed two further defects on that default path: the
 * confidence it reported was an RRF value (max 1/61 = 0.0164) rather than a
 * BM25 score, so it was meaningless against the 0.85/0.60 thresholds; and the
 * hybrid branch had no timeout guard, so a cold ONNX load (~2 s) blew through
 * hook.timeoutMs of 200 on every prompt.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const HOOK_PATH = resolve(PROJECT_ROOT, 'hooks', 'route.mjs');
const OUTPUT_PATH = resolve(PROJECT_ROOT, '.zcode', 'output.json');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.error(`  ✗ ${message}`); }
}

/**
 * Run the real hook with a prompt and collect the result.
 *
 * @param {string} prompt
 * @param {Record<string,string>} [env]
 * @returns {Promise<{code:number, stderr:string, ms:number, context:string|null, plan:object|null}>}
 */
function runHook(prompt, env = {}) {
  return new Promise((done) => {
    if (existsSync(OUTPUT_PATH)) rmSync(OUTPUT_PATH, { force: true });
    const started = Date.now();
    const child = spawn('node', [HOOK_PATH], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      const ms = Date.now() - started;
      let context = null;
      let plan = null;
      if (existsSync(OUTPUT_PATH)) {
        const parsed = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
        context = parsed.hookSpecificOutput?.additionalContext ?? '';
        plan = parsed.RoutePlan ?? null;
      }
      done({ code, stderr: stderr + stdout, ms, context, plan });
    });
    child.stdin.write(JSON.stringify({ prompt, cwd: PROJECT_ROOT }));
    child.stdin.end();
  });
}

const UNRELATED = 'zzzz qqqq unrelated gibberish xyzzy';
const RELEVANT = 'how do I write a laravel database migration';

console.log('\n=== Hook: implicit abstention ===\n');

// 1. An unrelated prompt must inject nothing.
console.log('1. Unrelated prompt abstains');
const unrelated = await runHook(UNRELATED);
assert(unrelated.code === 0, 'the hook still exits 0 (fail-open)');
assert(unrelated.context === null, 'no additionalContext is written for an unrelated prompt');
assert(!existsSync(OUTPUT_PATH), 'and no output.json is produced');
assert(!/SKILL:/.test(unrelated.stderr), 'no skill block leaks to stdout/stderr');

// 2. A related prompt must still route, on the BM25 confidence scale.
console.log('\n2. Related prompt routes, with a BM25-scale confidence');
const related = await runHook(RELEVANT);
assert(related.code === 0, 'exits 0');
assert(related.context !== null, 'writes output.json');
const tier = /Tier: (\w+)/.exec(related.context)?.[1];
const selected = /Selected: (.+)/.exec(related.context)?.[1] ?? '';
const confidence = Number(/Confidence: ([0-9.]+)/.exec(related.context)?.[1]);
assert(tier === 'bm25', `tier is bm25 (got ${tier})`);
assert(selected.length > 0, 'skills are selected');
assert(selected.includes('backend-migrations'), 'and the expected skill is among them');
assert(confidence > 0 && confidence <= 1, `confidence is a normalised BM25 score (got ${confidence})`);
assert(confidence >= 0.6, 'so it is comparable with confidence.mediumThreshold (0.60)');
assert(!/SKILL: router-/.test(related.context), 'no router skill is injected');

// 3. The injected context respects the budget.
console.log('\n3. Budget is respected');
const injected = (related.context.match(/--- SKILL: /g) ?? []).length;
assert(injected > 0 && injected <= 5, `${injected} skills injected (topK is 5)`);
assert(related.context.length <= 24000, `injected context is ${related.context.length} chars, within the 24000 budget`);

// 4. Telemetry reports the abstention and a BM25-scale confidence.
console.log('\n4. Telemetry records the abstention and a usable confidence');
const DAY = new Date().toISOString().slice(0, 10);
const readLog = (file) => {
  const p = resolve(PROJECT_ROOT, 'logs', file);
  return existsSync(p)
    ? readFileSync(p, 'utf-8').trim().split(String.fromCharCode(10)).filter(Boolean).map((l) => JSON.parse(l))
    : [];
};
const routeEvents = readLog(`${DAY}.jsonl`).filter((r) => r.event === 'route');
const mine = routeEvents.filter((r) => r.query === UNRELATED || r.query === RELEVANT);
assert(mine.length >= 2, `the hook logged both prompts (got ${mine.length} route records)`);
const abstained = mine.filter((r) => r.query === UNRELATED).pop();
const routed = mine.filter((r) => r.query === RELEVANT).pop();
assert(abstained?.tier === 'none', 'the unrelated prompt is logged with tier none, not bm25');
assert(abstained?.candidates.length === 0, 'and no candidates');
assert(routed?.tier === 'bm25', 'the related prompt is logged with tier bm25');
assert((routed?.bm25Latency ?? 0) > 0, 'and a real bm25 latency instead of the hardcoded 0');

const decisions = readLog(`routing-${DAY.replace(/-/g, '')}.jsonl`);
const decision = decisions.filter((d) => d.promptHash).pop();
assert(typeof decision?.confidence === 'number', 'a decision record carries a numeric confidence');
assert(decision?.tier === 'bm25' || decision?.tier === 'none', 'on a documented tier');

// 5. The hybrid branch is guarded by hook.timeoutMs (N6).
console.log('\n5. The hybrid branch honours hook.timeoutMs');
const source = readFileSync(HOOK_PATH, 'utf-8');
const hybridBranch = source.slice(source.indexOf('if (!slmEnabled)'), source.indexOf('return await Promise.race(['));
assert(/Promise\.race\(\[/.test(hybridBranch), 'the hybrid retrieval is raced against a timeout');
assert(/hook\.timeoutMs|timeoutMs/.test(hybridBranch), 'using hook.timeoutMs');
assert(hybridBranch.includes('minBm25Score'), 'and receives the relevance floor');
assert(hybridBranch.includes('r.bm25Score'), 'and reports confidence from the BM25 score, not the RRF score');

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);
if (failed > 0) process.exit(1);
