/**
 * Analyzer tests.
 *
 * Verifies:
 * - analyze() returns correct shape
 * - totalRequests counts retrieve events
 * - perDayHistogram groups correctly
 * - fallbackRateOverTime is computed correctly
 * - medianLatencyTrend is computed correctly
 * - commonPromptHashes contains only hashes (no raw prompts)
 * - top10Skills resolves queries to skill names
 * - build/error events are counted separately
 * - hashPrompt produces consistent SHA-256 output
 * - Missing index falls back gracefully
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyze, hashPrompt } from '../../src/analytics/analyzer.mjs';

const BASE = resolve('.');
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log('  ✓', message);
  } else {
    console.error('  ✗', message);
    failed++;
  }
}

console.log('\n=== Analyzer Tests ===\n');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(ts, event, extra = {}) {
  return { ts, event, ...extra };
}

const TEST_DIR = resolve(BASE, 'tests/analytics/tmp-index');

function setupTestIndex() {
  mkdirSync(TEST_DIR, { recursive: true });
  const index = {
    format: 'tedgram-skill-index-v1',
    version: 1,
    builtAt: '2026-09-22T00:00:00.000Z',
    stats: { totalDocs: 3, totalTerms: 10, avgDocLen: 5 },
    index: {},
    docs: {
      'skill-001': {
        id: 'skill-001',
        name: 'React Hooks Pattern',
        description: 'Learn React hooks like useState and useEffect',
        keywords: ['react', 'hooks', 'useState'],
        domains: ['frontend'],
        manifestPath: 'data/mock-skills/react-hooks.json',
        path: '/dev/null',
        version: '1.0.0',
      },
      'skill-002': {
        id: 'skill-002',
        name: 'Laravel Eloquent ORM',
        description: 'Master Laravel Eloquent relationships and queries',
        keywords: ['laravel', 'eloquent', 'orm'],
        domains: ['backend'],
        manifestPath: 'data/mock-skills/laravel-eloquent.json',
        path: '/dev/null',
        version: '1.0.0',
      },
      'skill-003': {
        id: 'skill-003',
        name: 'CSS Grid Layout',
        description: 'Build responsive layouts with CSS Grid',
        keywords: ['css', 'grid', 'layout'],
        domains: ['design'],
        manifestPath: 'data/mock-skills/css-grid.json',
        path: '/dev/null',
        version: '1.0.0',
      },
    },
  };
  writeFileSync(resolve(TEST_DIR, 'skill-index.json'), JSON.stringify(index), 'utf-8');
  return resolve(TEST_DIR, 'skill-index.json');
}

function teardownTestIndex() {
  rmSync(TEST_DIR, { recursive: true, force: true });
}

// ─── Test suite ───────────────────────────────────────────────────────────────

// 1. Return shape
console.log('1. Return shape');
const entries = [
  makeEntry('2026-09-22T10:00:00.000Z', 'retrieve', { query: 'React hooks', resultCount: 3, durationMs: 12 }),
  makeEntry('2026-09-22T11:00:00.000Z', 'retrieve', { query: 'Laravel eloquent', resultCount: 2, durationMs: 15 }),
  makeEntry('2026-09-23T10:00:00.000Z', 'retrieve', { query: 'CSS grid', resultCount: 0, durationMs: 8 }),
  makeEntry('2026-09-22T09:00:00.000Z', 'build', { totalDocs: 10, durationMs: 50 }),
  makeEntry('2026-09-22T09:00:01.000Z', 'error', { query: 'bad', error: 'test error' }),
];
const result = analyze(entries, { indexPath: null });
assert(typeof result.totalRequests === 'number', 'totalRequests is a number');
assert(typeof result.totalBuilds === 'number', 'totalBuilds is a number');
assert(typeof result.totalErrors === 'number', 'totalErrors is a number');
assert(typeof result.overallFallbackRate === 'number', 'overallFallbackRate is a number');
assert(typeof result.overallMedianLatency === 'number', 'overallMedianLatency is a number');
assert(typeof result.perDayHistogram === 'object', 'perDayHistogram is an object');
assert(typeof result.fallbackRateOverTime === 'object', 'fallbackRateOverTime is an object');
assert(typeof result.medianLatencyTrend === 'object', 'medianLatencyTrend is an object');
assert(Array.isArray(result.top10Skills), 'top10Skills is an array');
assert(Array.isArray(result.commonPromptHashes), 'commonPromptHashes is an array');
assert(typeof result.analyzedAt === 'string', 'analyzedAt is a string');

// 2. totalRequests counts only retrieve events
console.log('\n2. totalRequests count');
assert(result.totalRequests === 3, `totalRequests is 3, got ${result.totalRequests}`);

// 3. totalBuilds and totalErrors
console.log('\n3. Build and error counts');
assert(result.totalBuilds === 1, `totalBuilds is 1, got ${result.totalBuilds}`);
assert(result.totalErrors === 1, `totalErrors is 1, got ${result.totalErrors}`);

// 4. perDayHistogram
console.log('\n4. perDayHistogram');
assert(result.perDayHistogram['2026-09-22'] === 2, 'Sep 22 has 2 requests');
assert(result.perDayHistogram['2026-09-23'] === 1, 'Sep 23 has 1 request');

// 5. fallbackRateOverTime
console.log('\n5. fallbackRateOverTime');
assert(
  Math.abs(result.fallbackRateOverTime['2026-09-22'] - 0) < 0.001,
  'Sep 22 fallback rate is 0%',
);
assert(
  Math.abs(result.fallbackRateOverTime['2026-09-23'] - 1.0) < 0.001,
  'Sep 23 fallback rate is 100%',
);

// 6. overallFallbackRate
console.log('\n6. overallFallbackRate');
assert(
  Math.abs(result.overallFallbackRate - 1 / 3) < 0.001,
  `overall fallback rate is 33.33%, got ${(result.overallFallbackRate * 100).toFixed(2)}%`,
);

// 7. medianLatencyTrend
console.log('\n7. medianLatencyTrend');
// Sep 22: durations [12, 15] → median = 13.5
assert(
  Math.abs(result.medianLatencyTrend['2026-09-22'] - 13.5) < 0.001,
  `Sep 22 median latency is 13.5ms, got ${result.medianLatencyTrend['2026-09-22']}ms`,
);
// Sep 23: durations [8] → median = 8
assert(
  result.medianLatencyTrend['2026-09-23'] === 8,
  `Sep 23 median latency is 8ms, got ${result.medianLatencyTrend['2026-09-23']}ms`,
);

// 8. overallMedianLatency
console.log('\n8. overallMedianLatency');
// All durations: [8, 12, 15] → median = 12
assert(result.overallMedianLatency === 12, `overall median latency is 12ms, got ${result.overallMedianLatency}ms`);

// 9. commonPromptHashes — no raw prompts
console.log('\n9. commonPromptHashes (privacy)');
assert(result.commonPromptHashes.length === 3, '3 unique queries hashed');
for (const item of result.commonPromptHashes) {
  assert(typeof item.hash === 'string', `hash is a string: ${item.hash.substring(0, 8)}...`);
  assert(item.hash.length === 64, `hash is 64-char hex: ${item.hash.substring(0, 8)}...`);
  assert(typeof item.count === 'number', 'count is a number');
  // Verify no raw query text leaked
  assert(!item.hash.includes('React'), 'hash does not contain raw prompt text');
}

// 10. hashPrompt determinism
console.log('\n10. hashPrompt determinism');
const h1 = hashPrompt('test query');
const h2 = hashPrompt('test query');
assert(h1 === h2, 'same input produces same hash');
assert(h1 !== hashPrompt('different'), 'different input produces different hash');
assert(h1.length === 64, 'hash is 64 hex chars');

// 11. top10Skills with index
console.log('\n11. top10Skills resolution');
const indexPath = setupTestIndex();
try {
  const indexedEntries = [
    makeEntry('2026-09-22T10:00:00.000Z', 'retrieve', { query: 'React hooks useState', resultCount: 3, durationMs: 10 }),
    makeEntry('2026-09-22T11:00:00.000Z', 'retrieve', { query: 'Laravel eloquent relationships', resultCount: 2, durationMs: 12 }),
    makeEntry('2026-09-22T12:00:00.000Z', 'retrieve', { query: 'React hooks', resultCount: 3, durationMs: 11 }),
    makeEntry('2026-09-22T13:00:00.000Z', 'retrieve', { query: 'CSS grid layout', resultCount: 1, durationMs: 9 }),
  ];
  const indexedResult = analyze(indexedEntries, { indexPath });
  assert(Array.isArray(indexedResult.top10Skills), 'top10Skills is an array with index');
  assert(indexedResult.top10Skills.length > 0, 'top10Skills has entries with index');
  // React-related queries should surface "React Hooks Pattern"
  const reactSkill = indexedResult.top10Skills.find((s) => s.name.includes('React'));
  assert(reactSkill !== undefined, 'React skill appears in top skills');
  assert(typeof reactSkill.count === 'number', 'skill count is a number');
} finally {
  teardownTestIndex();
}

// 12. Graceful fallback when index is missing
console.log('\n12. Missing index fallback');
const noIndexResult = analyze(entries, { indexPath: '/nonexistent/path/index.json' });
assert(Array.isArray(noIndexResult.top10Skills), 'top10Skills is empty array when index missing');
assert(noIndexResult.top10Skills.length === 0, 'top10Skills is empty when index missing');
// Other metrics should still work
assert(noIndexResult.totalRequests === 3, 'totalRequests still works without index');
assert(noIndexResult.overallFallbackRate >= 0, 'overallFallbackRate is non-negative without index');

// 13. Empty entries
console.log('\n13. Empty entries');
const emptyResult = analyze([], { indexPath: null });
assert(emptyResult.totalRequests === 0, '0 totalRequests with empty input');
assert(emptyResult.overallFallbackRate === 0, '0 fallbackRate with empty input');
assert(emptyResult.overallMedianLatency === 0, '0 medianLatency with empty input');
assert(Object.keys(emptyResult.perDayHistogram).length === 0, 'empty perDayHistogram');

// 14. Real logs integration test
console.log('\n14. Real logs integration');
const { readLogs } = await import('../../src/analytics/reader.mjs');
const realLogPath = resolve(BASE, 'logs');
try {
  const realEntries2 = readLogs(realLogPath);
  if (realEntries2.length > 0) {
    const realResult = analyze(realEntries2, { indexPath: resolve(BASE, 'data/skill-index.json') });
    assert(realResult.totalRequests >= 0, 'real logs: totalRequests is non-negative');
    assert(realResult.analyzedAt !== undefined, 'real logs: has analyzedAt');
    for (const item of realResult.commonPromptHashes) {
      assert(item.hash.length === 64, 'real logs: hash is 64-char hex');
    }
    // New fields
    assert(realResult.sourceBreakdown !== undefined, 'real logs: has sourceBreakdown');
    assert(realResult.cacheHitRateTrend !== undefined, 'real logs: has cacheHitRateTrend');
    assert(realResult.syncHistory !== undefined, 'real logs: has syncHistory');
  } else {
    console.log('  ~ skipped (no log entries)');
  }
} catch (err) {
  console.log(`  ~ skipped: ${err.message}`);
}

// 15. Source breakdown
console.log('\n15. Source breakdown');
const srcIndexPath = setupTestIndex();
try {
  const srcEntries = [
    makeEntry('2026-09-22T10:00:00.000Z', 'retrieve', { query: 'React hooks', resultCount: 3, durationMs: 10 }),
    makeEntry('2026-09-22T11:00:00.000Z', 'retrieve', { query: 'Laravel eloquent', resultCount: 2, durationMs: 12 }),
  ];
  const srcResult = analyze(srcEntries, { indexPath: srcIndexPath });
  assert(srcResult.sourceBreakdown !== undefined, 'sourceBreakdown is defined');
  assert(typeof srcResult.sourceBreakdown.bySource === 'object', 'bySource is an object');
  assert(typeof srcResult.sourceBreakdown.recommendationShare === 'object', 'recommendationShare is an object');
  assert(srcResult.sourceBreakdown.bySource['project'] === 3, 'project source has 3 skills');
} finally {
  teardownTestIndex();
}

// 16. Cache hit rate trend
console.log('\n16. Cache hit rate trend');
const cacheEntries = [
  makeEntry('2026-09-22T10:00:00.000Z', 'cache', { cacheHits: 5, cacheMisses: 10, cacheTotal: 15, cacheHitRate: 0.333, cacheSize: 5 }),
  makeEntry('2026-09-22T11:00:00.000Z', 'cache', { cacheHits: 3, cacheMisses: 7, cacheTotal: 10, cacheHitRate: 0.3, cacheSize: 8 }),
  makeEntry('2026-09-23T10:00:00.000Z', 'cache', { cacheHits: 8, cacheMisses: 2, cacheTotal: 10, cacheHitRate: 0.8, cacheSize: 10 }),
  makeEntry('2026-09-23T11:00:00.000Z', 'retrieve', { query: 'test', resultCount: 1, durationMs: 5 }),
];
const cacheResult = analyze(cacheEntries, { indexPath: null });
assert(Array.isArray(cacheResult.cacheHitRateTrend), 'cacheHitRateTrend is an array');
assert(cacheResult.cacheHitRateTrend.length === 2, '2 days of cache data');
assert(cacheResult.cacheHitRateTrend[0].day === '2026-09-22', 'first day is 2026-09-22');
assert(cacheResult.cacheHitRateTrend[0].hits === 8, 'Sep 22 hits aggregated to 8');
assert(cacheResult.cacheHitRateTrend[0].misses === 17, 'Sep 22 misses aggregated to 17');
assert(Math.abs(cacheResult.cacheHitRateTrend[0].hitRate - 8 / 25) < 0.001, 'Sep 22 hit rate is 32%');
assert(cacheResult.cacheHitRateTrend[1].day === '2026-09-23', 'second day is 2026-09-23');
assert(cacheResult.cacheHitRateTrend[1].hits === 8, 'Sep 23 hits is 8');
assert(cacheResult.cacheHitRateTrend[1].hitRate === 0.8, 'Sep 23 hit rate is 80%');

// 17. Sync history from state file
console.log('\n17. Sync history');
const syncEntries = [
  makeEntry('2026-09-22T10:00:00.000Z', 'retrieve', { query: 'test', resultCount: 1, durationMs: 5 }),
];
const syncResult = analyze(syncEntries, { indexPath: null });
assert(syncResult.syncHistory !== null, 'syncHistory is not null when state exists');
assert(typeof syncResult.syncHistory.lastSyncAt === 'string', 'lastSyncAt is a string');
assert(typeof syncResult.syncHistory.mirrorPath === 'string', 'mirrorPath is a string');
assert(typeof syncResult.syncHistory.skillCount === 'number', 'skillCount is a number');
assert(Array.isArray(syncResult.syncHistory.skills), 'skills is an array');

// 18. --no-sync excludes sync history
console.log('\n18. includeSync=false excludes sync');
const noSyncResult = analyze(syncEntries, { indexPath: null, includeSync: false });
assert(noSyncResult.syncHistory === null, 'syncHistory is null when includeSync=false');

// 19. Empty entries with new fields
console.log('\n19. Empty entries with new fields');
const emptyResult2 = analyze([], { indexPath: null });
assert(Array.isArray(emptyResult2.sourceBreakdown.bySource) || typeof emptyResult2.sourceBreakdown === 'object', 'empty: sourceBreakdown is object');
assert(Array.isArray(emptyResult2.cacheHitRateTrend), 'empty: cacheHitRateTrend is array');

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
