/**
 * Analytics report generator.
 *
 * Produces a human-readable markdown report from an AnalyticsReport object.
 */

/**
 * Format an analytics report as a markdown string.
 *
 * @param {AnalyticsReport} analytics
 * @returns {string} Markdown report
 */
export function report(analytics) {
  const lines = [];

  lines.push('# Skill Router — Usage Analytics Report');
  lines.push('');
  lines.push(`**Generated:** ${analytics.analyzedAt}`);
  lines.push('');

  // ── Summary ───────────────────────────────────────────────────────────────
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total retrieval requests | ${analytics.totalRequests} |`);
  lines.push(`| Total index builds | ${analytics.totalBuilds} |`);
  lines.push(`| Total errors | ${analytics.totalErrors} |`);
  lines.push(`| Overall fallback rate | ${(analytics.overallFallbackRate * 100).toFixed(2)}% |`);
  lines.push(`| Overall median latency | ${analytics.overallMedianLatency} ms |`);
  lines.push('');

  // ── Per-day histogram ─────────────────────────────────────────────────────
  lines.push('## Retrieval Activity (Per Day)');
  lines.push('');
  lines.push('| Day | Requests |');
  lines.push('|-----|----------|');
  const sortedDays = Object.keys(analytics.perDayHistogram).sort();
  for (const day of sortedDays) {
    lines.push(`| ${day} | ${analytics.perDayHistogram[day]} |`);
  }
  lines.push('');

  // ── Fallback rate over time ───────────────────────────────────────────────
  lines.push('## Fallback Rate Over Time');
  lines.push('');
  lines.push('| Day | Fallback Rate |');
  lines.push('|-----|---------------|');
  for (const day of sortedDays) {
    const rate = analytics.fallbackRateOverTime[day] ?? 0;
    lines.push(`| ${day} | ${(rate * 100).toFixed(2)}% |`);
  }
  lines.push('');

  // ── Median latency trend ──────────────────────────────────────────────────
  lines.push('## Median Latency Trend');
  lines.push('');
  lines.push('| Day | Median Latency (ms) |');
  lines.push('|-----|---------------------|');
  for (const day of sortedDays) {
    const median = analytics.medianLatencyTrend[day] ?? 0;
    lines.push(`| ${day} | ${median} |`);
  }
  lines.push('');

  // ── Top-10 skills ─────────────────────────────────────────────────────────
  lines.push('## Top-10 Most Recommended Skills');
  lines.push('');
  if (analytics.top10Skills.length === 0) {
    lines.push('_No skill recommendations found in logs._');
  } else {
    lines.push('| # | Skill | Appearances |');
    lines.push('|---|-------|-------------|');
    for (let i = 0; i < analytics.top10Skills.length; i++) {
      const skill = analytics.top10Skills[i];
      lines.push(`| ${i + 1} | ${skill.name} | ${skill.count} |`);
    }
  }
  lines.push('');

  // ── Common prompt hashes ──────────────────────────────────────────────────
  lines.push('## Common Prompt Hashes (Top-10)');
  lines.push('');
  lines.push('> **Privacy note:** Raw prompts are never stored or displayed. Only SHA-256 hashes are shown.');
  lines.push('');
  lines.push('| # | Prompt Hash (SHA-256) | Frequency |');
  lines.push('|---|-----------------------|-----------|');
  for (let i = 0; i < analytics.commonPromptHashes.length; i++) {
    const item = analytics.commonPromptHashes[i];
    lines.push(`| ${i + 1} | \`${item.hash}\` | ${item.count} |`);
  }
  lines.push('');

  // ── Source Distribution ───────────────────────────────────────────────────
  lines.push('## Source Distribution');
  lines.push('');
  if (!analytics.sourceBreakdown || Object.keys(analytics.sourceBreakdown.bySource).length === 0) {
    lines.push('_No source data available._');
  } else {
    lines.push('### Skills by Source');
    lines.push('');
    lines.push('| Source | Skill Count | Recommendation Share |');
    lines.push('|--------|-------------|----------------------|');
    for (const [source, count] of Object.entries(analytics.sourceBreakdown.bySource)) {
      const share = analytics.sourceBreakdown.recommendationShare[source] ?? 0;
      lines.push(`| ${source} | ${count} | ${(share * 100).toFixed(1)}% |`);
    }
  }
  lines.push('');

  // ── Cache Performance ─────────────────────────────────────────────────────
  lines.push('## Cache Performance');
  lines.push('');
  if (!analytics.cacheHitRateTrend || analytics.cacheHitRateTrend.length === 0) {
    lines.push('_No cache data available._');
  } else {
    lines.push('| Day | Cache Hits | Cache Misses | Hit Rate |');
    lines.push('|-----|------------|--------------|----------|');
    for (const row of analytics.cacheHitRateTrend) {
      lines.push(`| ${row.day} | ${row.hits} | ${row.misses} | ${(row.hitRate * 100).toFixed(2)}% |`);
    }

    // Trend indicator
    if (analytics.cacheHitRateTrend.length >= 2) {
      const firstRate = analytics.cacheHitRateTrend[0].hitRate;
      const lastRate = analytics.cacheHitRateTrend[analytics.cacheHitRateTrend.length - 1].hitRate;
      const diff = lastRate - firstRate;
      let trend = 'stable';
      if (diff > 0.05) trend = 'improving ↑';
      else if (diff < -0.05) trend = 'decreasing ↓';
      lines.push('');
      lines.push(`**Trend:** ${trend} (first: ${(firstRate * 100).toFixed(2)}% → last: ${(lastRate * 100).toFixed(2)}%)`);
    }
  }
  lines.push('');

  // ── Sync Health ───────────────────────────────────────────────────────────
  lines.push('## Sync Health');
  lines.push('');
  if (!analytics.syncHistory) {
    lines.push('_No sync state found. Run `skill-router sync` to initialize._');
  } else {
    lines.push(`| Field | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| Last sync | ${analytics.syncHistory.lastSyncAt || 'never'} |`);
    lines.push(`| Mirror path | \`${analytics.syncHistory.mirrorPath || 'N/A'}\` |`);
    lines.push(`| Synced skills | ${analytics.syncHistory.skillCount} |`);

    if (analytics.syncHistory.skills && analytics.syncHistory.skills.length > 0) {
      lines.push('');
      lines.push('### Recent Synced Skills (last 10)');
      lines.push('');
      lines.push('| # | Skill | Synced At |');
      lines.push('|---|-------|-----------|');
      const recent = analytics.syncHistory.skills
        .sort((a, b) => new Date(b.syncedAt) - new Date(a.syncedAt))
        .slice(0, 10);
      for (let i = 0; i < recent.length; i++) {
        lines.push(`| ${i + 1} | ${recent[i].name} | ${recent[i].syncedAt} |`);
      }
    }
  }
  lines.push('');

  return lines.join('\n');
}
