/**
 * Console rendering for the benchmark harness (tests/run-benchmark.mjs).
 *
 * Kept out of the harness so the harness stays readable and under the
 * 300-line cap. The output is the per-prompt table plus the summary block that
 * the Phase reports quote; nothing here computes a metric.
 *
 * @module tests/benchmark/report
 */

const WIDTH = 80;

/**
 * Render the benchmark run to stdout.
 *
 * @param {object} run
 * @param {string} run.date — report date (YYYY-MM-DD)
 * @param {string} run.corpusLabel
 * @param {string} run.mode
 * @param {string} run.provider
 * @param {string} run.rerank
 * @param {string} run.expand
 * @param {number} run.indexSize
 * @param {Array<object>} run.results — per-prompt rows
 * @param {string} run.top1
 * @param {number} run.top1Hits
 * @param {string} run.recallAt3
 * @param {number} run.recallAt3Total
 * @param {object} run.setSummary — from summarizeSetRecall()
 * @param {number} run.medianLatency
 * @param {number} run.p95Latency
 * @param {string} run.noSkillRate
 * @param {number} run.noSkillCount
 * @param {string[]} run.degradeEvents
 * @param {object} run.cacheStats — from QueryCache.getStats()
 * @returns {void}
 */
export function printReport(run) {
  const total = run.results.length;
  const label =
    run.mode === 'hybrid' && run.rerank === 'off' ? 'hybrid (no-rerank)' : run.mode;
  const expandLabel = run.expand === 'on' ? 'expand:on' : 'expand:off';

  console.log('');
  console.log('='.repeat(WIDTH));
  console.log(
    `  SKILL ROUTER BENCHMARK — ${run.date} [corpus: ${run.corpusLabel}, ` +
      `mode: ${label}, provider: ${run.provider}, rerank: ${run.rerank}, expand: ${expandLabel}]`
  );
  console.log('='.repeat(WIDTH));
  console.log(`  Index size: ${run.indexSize} skills`);
  console.log('');
  console.log('  Prompt                                              | Expected           | Top-1        | Score   | Lat(ms)');
  console.log('  ' + '-'.repeat(76));
  for (const r of run.results) {
    const match =
      r.expected === r.topSkill ||
      (r.expected === null && (r.topSkill === null || r.topScore < 0.01))
        ? 'YES'
        : 'NO ';
    console.log(
      `  ${r.prompt.slice(0, 45).padEnd(45)} | ${String(r.expected).padEnd(16)} | ` +
        `${match.padEnd(10)} | ${r.topScore.toFixed(3).padStart(6)} | ${String(r.latency_ms).padStart(7)}`
    );
  }
  console.log('');
  console.log('='.repeat(WIDTH));
  console.log('  SUMMARY');
  console.log('='.repeat(WIDTH));
  console.log(`  Top-1 Accuracy:    ${run.top1}  (${run.top1Hits}/${total})`);
  console.log(`  Recall@3:          ${run.recallAt3}  (${run.recallAt3Total}/${total})`);
  console.log(
    `  Set Recall@5:      ${run.setSummary.setRecall}  (all prompts; ` +
      `skill prompts only ${run.setSummary.setRecallSkillPrompts} = ` +
      `${run.setSummary.skillHits}/${run.setSummary.skillPrompts})`
  );
  console.log(
    `  Abstained Right:   ${run.setSummary.negativeHits}/${run.setSummary.negativePrompts}  (negative prompts)`
  );
  console.log(`  Median Latency:    ${run.medianLatency} ms`);
  console.log(`  P95 Latency:       ${run.p95Latency} ms`);
  console.log(`  No-Skill Rate:     ${run.noSkillRate}  (${run.noSkillCount}/${total})`);
  if (run.degradeEvents.length > 0) {
    console.log(`  Provider Fallbacks: ${run.degradeEvents.length}`);
    for (const msg of new Set(run.degradeEvents)) console.log(`    - ${msg}`);
  }
  console.log(`  Cache Hits:        ${run.cacheStats.hits}`);
  console.log(`  Cache Misses:      ${run.cacheStats.misses}`);
  console.log(`  Cache Hit Rate:    ${run.cacheStats.hitRate.toFixed(4)}`);
  console.log(`  Cache Size:        ${run.cacheStats.total}`);
  console.log('='.repeat(WIDTH));
  console.log('');
}
