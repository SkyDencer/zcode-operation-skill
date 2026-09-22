/**
 * Metrics reporter module — human-readable output for telemetry data.
 *
 * Formats snapshots and benchmark results into markdown tables.
 */

/**
 * Format a metrics snapshot as a human-readable markdown string.
 *
 * @param {object} snapshot — from metrics.getSnapshot()
 * @returns {string}
 */
export function reportMetrics(snapshot) {
  const lines = ['## Metrics Snapshot', ''];
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  for (const [name, value] of Object.entries(snapshot.counters || {})) {
    lines.push(`| ${name} | ${value} |`);
  }
  for (const [name, stats] of Object.entries(snapshot.timings || {})) {
    lines.push(`| ${name} (ms) mean | ${stats.mean.toFixed(2)} |`);
    lines.push(`| ${name} (ms) p50 | ${stats.median.toFixed(2)} |`);
    lines.push(`| ${name} (ms) p95 | ${stats.p95?.toFixed(2) ?? stats.max.toFixed(2)} |`);
    lines.push(`| ${name} (ms) count | ${stats.count} |`);
  }
  return lines.join('\n');
}

/**
 * Format benchmark results as a markdown table.
 *
 * @param {Array<{id:number, prompt:string, expected:string, topSkill:string, latency_ms:number}>} results
 * @returns {string}
 */
export function reportBenchmark(results) {
  const lines = ['## Benchmark Results', ''];
  lines.push('| # | Prompt | Expected | Top-1 | Lat(ms) |');
  lines.push('|---|--------|----------|-------|---------|');
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const match = r.topSkill === r.expected ? '✓' : '✗';
    lines.push(`| ${i + 1} | ${r.prompt.slice(0, 35)} | ${r.expected} | ${match} | ${r.latency_ms} |`);
  }
  return lines.join('\n');
}
