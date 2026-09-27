/**
 * Scale threshold guard — Sub-Phase 7.5.
 *
 * Asserts that the tuned thresholds in data/thresholds.json (produced by the
 * optimizer run on the Sub-Phase 7.4 "500-skill corpus") do not regress below
 * the frozen baseline recorded in data/baseline.json, whose guardrail
 * thresholds are re-derived from that baseline.
 *
 * The check is deliberately cheap and deterministic:
 *   - Section 1/2 validate the two data files against each other and against
 *     the guardrail bounds pinned in baseline.guardrails (no retrieval at all).
 *   - Section 3 re-measures the scale-ceiling accuracy (247-skill stratified
 *     sample of the 252-leaf corpus, 204 scale prompts) with the same loop
 *     as tests/scale-benchmark/runner.mjs and floors it at the frozen
 *     baseline.scale figures.
 *   - Section 4 re-measures the frozen 130-prompt BM25 benchmark figure on
 *     the full index and floors it at baseline.benchmark.top1.
 *
 * No optimizer grid search is re-run here: on this corpus the optimizer's
 * objective is threshold-invariant (top-1 hit/miss is decided by BM25
 * ranking, not by the band thresholds, because normalized top scores are
 * 1.0 or 0.0 — see docs/reports/phase-7.5-scale-analysis.md), so re-running
 * the 45-cell grid would cost ~5 minutes and add no new decision. The
 * guard instead verifies the *outcome* of the tuning run: that the shipped
 * thresholds sit inside the guardrail bounds and that the measured accuracy
 * still meets the frozen floors.
 *
 * Usage: node tests/tuning/scale-guard.test.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rankSkills } from '../../src/core/retriever/bm25.mjs';
import { sampleCorpus } from '../scale-benchmark/corpus-sampler.mjs';
import { gradePrompt } from '../benchmark/metrics.mjs';

const BASE = resolve('.');
const THRESHOLDS_PATH = resolve(BASE, 'data/thresholds.json');
const BASELINE_PATH = resolve(BASE, 'data/baseline.json');
const INDEX_PATH = resolve(BASE, 'data/skill-index.json');
const SCALE_PROMPTS_PATH = resolve(BASE, 'tests/scale-benchmark/prompts.json');
const SCALE_EXPECTED_PATH = resolve(BASE, 'tests/scale-benchmark/expected.json');
const BENCH_PROMPTS_PATH = resolve(BASE, 'tests/prompts.json');
const BENCH_EXPECTED_PATH = resolve(BASE, 'tests/expected-routes.json');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log('  ok', message);
  } else {
    failed++;
    console.error('  FAIL', message);
  }
}

// ── 1. Data files exist and agree ────────────────────────────────────────────
console.log('\n=== Scale Threshold Guard (7.5) ===\n');
console.log('1. Tuned thresholds vs frozen baseline');

const thresholds = JSON.parse(readFileSync(THRESHOLDS_PATH, 'utf-8'));
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));

assert(typeof thresholds.high === 'number', 'thresholds.json has numeric high');
assert(typeof thresholds.medium === 'number', 'thresholds.json has numeric medium');
assert(thresholds.medium < thresholds.high, `medium (${thresholds.medium}) < high (${thresholds.high})`);
assert(typeof baseline.benchmark?.top1 === 'number', 'baseline.json has benchmark.top1 (guardrail floor source)');
assert(typeof baseline.guardrails?.maxFallbackRate === 'number', 'baseline.json has guardrails.maxFallbackRate');
assert(typeof baseline.scale?.top1 === 'number', 'baseline.json has scale.top1 (frozen scale-ceiling figure)');
assert(
  thresholds.high === baseline.thresholds?.high && thresholds.medium === baseline.thresholds?.medium,
  'tuned thresholds equal the baseline threshold block (re-derived from this run)'
);

// ── 2. Thresholds inside the guardrail bounds ───────────────────────────────
console.log('\n2. Guardrail bounds');

const hiBounds = baseline.guardrails.thresholdBounds?.high;
const medBounds = baseline.guardrails.thresholdBounds?.medium;
assert(Array.isArray(hiBounds) && hiBounds.length === 2, 'guardrails pin high-threshold bounds [min, max]');
assert(Array.isArray(medBounds) && medBounds.length === 2, 'guardrails pin medium-threshold bounds [min, max]');
if (hiBounds && medBounds) {
  assert(thresholds.high >= hiBounds[0] && thresholds.high <= hiBounds[1],
    `high ${thresholds.high} within pinned bounds [${hiBounds[0]}, ${hiBounds[1]}]`);
  assert(thresholds.medium >= medBounds[0] && thresholds.medium <= medBounds[1],
    `medium ${thresholds.medium} within pinned bounds [${medBounds[0]}, ${medBounds[1]}]`);
}
assert(
  (thresholds.benchmark?.fallbackRate ?? Infinity) <= baseline.guardrails.maxFallbackRate,
  `tuned fallback rate ${thresholds.benchmark?.fallbackRate} <= maxFallbackRate ${baseline.guardrails.maxFallbackRate}`
);

// ── 3. Scale-ceiling re-measurement (247-skill sample, 204 prompts) ──────────
console.log('\n3. Scale-ceiling re-measurement (no regression below baseline.scale)');

const fullIndex = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
const leaves = fullIndex.filter((s) => !s.name.startsWith('router-'));
const sample = sampleCorpus(leaves, 500, 42);
assert(sample.length === baseline.scale?.skillsSampled,
  `sampled corpus matches frozen size (${sample.length} skills, seed 42, target 500)`);

const scalePrompts = JSON.parse(readFileSync(SCALE_PROMPTS_PATH, 'utf-8'));
const scaleExpected = JSON.parse(readFileSync(SCALE_EXPECTED_PATH, 'utf-8'));
const expectedMap = new Map(scaleExpected.map((e) => [e.id, e.expected]));

let top1Hits = 0;
let recall3Hits = 0;
let setRecallHits = 0;
let fallbackCount = 0;
for (const p of scalePrompts) {
  const ranked = rankSkills(p.prompt, sample);
  const topSkill = ranked.length > 0 ? ranked[0].skill.name : null;
  const top3Names = ranked.slice(0, 3).map((r) => r.skill.name);
  const topScore = ranked.length > 0 ? (ranked[0].score ?? 0) : 0;
  const expRaw = expectedMap.get(p.id);
  const expName = expRaw === null || expRaw === undefined ? null : String(expRaw);

  if (topSkill === expName) top1Hits++;
  if (expName && top3Names.includes(expName)) recall3Hits++;
  const isNoSkill = ranked.length === 0 || topScore < 0.01;
  const grade = gradePrompt(expName, top3Names.concat(ranked.slice(3, 5).map((r) => r.skill.name)), isNoSkill, sample);
  if (grade.recall === 1) setRecallHits++;
  // Fallback under the shipped tuned medium threshold, as the hook's
  // confidence policy would classify it (runner.mjs pins 0.60; the guard
  // uses the actual shipped value).
  if (!topSkill || topScore < thresholds.medium) fallbackCount++;
}

const total = scalePrompts.length;
// Round to 4 decimals, the same convention the scale runner stores in
// docs/reports/phase-7-scale-results.json and baseline.json uses.
const top1 = Math.round((top1Hits / total) * 10000) / 10000;
const recall3 = Math.round((recall3Hits / total) * 10000) / 10000;
const setRecall = Math.round((setRecallHits / total) * 10000) / 10000;
const fallbackRate = Math.round((fallbackCount / total) * 10000) / 10000;

assert(top1 === baseline.scale.top1,
  `scale Top-1 ${top1.toFixed(4)} equals frozen baseline.scale.top1 ${baseline.scale.top1}`);
assert(top1 >= baseline.guardrails.minScaleTop1,
  `scale Top-1 ${top1.toFixed(4)} >= guardrail floor ${baseline.guardrails.minScaleTop1}`);
assert(recall3 === baseline.scale.recallAt3,
  `scale Recall@3 ${recall3.toFixed(4)} equals frozen baseline.scale.recallAt3 ${baseline.scale.recallAt3}`);
assert(setRecall === baseline.scale.setRecallAt5,
  `scale Set Recall@5 ${setRecall.toFixed(4)} equals frozen baseline.scale.setRecallAt5 ${baseline.scale.setRecallAt5}`);
assert(setRecall >= baseline.guardrails.minSetRecallScale,
  `scale Set Recall@5 ${setRecall.toFixed(4)} >= guardrail floor ${baseline.guardrails.minSetRecallScale}`);
assert(fallbackRate <= baseline.guardrails.maxFallbackRate,
  `fallback under tuned medium (${thresholds.medium}) = ${fallbackRate.toFixed(4)} <= ${baseline.guardrails.maxFallbackRate}`);

// ── 4. Frozen 130-prompt BM25 benchmark floor ────────────────────────────────
console.log('\n4. Frozen 130-prompt benchmark floor (full index, pure BM25)');

// Counts Top-1 with the exact rule tests/run-benchmark.mjs uses
// (run-benchmark.mjs:173): a hit is either topSkill === expected, or a
// negative prompt (expected null) that the router abstained on — i.e. nothing
// surfaced, or the top score sits below the 0.01 no-skill floor. The 5
// zero-scored negative prompts (ids 121, 124, 128, 129, 130) are decided by
// that clause; a strict name-only count would read 0.6077, not the frozen
// 0.6462.
const benchPrompts = JSON.parse(readFileSync(BENCH_PROMPTS_PATH, 'utf-8'));
const benchExpected = JSON.parse(readFileSync(BENCH_EXPECTED_PATH, 'utf-8'));
const benchMap = new Map(benchExpected.map((e) => [e.id, e.expected]));

let benchHits = 0;
for (const p of benchPrompts) {
  const ranked = rankSkills(p.prompt, fullIndex);
  const topSkill = ranked.length > 0 ? ranked[0].skill.name : null;
  const topScore = ranked.length > 0 ? (ranked[0].score ?? 0) : 0;
  const expRaw = benchMap.get(p.id);
  const expName = expRaw === null || expRaw === undefined ? null : String(expRaw);
  const isNoSkill = ranked.length === 0 || topScore < 0.01;
  if (topSkill === expName || (expName === null && isNoSkill)) benchHits++;
}
const benchTop1 = Math.round((benchHits / benchPrompts.length) * 10000) / 10000;

assert(benchTop1 === baseline.benchmark.top1,
  `130-prompt Top-1 ${benchTop1.toFixed(4)} equals frozen benchmark.top1 ${baseline.benchmark.top1}`);
assert(benchTop1 >= baseline.guardrails.minTop1,
  `130-prompt Top-1 ${benchTop1.toFixed(4)} >= guardrail floor ${baseline.guardrails.minTop1}`);

// ─── Summary ───────────────────────────────────────────────────────────────────

console.log('\n=== Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
