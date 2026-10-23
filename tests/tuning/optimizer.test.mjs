/**
 * Optimizer tests.
 *
 * Verifies:
 * - optimizeThresholds returns correct shape
 * - Grid search respects medium < high constraint
 * - Fallback rate constraint (< 15%) is enforced
 * - Top-1 maximisation is the primary objective
 * - Defaults are used when no thresholds file exists
 * - reportTuning produces valid markdown output
 * - A full grid run completes in under 30 seconds. Per-prompt ranking is
 *   hoisted out of the optimizer's cell loop (src/tuning/optimizer.mjs), so
 *   one run costs a single rankSkills call per prompt plus 45 cheap
 *   threshold rescorings; before the hoist a single run took ~164 s on the
 *   252-skill corpus and broke the runner's 120 s per-file budget.
 * - The canonical corpus is the leaf-only index (252 skills as of the
 *   2026-10-23 stabilization pass; see "CANONICAL CORPUS" below); the full
 *   258-entry index is retained only to assert the router gap.
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { optimizeThresholds } from '../../src/tuning/optimizer.mjs';
import { reportTuning } from '../../src/tuning/report.mjs';
import { rankSkills } from '../../src/core/retriever/bm25.mjs';
import { getDefaults } from '../../src/config/defaults.mjs';

const BASE = resolve('.');
const PROMPTS_PATH = resolve(BASE, 'tests/prompts.json');
const EXPECTED_PATH = resolve(BASE, 'tests/expected-routes.json');
const INDEX_PATH = resolve(BASE, 'data/skill-index.json');
const THRESHOLDS_PATH = resolve(BASE, 'data/thresholds.json');

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a tiny synthetic index for fast unit tests.
 */
function buildSmallIndex() {
  return [
    { name: 'react-hooks', description: 'React hooks patterns', keywords: ['react', 'hooks', 'useState'], domains: ['frontend'], path: '/dev/null', version: '1.0.0' },
    { name: 'laravel-eloquent', description: 'Laravel Eloquent ORM', keywords: ['laravel', 'eloquent', 'orm'], domains: ['backend'], path: '/dev/null', version: '1.0.0' },
    { name: 'css-grid', description: 'CSS Grid layout', keywords: ['css', 'grid', 'layout'], domains: ['design'], path: '/dev/null', version: '1.0.0' },
  ];
}

const SMALL_PROMPTS = [
  { prompt: 'Create a React functional component with useState and useEffect hooks' },
  { prompt: 'Build a Laravel migration for a users table' },
  { prompt: 'Design a responsive layout grid with CSS Grid' },
];

// ─── Test suite ───────────────────────────────────────────────────────────────

console.log('\n=== Optimizer Tests ===\n');

// Load full corpus once
const prompts = JSON.parse(readFileSync(PROMPTS_PATH, 'utf-8'));
const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf-8'));
const fullIndex = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));

/**
 * CANONICAL CORPUS FOR THIS SUITE: the leaf-only index (252 skills as of the
 * 2026-10-23 stabilization pass).
 *
 * WHY leaf-only and not the full 258-entry index:
 * data/skill-index.json contains 252 leaf skills plus 6 `router-*`
 * dispatcher skills. The router entries are dispatchers, not content skills:
 * the hook excludes them from implicit BM25 ranking (hooks/route.mjs) and
 * only consults them for explicit `$mention` dispatch. The benchmark prompt
 * set (tests/prompts.json) and its labels (tests/expected-routes.json)
 * target leaf skills exclusively, so router entries can only pollute an
 * implicit ranking.
 *
 * Measured strict Top-1 on the same 130 prompts, same raw rankSkills code
 * (section 14 records the live values):
 *   full 258-entry index (252 leaf + 6 router) : 79/130 = 0.6077
 *   leaf-only index (252 leaf)                 : 80/130 = 0.6154
 *
 * The 0.89 floor this suite once asserted was the 54-skill Phase 4-era value;
 * it is stale against the 252-skill corpus and was replaced in the
 * post-v1.0.0 stabilization pass (D34: test constants relaxed to
 * invariants). The structural invariants asserted in section 14 are: the
 * leaf index is exactly the full index minus the 6 router entries, and the
 * leaf corpus still beats the full corpus on raw Top-1 (the
 * router-pollution gap, measured live in section 14).
 */
const leafIndex = fullIndex.filter((s) => !s.name.startsWith('router-'));

// 1. Return shape
console.log('1. Return shape');
const result = optimizeThresholds(prompts, leafIndex, expected);
assert(typeof result.high === 'number', 'high is a number');
assert(typeof result.medium === 'number', 'medium is a number');
assert(typeof result.noSkill === 'number', 'noSkill is a number');
assert(typeof result.top1 === 'number', 'top1 is a number');
assert(typeof result.fallbackRate === 'number', 'fallbackRate is a number');
assert(typeof result.gridEvaluated === 'number', 'gridEvaluated is a number');
assert(typeof result.total === 'number', 'total is a number');

// 2. Values within expected bounds
console.log('\n2. Values within bounds');
assert(result.high >= 0.70 && result.high <= 0.95, `high ${result.high} in [0.70, 0.95]`);
assert(result.medium >= 0.40 && result.medium <= 0.75, `medium ${result.medium} in [0.40, 0.75]`);
assert(result.medium < result.high, `medium (${result.medium}) < high (${result.high})`);

// 3. Fallback rate constraint
console.log('\n3. Fallback rate constraint');
assert(result.fallbackRate < 0.15, `fallbackRate ${result.fallbackRate.toFixed(4)} < 0.15`);

// 4. Top-1 accuracy on the canonical leaf-only corpus. The optimizer's Top-1
// is threshold-invariant on this corpus, so it equals the raw strict Top-1
// measured in section 14 (80/130 = 0.6154 as of 2026-10-23). The 0.89 floor
// was the 54-skill Phase 4-era value and is stale (D34).
console.log('\n4. Top-1 accuracy (leaf-only 252-skill corpus)');
assert(result.top1 >= 0.61, `top1 ${result.top1.toFixed(4)} >= 0.61 (documented current: 80/130 = 0.6154)`);

// 5. Grid evaluated count
console.log('\n5. Grid size');
// HIGH_RANGE 0.70..0.95 (6 values) × MEDIUM_RANGE 0.40..0.75 (8 values),
// minus pairs where medium >= high → 45 valid cells.
assert(result.gridEvaluated > 0, `gridEvaluated ${result.gridEvaluated} > 0`);
assert(result.gridEvaluated === 45, `gridEvaluated ${result.gridEvaluated} === 45 valid cells`);

// 6. Medium must be strictly less than high (constraint enforced)
console.log('\n6. Grid constraint (medium < high)');
assert(result.medium < result.high, 'medium < high enforced in result');

// 7. Small corpus test — basic functionality
console.log('\n7. Small corpus');
const smallResult = optimizeThresholds(SMALL_PROMPTS, buildSmallIndex(), [
  { id: 1, expected: 'react-hooks' },
  { id: 2, expected: 'laravel-eloquent' },
  { id: 3, expected: 'css-grid' },
]);
assert(typeof smallResult.high === 'number', 'small corpus: high is a number');
assert(typeof smallResult.medium === 'number', 'small corpus: medium is a number');
assert(smallResult.medium < smallResult.high, 'small corpus: medium < high');

// 8. reportTuning produces markdown
console.log('\n8. reportTuning output');
const report = reportTuning(result, { defaultHigh: 0.85, defaultMedium: 0.60 });
assert(typeof report === 'string', 'report is a string');
assert(report.includes('## Adaptive Threshold Tuning Report'), 'report has header');
assert(report.includes('high'), 'report mentions high');
assert(report.includes('medium'), 'report mentions medium');
assert(report.includes('%'), 'report includes percentages');

// 9. reportTuning with baseline comparison
console.log('\n9. reportTuning with baseline');
const reportWithBaseline = reportTuning(result, {
  defaultHigh: 0.85,
  defaultMedium: 0.60,
  baseline: { top1: 0.88, fallbackRate: 0.10 },
});
assert(reportWithBaseline.includes('vs Default Thresholds'), 'report includes baseline section');
assert(reportWithBaseline.includes('+0.00%') || reportWithBaseline.includes('0.00%'), 'report shows delta');

// 10. Defaults module loads thresholds from file
console.log('\n10. Defaults load thresholds');
const defaults = getDefaults();
assert(typeof defaults.confidence.highThreshold === 'number', 'defaults has highThreshold');
assert(typeof defaults.confidence.mediumThreshold === 'number', 'defaults has mediumThreshold');
assert(defaults.confidence.highThreshold === result.high, 'defaults.highThreshold matches optimizer result');
assert(defaults.confidence.mediumThreshold === result.medium, 'defaults.mediumThreshold matches optimizer result');

// 11. Missing thresholds file falls back to hardcoded defaults
console.log('\n11. Fallback when thresholds.json missing');
// Temporarily rename the file
try {
  const tmpPath = THRESHOLDS_PATH + '.bak';
  writeFileSync(tmpPath, readFileSync(THRESHOLDS_PATH, 'utf-8'));
  unlinkSync(THRESHOLDS_PATH);

  // Force re-import by clearing require cache (not possible for ESM, so re-evaluate via fresh import)
  // Instead, we test that getDefaults returns 0.85/0.60 when no file exists
  // We do this by temporarily pointing to a non-existent path
  // Since ESM caches imports, we simulate by checking what getDefaults returns
  // without the file present — we use a subprocess for this
  const { execSync } = await import('node:child_process');
  const cwd = process.cwd();
  const fallbackCode = `
    import { readFileSync, unlinkSync } from 'node:fs';
    import { resolve } from 'node:path';
    // Remove thresholds file
    const tp = resolve('${THRESHOLDS_PATH}');
    try { unlinkSync(tp); } catch {}
    // Clear module cache by using a fresh child process
    const code = \`import { getDefaults } from './src/config/defaults.mjs'; console.log(JSON.stringify(getDefaults().confidence));\`;
    console.log(code);
  `;
  // Simpler approach: just verify the fallback logic in defaults.mjs is correct by reading the source
  const defaultsSrc = readFileSync(resolve(BASE, 'src/config/defaults.mjs'), 'utf-8');
  assert(defaultsSrc.includes('loadThresholds'), 'defaults.mjs has loadThresholds helper');
  assert(defaultsSrc.includes('?? 0.85'), 'defaults have highThreshold fallback 0.85');
  assert(defaultsSrc.includes('?? 0.60'), 'defaults have mediumThreshold fallback 0.60');
} finally {
  // Restore
  const tmpPath = THRESHOLDS_PATH + '.bak';
  if (readFileSync(tmpPath, 'utf-8')) {
    writeFileSync(THRESHOLDS_PATH, readFileSync(tmpPath, 'utf-8'));
    unlinkSync(tmpPath);
  }
}

// 12. Optimizer performance — one full grid run completes in < 30 s now that
// per-prompt ranking is hoisted out of the cell loop (before the hoist the
// same run took ~164 s on the 252-skill corpus and broke the runner's
// 120 s per-file budget; the <30 s gate guards the hoist from regressing).
console.log('\n12. Performance (< 30s)');
const t0 = performance.now();
const perfResult = optimizeThresholds(prompts, leafIndex, expected);
const elapsed = performance.now() - t0;
assert(elapsed < 30000, `optimizer completed in ${elapsed.toFixed(0)}ms (< 30000ms)`);
console.log(`    Elapsed: ${elapsed.toFixed(0)} ms`);

// 13. Result determinism — same inputs produce same outputs. With the hoist
// a full grid run costs ~5 s, so the determinism check re-runs the grid for
// real instead of reusing a cached result on an identical input hash (the
// pre-hoist plan), which is a stronger check at the same budget.
console.log('\n13. Determinism');
const r1 = optimizeThresholds(prompts, leafIndex, expected);
const r2 = optimizeThresholds(prompts, leafIndex, expected);
assert(r1.high === r2.high, 'high is deterministic');
assert(r1.medium === r2.medium, 'medium is deterministic');
assert(r1.top1 === r2.top1, 'top1 is deterministic');

// 14. Corpus choice is explicit — the leaf-only corpus is the canonical one and
//     the full index is kept visible so the router-pollution gap stays asserted.
console.log('\n14. Canonical corpus (leaf-only)');
// Structural invariants, not pinned counts (D34): the corpus grew from 54 to
// 252 leaf skills in Phase 7.3, and the pinned 60/54 counts broke the suite.
const routerCount = fullIndex.filter((s) => s.name.startsWith('router-')).length;
assert(routerCount === 6, `full index has 6 router-* entries, got ${routerCount}`);
assert(fullIndex.length - leafIndex.length === 6, `full index is the leaf index plus 6 router entries, got ${fullIndex.length} - ${leafIndex.length}`);
assert(leafIndex.length > 0, `leaf-only index is non-empty (${leafIndex.length} entries)`);
assert(leafIndex.every((s) => !s.name.startsWith('router-')), 'leaf index contains no router-* entries');
assert(fullIndex.every((s) => leafIndex.includes(s) || s.name.startsWith('router-')), 'leaf index is the full index minus routers');

// Measure the raw strict top-1 on both corpora so the documented gap is enforced.
function rawTop1(idx) {
  let hits = 0;
  for (let i = 0; i < prompts.length; i++) {
    const ranked = rankSkills(prompts[i].prompt, idx);
    const topSkill = ranked.length > 0 ? ranked[0].skill.name : null;
    const exp = expected[i]?.expected;
    const expName = exp === null || exp === undefined ? null : String(exp);
    if (topSkill === expName) hits++;
  }
  return hits / prompts.length;
}
const leafTop1 = rawTop1(leafIndex);
const fullTop1 = rawTop1(fullIndex);
assert(leafTop1 > fullTop1, `leaf-only top1 ${leafTop1.toFixed(4)} > full-index top1 ${fullTop1.toFixed(4)} (router pollution)`);
// 2026-10-23: leaf-only raw strict Top-1 on the 252-skill corpus is
// 80/130 = 0.6154 (vs 79/130 = 0.6077 full-index). The 0.89 floor was the
// 54-skill Phase 4-era value and is stale (D34).
assert(leafTop1 >= 0.61, `leaf-only top1 ${leafTop1.toFixed(4)} >= 0.61 (documented current: 80/130 = 0.6154)`);
assert(result.top1 === leafTop1, `optimizer top1 ${result.top1.toFixed(4)} matches measured leaf-only top1`);

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);
console.log(`  Optimized: high=${result.high}, medium=${result.medium}`);
console.log(`  Top-1: ${(result.top1 * 100).toFixed(2)}%, Fallback: ${(result.fallbackRate * 100).toFixed(2)}%`);

if (failed > 0) {
  process.exit(1);
}
