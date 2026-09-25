# Skill Router — Usage Analytics Report (Sample)

**Generated:** 2026-09-23T09:25:29.688Z

## Summary

| Metric | Value |
|--------|-------|
| Total retrieval requests | 426 |
| Total index builds | 101 |
| Total errors | 0 |
| Overall fallback rate | 0.00% |
| Overall median latency | 86 ms |

## Retrieval Activity (Per Day)

| Day | Requests |
|-----|----------|
| 2026-09-22 | 363 |
| 2026-09-23 | 63 |

## Fallback Rate Over Time

| Day | Fallback Rate |
|-----|---------------|
| 2026-09-22 | 0.00% |
| 2026-09-23 | 0.00% |

## Median Latency Trend

| Day | Median Latency (ms) |
|-----|---------------------|
| 2026-09-22 | 87 |
| 2026-09-23 | 83 |

## Top-10 Most Recommended Skills

| # | Skill | Appearances |
|---|-------|-------------|
| 1 | backend-eloquent | 278 |
| 2 | backend-api-resources | 236 |
| 3 | backend-cache | 227 |
| 4 | backend-errors | 227 |
| 5 | backend-events-listeners | 227 |
| 6 | frontend-performance | 139 |
| 7 | frontend-testing | 136 |
| 8 | frontend-patterns | 97 |
| 9 | frontend-forms | 92 |
| 10 | frontend-image-optimization | 53 |

## Common Prompt Hashes (Top-10)

> **Privacy note:** Raw prompts are never stored or displayed. Only SHA-256 hashes are shown.

| # | Prompt Hash (SHA-256) | Frequency |
|---|-----------------------|-----------|
| 1 | `04f8f86af2cd14ffe9bbe8da1518ce9c980ae13fba87feb386b103544e9c4c6b` | 44 |
| 2 | `4f978587f7c6812deabefd0492a81a4a85059d943871fc3c1dbe7000073af378` | 44 |
| 3 | `479ea6ae9572d8269ada53589248fea9a75622a51cbab0e4693a1b5c1adc4bd1` | 44 |
| 4 | `6440ff1616b99f7109761a18f1c38cd44ae08f2d6b15af1ce2a537a09146a469` | 44 |
| 5 | `ebc82184133ec6b809a68f81ec85ed27d688490b6a9fb71773fdb94f707f8d5c` | 44 |
| 6 | `2a8ee9367bcce028f20fac55246ad6f258ab1b2a4849f7948bbb5c303832dcf6` | 44 |
| 7 | `3dcb621e71f94684b6e4d98ff7044ccb0cd825f62ac5473d4d7f4cc7cb409ca9` | 44 |
| 8 | `8754e14da38257b95fdebcf324fde1ed9ac64ce0093007029f829bdb2f1d4353` | 44 |
| 9 | `2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881` | 44 |
| 10 | `d054efc4ebbfeea574c6e0c1ba9d8309a1411b2d2d8690622ea0784caadb2795` | 6 |

## Source Distribution

### Skills by Source

| Source | Skill Count | Recommendation Share |
|--------|-------------|----------------------|
| project | 54 | 100.0% |

In a multi-source setup, this table would show breakdowns for `project` and `zcode-user` sources, along with each source's share of top-10 skill recommendations.

## Cache Performance

| Day | Cache Hits | Cache Misses | Hit Rate |
|-----|------------|--------------|----------|
| 2026-09-22 | 0 | 207 | 0.00% |
| 2026-09-23 | 0 | 63 | 0.00% |

**Trend:** stable (first: 0.00% → last: 0.00%)

> **Note:** Cache hit rate is 0% because all benchmark prompts are unique (no repeated queries). In production, repeated queries within the 5-minute TTL window will show cache hits. The trend indicator shows whether hit rates are improving, decreasing, or stable over time.

## Sync Health

| Field | Value |
|-------|-------|
| Last sync | 2026-09-23T09:15:40.211Z |
| Mirror path | `%USERPROFILE%\.zcode\skills` |
| Synced skills | 53 |

### Recent Synced Skills (last 10)

| # | Skill | Synced At |
|---|-------|-----------|
| 1 | accessibility | 2026-09-23T09:15:40.211Z |
| 2 | api-resources | 2026-09-23T09:15:40.211Z |
| 3 | api-routes | 2026-09-23T09:15:40.211Z |
| 4 | app-router | 2026-09-23T09:15:40.211Z |
| 5 | architecture | 2026-09-23T09:15:40.211Z |
| 6 | cache | 2026-09-23T09:15:40.211Z |
| 7 | code-review | 2026-09-23T09:15:40.211Z |
| 8 | color-theory | 2026-09-23T09:15:40.211Z |
| 9 | context | 2026-09-23T09:15:40.211Z |
| 10 | data-fetching | 2026-09-23T09:15:40.211Z |

---

## CLI Usage

```bash
# Full report (default)
node bin/skill-router.mjs analytics

# JSON output
node bin/skill-router.mjs analytics --json

# Filter by date
node bin/skill-router.mjs analytics --since 2026-09-22

# Exclude sync health section
node bin/skill-router.mjs analytics --no-sync
```

## New Fields Reference

| Field | Type | Description |
|-------|------|-------------|
| `sourceBreakdown.bySource` | `Record<string, number>` | Skill count per source (e.g. `project`, `zcode-user`) |
| `sourceBreakdown.recommendationShare` | `Record<string, number>` | Fraction of top-10 recs coming from each source |
| `cacheHitRateTrend` | `Array<{day, hits, misses, hitRate}>` | Daily cache hit/miss counts and hit rate |
| `syncHistory` | `Object|null` | Last sync state: `lastSyncAt`, `mirrorPath`, `skillCount`, `skills[]` |
