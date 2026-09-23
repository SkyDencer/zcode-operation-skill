/**
 * Usage analytics analyzer.
 *
 * Computes metrics from parsed log entries:
 * - totalRequests, totalBuilds, totalErrors
 * - perDayHistogram: retrieve counts by date
 * - fallbackRateOverTime: % zero-result retrieves per day
 * - medianLatencyTrend: median durationMs per day
 * - top10Skills: most frequently recommended skills
 * - commonPromptHashes: SHA-256 hashes of top-10 most frequent queries
 * - sourceBreakdown: per-source skill counts and recommendation share
 * - cacheHitRateTrend: cache hit rate by day
 * - syncHistory: last sync events from state file
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { rankSkills } from '../retriever.mjs';

const INDEX_PATH = resolve('data/skill-index.json');
const SYNC_STATE_PATH = resolve('.skill-router-sync-state.json');

/**
 * Compute a SHA-256 hash of a query string (never reveals raw prompt).
 *
 * @param {string} query
 * @returns {string} Hex digest
 */
export function hashPrompt(query) {
  return createHash('sha256').update(query || '').digest('hex');
}

/**
 * Load the skill index for skill name lookups.
 *
 * @param {string} [path] - Path to skill-index.json
 * @returns {object|null} Index object or null if not found
 */
export function loadIndex(path) {
  try {
    const data = readFileSync(path ?? INDEX_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Extract the document array from an index, handling both
 * array-of-objects and {docs: {...}} shapes.
 *
 * @param {object} index
 * @returns {Array<{name:string, description:string, keywords:string[], domains:string[], path:string, version:string}>}
 */
export function getDocs(index) {
  if (!index) return [];
  // If index has a docs map, convert to array
  if (index.docs && typeof index.docs === 'object') {
    return Object.values(index.docs);
  }
  // Otherwise treat the index itself as an array-like object
  if (Array.isArray(index)) return index;
  const keys = Object.keys(index);
  if (keys.length > 0 && typeof index[keys[0]] === 'object' && index[keys[0]] !== null) {
    return Object.values(index);
  }
  return [];
}

/**
 * Resolve a query to its top-ranked skill names via the BM25 index.
 *
 * @param {string} query
 * @param {object} index
 * @returns {string[]} Array of top skill names (up to 5)
 */
export function resolveTopSkills(query, index) {
  const docs = getDocs(index);
  if (docs.length === 0) return [];

  const ranked = rankSkills(query, docs);
  return ranked.slice(0, 5).map((r) => r.skill.name);
}

/**
 * Analyze log entries and produce an AnalyticsReport.
 *
 * @param {LogEntry[]} entries - Parsed log entries from readLogs()
 * @param {object} [options]
 * @param {string} [options.indexPath] - Path to skill-index.json
 * @param {boolean} [options.includeSync] - Whether to include sync state (default: true)
 * @returns {AnalyticsReport}
 */
export function analyze(entries, options = {}) {
  const indexPath = options.indexPath ?? INDEX_PATH;
  const index = loadIndexFromPath(indexPath);
  const includeSync = options.includeSync !== false;

  // Filter to retrieve events only for most metrics
  const retrieves = entries.filter((e) => e.event === 'retrieve');

  // ── Total requests ────────────────────────────────────────────────────────
  const totalRequests = retrieves.length;

  // ── Per-day histogram ─────────────────────────────────────────────────────
  const perDayHistogram = {};
  for (const entry of retrieves) {
    const day = entry.ts.slice(0, 10); // YYYY-MM-DD
    perDayHistogram[day] = (perDayHistogram[day] || 0) + 1;
  }

  // ── Fallback rate over time ───────────────────────────────────────────────
  const fallbackByDay = {};
  for (const entry of retrieves) {
    const day = entry.ts.slice(0, 10);
    if (!fallbackByDay[day]) fallbackByDay[day] = { total: 0, fallbacks: 0 };
    fallbackByDay[day].total++;
    if (entry.resultCount === 0) {
      fallbackByDay[day].fallbacks++;
    }
  }
  const fallbackRateOverTime = {};
  for (const [day, counts] of Object.entries(fallbackByDay)) {
    fallbackRateOverTime[day] = counts.total > 0 ? counts.fallbacks / counts.total : 0;
  }

  // ── Median latency trend ──────────────────────────────────────────────────
  const latencyByDay = {};
  for (const entry of retrieves) {
    const day = entry.ts.slice(0, 10);
    if (!latencyByDay[day]) latencyByDay[day] = [];
    if (typeof entry.durationMs === 'number') {
      latencyByDay[day].push(entry.durationMs);
    }
  }
  const medianLatencyTrend = {};
  for (const [day, durations] of Object.entries(latencyByDay)) {
    const sorted = [...durations].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medianLatencyTrend[day] =
      sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
  }

  // ── Common prompt hashes (top-10 most frequent) ───────────────────────────
  const queryCounts = {};
  for (const entry of retrieves) {
    const q = entry.query || '';
    queryCounts[q] = (queryCounts[q] || 0) + 1;
  }
  const sortedQueries = Object.entries(queryCounts).sort((a, b) => b[1] - a[1]);
  const commonPromptHashes = sortedQueries.slice(0, 10).map(([query, count]) => ({
    hash: hashPrompt(query),
    count,
  }));

  // ── Top-10 skills ─────────────────────────────────────────────────────────
  const docs = getDocs(index);
  let top10Skills = [];
  if (docs.length > 0) {
    const skillCounts = {};
    for (const entry of retrieves) {
      const query = entry.query || '';
      const topSkills = resolveTopSkills(query, index);
      for (const name of topSkills) {
        skillCounts[name] = (skillCounts[name] || 0) + 1;
      }
    }
    top10Skills = Object.entries(skillCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));
  }

  // ── Overall fallback rate ─────────────────────────────────────────────────
  const totalFallbacks = retrieves.filter((e) => e.resultCount === 0).length;
  const overallFallbackRate = totalRequests > 0 ? totalFallbacks / totalRequests : 0;

  // ── Overall median latency ────────────────────────────────────────────────
  const allDurations = retrieves
    .map((e) => e.durationMs)
    .filter((d) => typeof d === 'number')
    .sort((a, b) => a - b);
  const overallMedianLatency = allDurations.length > 0
    ? allDurations[Math.floor(allDurations.length / 2)]
    : 0;

  // ── Total build events ────────────────────────────────────────────────────
  const buildEvents = entries.filter((e) => e.event === 'build');
  const totalBuilds = buildEvents.length;

  // ── Error events ──────────────────────────────────────────────────────────
  const errorEvents = entries.filter((e) => e.event === 'error');
  const totalErrors = errorEvents.length;

  // ── Per-source breakdown ──────────────────────────────────────────────────
  const sourceBreakdown = computeSourceBreakdown(index, retrieves);

  // ── Cache hit rate trend ──────────────────────────────────────────────────
  const cacheHitRateTrend = computeCacheTrend(entries);

  // ── Sync history ──────────────────────────────────────────────────────────
  const syncHistory = includeSync ? readSyncHistory() : null;

  return {
    totalRequests,
    totalBuilds,
    totalErrors,
    overallFallbackRate,
    overallMedianLatency,
    perDayHistogram,
    fallbackRateOverTime,
    medianLatencyTrend,
    top10Skills,
    commonPromptHashes,
    sourceBreakdown,
    cacheHitRateTrend,
    syncHistory,
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * Count skills by source and compute each source's share of top-10 recommendations.
 *
 * @param {object} index
 * @param {object[]} retrieves
 * @returns {{bySource: Record<string, number>, recommendationShare: Record<string, number>}}
 */
function computeSourceBreakdown(index, retrieves) {
  const docs = getDocs(index);

  // Count skills per source
  const bySource = {};
  for (const doc of docs) {
    const source = doc.source || 'project';
    bySource[source] = (bySource[source] || 0) + 1;
  }

  // Count how many times skills from each source appear in top-10 recommendations
  const recBySource = {};
  for (const entry of retrieves) {
    const query = entry.query || '';
    const topSkills = resolveTopSkills(query, index);
    for (const name of topSkills) {
      const doc = docs.find((d) => d.name === name);
      if (doc) {
        const source = doc.source || 'project';
        recBySource[source] = (recBySource[source] || 0) + 1;
      }
    }
  }

  const totalRecs = Object.values(recBySource).reduce((s, c) => s + c, 0);
  const recommendationShare = {};
  for (const [source, count] of Object.entries(recBySource)) {
    recommendationShare[source] = totalRecs > 0 ? count / totalRecs : 0;
  }

  return { bySource, recommendationShare };
}

/**
 * Compute cache hit rate trend grouped by day from cache events.
 *
 * @param {object[]} entries
 * @returns {Array<{day: string, hits: number, misses: number, hitRate: number}>}
 */
function computeCacheTrend(entries) {
  const cacheEvents = entries.filter((e) => e.event === 'cache');
  const byDay = {};

  for (const entry of cacheEvents) {
    const day = entry.ts.slice(0, 10);
    if (!byDay[day]) byDay[day] = { hits: 0, misses: 0 };
    byDay[day].hits += entry.cacheHits || 0;
    byDay[day].misses += entry.cacheMisses || 0;
  }

  const trend = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, data]) => {
      const total = data.hits + data.misses;
      return {
        day,
        hits: data.hits,
        misses: data.misses,
        hitRate: total > 0 ? data.hits / total : 0,
      };
    });

  return trend;
}

/**
 * Read sync state file and return the latest sync information.
 *
 * @returns {{lastSyncAt: string|null, mirrorPath: string|null, skillCount: number, skills: Array<{name: string, hash: string, syncedAt: string}>}|null}
 */
function readSyncHistory() {
  if (!existsSync(SYNC_STATE_PATH)) return null;
  try {
    const data = readFileSync(SYNC_STATE_PATH, 'utf-8');
    const state = JSON.parse(data);
    const skills = Object.entries(state.skills || {}).map(([name, info]) => ({
      name,
      hash: info.hash,
      syncedAt: info.syncedAt,
    }));
    return {
      lastSyncAt: state.lastSyncAt || null,
      mirrorPath: state.mirrorPath || null,
      skillCount: skills.length,
      skills,
    };
  } catch {
    return null;
  }
}

function loadIndexFromPath(path) {
  return loadIndex(path);
}
