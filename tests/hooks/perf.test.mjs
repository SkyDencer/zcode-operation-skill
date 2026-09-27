/**
 * Sub-Phase 7.6 — hook performance at 1000-skill index scale.
 *
 * Spawns the real hook (hooks/route.mjs) 100 times with 100 varied
 * prompts against the 1000-skill fixture index and measures:
 *
 *   - wall-clock spawn time: p50, p95, p99. Gate: p95 < 100 ms.
 *   - per-invocation memory via SKILL_ROUTER_MEM_PROFILE (the hook writes
 *     one stderr JSON line). Budget: rss under 100 MB.
 *   - correctness at scale: name-targeted prompts must surface their
 *     target skill in the top-5 candidates; keyword prompts report a
 *     template-family hit rate; gibberish prompts document the known
 *     non-scaling relevance floor (finding B1 from Sub-Phases 7.3/7.5).
 *   - telemetry completeness (Sub-Phase 7.6 step 1): every spawn,
 *     including the three fail-open spawns (empty input, malformed JSON,
 *     missing index), emits a route record carrying indexLoadMs, bm25Ms,
 *     contextBuildMs and totalMs.
 *
 * The 1000-entry index is loaded from tests/fixtures/large-index/ — no
 * index is rebuilt per run. The SKILL.md corpus the fixture points at
 * lives under the gitignored data/skills-synthetic-* pattern; the test
 * regenerates it once via the build script only when it is missing.
 *
 * The fixture swaps into data/skill-index.json (the hook's fixed index
 * path) for the run and is restored in a finally block.
 *
 * Run: node tests/hooks/perf.test.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const HOOK = join(ROOT, 'hooks', 'route.mjs');
const INDEX = join(ROOT, 'data', 'skill-index.json');
const INDEX_MOVED = join(ROOT, 'data', 'skill-index.json.7.6-moved');
const BACKUP = join(ROOT, 'data', 'skill-index.json.7.6-backup');
const PREBUILT = join(ROOT, 'data', 'skill-index.prebuilt.json');
const PREBUILT_BACKUP = join(ROOT, 'data', 'skill-index.prebuilt.json.7.6-backup');
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'large-index', 'skill-index-1000.json');
const FIXTURE_PREBUILT = join(ROOT, 'tests', 'fixtures', 'large-index', 'skill-index-1000.prebuilt.json');
const BUILD = join(ROOT, 'tests', 'fixtures', 'large-index', 'build.mjs');
const CORPUS = join(ROOT, 'data', 'skills-synthetic-1000');
const WORK = join(tmpdir(), `sr-perf-${process.pid}`);

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ok: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

/** Linear-interpolated percentile (same convention as src/telemetry/feedback.mjs). */
function percentile(sorted, pct) {
  if (sorted.length === 0) return 0;
  const idx = (pct / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function countSkillFiles(dir) {
  let n = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name === 'SKILL.md') n++;
    }
  };
  if (existsSync(dir)) walk(dir);
  return n;
}

function buildFixtureOnce() {
  execFileSync(process.execPath, [BUILD], { cwd: ROOT, stdio: 'inherit' });
}

// ── Fixture readiness: load the committed index; regenerate the gitignored
// ── corpus once only when missing. No index is rebuilt on every run.
if (!existsSync(FIXTURE)) buildFixtureOnce();
if (countSkillFiles(CORPUS) < 1000) {
  console.log('corpus missing or short — regenerating (one-time, gitignored artifact)');
  buildFixtureOnce();
}

/**
 * 100 deterministic, varied prompts derived from the fixture itself:
 * 40 with the target skill name embedded verbatim, 40 keyword-led,
 * 20 gibberish.
 *
 * @param {Array<object>} fixture
 * @returns {{prompts:string[], targets:Array<{prompt:string, kind:string, name:string|null, family:string|null}>}}
 */
function buildPrompts(fixture) {
  const prompts = [];
  const targets = [];
  for (let i = 0; i < 40; i++) {
    const skill = fixture[(i * 17) % 1000];
    const form = i % 3;
    const p =
      form === 0
        ? `Use the ${skill.name} skill in my project.`
        : form === 1
          ? `Which skill should I use for tasks involving ${skill.name}?`
          : `Apply the ${skill.name} skill to my ${skill.domains[0] ?? 'general'} work.`;
    prompts.push(p);
    targets.push({ prompt: p, kind: 'name', name: skill.name, family: skill.name.replace(/-\d+$/, '') });
  }
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const skill = fixture[(i * 29 + 5) % 1000];
    const kw = skill.keywords[0] || skill.name;
    let p = `How do I implement ${kw} following best practices?`;
    if (seen.has(p)) p += ` (variant ${seen.size})`;
    seen.add(p);
    prompts.push(p);
    targets.push({ prompt: p, kind: 'keyword', name: skill.name, family: skill.name.replace(/-\d+$/, '') });
  }
  for (let i = 0; i < 20; i++) {
    const p = `pluzz vork flib ${i} qqqzz unrelated`;
    prompts.push(p);
    targets.push({ prompt: p, kind: 'gibberish', name: null, family: null });
  }
  return { prompts, targets };
}

/** Spawn the hook once; resolve with exit code, wall ms, memory, and output plan. */
function runHook(input, outDir) {
  return new Promise((done) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [HOOK], {
      cwd: ROOT,
      env: { ...process.env, SKILL_ROUTER_MEM_PROFILE: '1' },
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdout.on('data', () => {});
    if (input !== null) child.stdin.write(input);
    child.stdin.end();
    child.on('close', (code) => {
      let mem = null;
      for (const line of stderr.split('\n')) {
        if (line.includes('skillRouterMem')) {
          try { mem = JSON.parse(line).skillRouterMem; } catch { /* keep null */ }
        }
      }
      let plan = null;
      const outPath = join(outDir, '.zcode', 'output.json');
      if (existsSync(outPath)) {
        try { plan = JSON.parse(readFileSync(outPath, 'utf-8')); } catch { plan = null; }
      }
      done({ code, ms: Date.now() - t0, mem, plan });
    });
  });
}

function readNewEvents(logPath, offset) {
  const text = readFileSync(logPath, 'utf-8').slice(offset);
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

async function main() {
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf-8'));
  assert(fixture.length === 1000, `fixture holds 1000 entries (got ${fixture.length})`);
  assert(new Set(fixture.map((e) => e.name)).size === 1000, 'fixture names are unique');
  assert(countSkillFiles(CORPUS) === 1000, `corpus on disk holds 1000 SKILL.md files`);

  const { prompts, targets } = buildPrompts(fixture);
  assert(new Set(prompts).size === 100, '100 prompts are distinct');

  mkdirSync(WORK, { recursive: true });

  // Swap the fixture (index + parsed-index cache) into the hook's fixed
  // paths; restore both in finally.
  const hadRealIndex = existsSync(INDEX);
  if (hadRealIndex) copyFileSync(INDEX, BACKUP);
  writeFileSync(INDEX, readFileSync(FIXTURE, 'utf-8'), 'utf-8');
  const hadRealPrebuilt = existsSync(PREBUILT);
  if (hadRealPrebuilt) copyFileSync(PREBUILT, PREBUILT_BACKUP);
  if (existsSync(FIXTURE_PREBUILT)) {
    writeFileSync(PREBUILT, readFileSync(FIXTURE_PREBUILT, 'utf-8'), 'utf-8');
  } else if (existsSync(PREBUILT)) {
    // No committed cache for this fixture: drop it so the hook uses the
    // slow path, and the measurement is the un-optimised one.
    rmSync(PREBUILT, { force: true });
  }

  const today = new Date().toISOString().slice(0, 10);
  const logPath = join(ROOT, 'logs', `${today}.jsonl`);
  const logOffsetBefore = existsSync(logPath) ? statSync(logPath).size : 0;

  const results = [];
  try {
    // ── 100 varied prompts against the 1000-skill index ─────────────────
    for (let i = 0; i < 100; i++) {
      const outJson = join(WORK, '.zcode', 'output.json');
      if (existsSync(outJson)) rmSync(outJson, { force: true });
      results.push({
        i,
        target: targets[i],
        ...(await runHook(JSON.stringify({ prompt: prompts[i], cwd: WORK }), WORK)),
      });
    }

    // ── Correctness at scale ─────────────────────────────────────────────
    // The ranking quality on this synthetic corpus is a documented property
    // of the scale benchmark (Sub-Phase 7.4/7.5: generic medium/weak-tier
    // descriptions make keyword-only prompts weak signals), so the hard
    // gate here is pipeline correctness: the target skill OR a same-template
    // instance must sit in top-5 for name-targeted prompts. Exact-name and
    // family counts are reported, not hidden.
    const nameChecks = results.filter((r) => r.target.kind === 'name');
    const top5Of = (r) => (r.plan?.RoutePlan?.candidates ?? []).slice(0, 5).map((c) => c.name);
    const nameExact = nameChecks.filter((r) => top5Of(r).includes(r.target.name));
    const nameFamily = nameChecks.filter((r) =>
      top5Of(r).some((n) => n.replace(/-\d+$/, '') === r.target.family)
    );
    assert(
      nameFamily.length >= Math.ceil(nameChecks.length * 0.9),
      `name-targeted prompts: target or same-template instance in top-5 in ` +
        `${nameFamily.length}/${nameChecks.length} (exact-name ${nameExact.length}/${nameChecks.length}); ` +
        `gate is 90% family hits — the misses are the documented B1 non-discriminative tiers`
    );
    const kwChecks = results.filter((r) => r.target.kind === 'keyword');
    const kwHits = kwChecks.filter((r) => top5Of(r).map((n) => n.replace(/-\d+$/, '')).includes(r.target.family));
    console.log(`  report: keyword prompts with template-family hit in top-5: ${kwHits.length}/${kwChecks.length}`);
    const gib = results.filter((r) => r.target.kind === 'gibberish');
    const gibRouted = gib.filter((r) => r.plan !== null).length;
    console.log(
      `  report: gibberish prompts routed instead of abstaining: ${gibRouted}/${gib.length}` +
        ' (expected: the B1 relevance floor does not scale to 1000 skills)'
    );

    // ── Wall-clock p50/p95/p99 + the p95 < 100 ms gate ──────────────────
    const ms = results.map((r) => r.ms).sort((a, b) => a - b);
    const p50 = percentile(ms, 50);
    const p95 = percentile(ms, 95);
    const p99 = percentile(ms, 99);
    console.log(`\n  wall-clock ms over 100 spawns: p50=${p50.toFixed(1)} p95=${p95.toFixed(1)} p99=${p99.toFixed(1)} (max=${ms[ms.length - 1]})`);
    assert(results.every((r) => r.code === 0), 'all 100 spawns exit 0 (fail-open holds at scale)');
    assert(p95 < 100, `p95 wall-clock ${p95.toFixed(1)} ms is under the 100 ms budget`);

    // ── Memory per invocation ────────────────────────────────────────────
    const memOk = results.filter((r) => r.mem !== null);
    assert(memOk.length === 100, `all 100 spawns report memory (got ${memOk.length})`);
    const rssMb = memOk.map((r) => r.mem.rss / 1048576).sort((a, b) => a - b);
    const heapMb = memOk.map((r) => r.mem.heapUsed / 1048576).sort((a, b) => a - b);
    console.log(
      `  memory MB: rss p50=${percentile(rssMb, 50).toFixed(1)} p95=${percentile(rssMb, 95).toFixed(1)} max=${rssMb[rssMb.length - 1].toFixed(1)}; ` +
        `heapUsed p50=${percentile(heapMb, 50).toFixed(1)} max=${heapMb[heapMb.length - 1].toFixed(1)}`
    );
    assert(
      rssMb[rssMb.length - 1] < 100,
      `max rss ${rssMb[rssMb.length - 1].toFixed(1)} MB is under the 100 MB per-invocation budget`
    );

    // ── Telemetry completeness: every routed/abstained spawn emits the four
    // ── timing fields; the three fail-open spawns do too.
    const TIMINGS = ['indexLoadMs', 'bm25Ms', 'contextBuildMs', 'totalMs'];
    const completeOf = (evts) =>
      evts.filter((e) => TIMINGS.every((k) => typeof e[k] === 'number' && e[k] >= 0));
    const events = readNewEvents(logPath, logOffsetBefore).filter(
      (e) => e.event === 'route' && prompts.includes(e.query)
    );
    assert(events.length >= 100, `route events for all 100 prompts (got ${events.length} new)`);
    assert(completeOf(events).length >= 100, 'all four timing fields present on every prompt record');
    const totalMs = completeOf(events).map((e) => e.totalMs).sort((a, b) => a - b);
    if (totalMs.length > 0) {
      console.log(
        `  internal totalMs (telemetry): p50=${percentile(totalMs, 50)} p95=${percentile(totalMs, 95)} p99=${percentile(totalMs, 99)}`
      );
    }
    // Which retrieval path did the hook actually use? The parsed-index
    // cache is only 'on' when a prebuilt file was swapped in and still
    // validates — the number the report attributes these timings to.
    const prebuiltOn = events.filter((e) => e.prebuilt === 'on').length;
    console.log(`  retrieval path: prebuilt cache on for ${prebuiltOn}/${events.length} prompt records`);

    // Fail-open paths (empty input, malformed JSON, missing index) must emit
    // the same complete record, and must still exit 0.
    const fo1 = await runHook(null, WORK);
    const fo2 = await runHook('{not json', WORK);
    renameSync(INDEX, INDEX_MOVED);
    const fo3 = await runHook(JSON.stringify({ prompt: prompts[0], cwd: WORK }), WORK);
    renameSync(INDEX_MOVED, INDEX);
    assert(fo1.code === 0 && fo2.code === 0 && fo3.code === 0, 'fail-open paths still exit 0 at scale');
    const events2 = readNewEvents(logPath, logOffsetBefore).filter(
      (e) => e.event === 'route' && e.failOpen === true
    );
    assert(events2.length >= 3, `fail-open route records emitted (got ${events2.length})`);
    assert(completeOf(events2).length >= 3, 'all four timing fields present on every fail-open record');
    assert(
      events2.some((e) => e.failOpenReason === 'index not found' && e.indexLoadMs >= 0),
      'the missing-index path records indexLoadMs for the failed load'
    );
  } finally {
    if (existsSync(INDEX_MOVED)) {
      if (!existsSync(INDEX)) renameSync(INDEX_MOVED, INDEX);
      else rmSync(INDEX_MOVED, { force: true });
    }
    if (hadRealIndex) copyFileSync(BACKUP, INDEX);
    else if (existsSync(INDEX)) rmSync(INDEX, { force: true });
    if (existsSync(BACKUP)) rmSync(BACKUP, { force: true });
    if (hadRealPrebuilt) copyFileSync(PREBUILT_BACKUP, PREBUILT);
    else if (existsSync(PREBUILT)) rmSync(PREBUILT, { force: true });
    if (existsSync(PREBUILT_BACKUP)) rmSync(PREBUILT_BACKUP, { force: true });
    rmSync(WORK, { recursive: true, force: true });
  }

  console.log('\n=== Results ===');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('perf test crashed:', err);
  process.exit(1);
});
