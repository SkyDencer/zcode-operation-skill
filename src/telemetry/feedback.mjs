/**
 * Structured logging for routing decisions.
 *
 * One JSON line per decision written to logs/routing-YYYYMMDD.jsonl.
 * Privacy-preserving: prompt is hashed with SHA-256, never stored raw.
 */
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const FEEDBACK_LOG_DIR = resolve('logs');
const FEEDBACK_PREFIX = 'routing';

/**
 * Hash a prompt string with SHA-256.
 *
 * @param {string} prompt
 * @returns {string}
 */
export function hashPrompt(prompt) {
  return 'sha256:' + createHash('sha256').update(prompt).digest('hex');
}

/**
 * Return the path for today's routing decision log file.
 *
 * @returns {string}
 */
function feedbackLogPath() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return resolve(FEEDBACK_LOG_DIR, `${FEEDBACK_PREFIX}-${y}${m}${d}.jsonl`);
}

/**
 * Log a routing decision. Prompt is hashed; raw prompt is never stored.
 *
 * @param {object} record
 * @param {string} record.mode — 'explicit' | 'implicit'
 * @param {string|null} record.router — router skill name or null
 * @param {string} record.tier — 'bm25' | 'slm' | 'hybrid' | 'none'
 * @param {string[]} record.selectedSkills
 * @param {object} record.latencyMs — { total, bm25, slm? }
 * @param {number} record.confidence
 * @param {string} record.prompt — raw prompt text (will be hashed)
 * @param {string} [record.sessionId]
 * @param {string} [record.version]
 */
export async function logDecision(record) {
  try {
    await mkdir(FEEDBACK_LOG_DIR, { recursive: true });
    const entry = {
      ts: new Date().toISOString(),
      mode: record.mode,
      router: record.router ?? null,
      tier: record.tier,
      selectedSkills: record.selectedSkills,
      latencyMs: record.latencyMs ?? {},
      confidence: record.confidence,
      promptHash: hashPrompt(record.prompt),
      sessionId: record.sessionId ?? null,
      version: record.version ?? null,
    };
    await appendFile(feedbackLogPath(), JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // Fail silently — feedback logging must not break the hook
  }
}

/**
 * Decision record shape.
 * @typedef {object} Decision
 * @property {string} ts
 * @property {string} mode
 * @property {string|null} router
 * @property {string} tier
 * @property {string[]} selectedSkills
 * @property {object} latencyMs
 * @property {number} confidence
 * @property {string} promptHash
 * @property {string|null} sessionId
 * @property {string|null} version
 */

/**
 * Read routing decisions from logs with optional filters.
 *
 * @param {object} [opts]
 * @param {string} [opts.since] — YYYY-MM-DD
 * @param {number} [opts.limit] — max results
 * @param {string} [opts.tier] — filter by tier
 * @param {string} [opts.logDir] — override default log directory (for testing)
 * @returns {Decision[]}
 */
export async function readDecisions(opts = {}) {
  const { since, limit, tier, logDir } = opts;
  const logDirResolved = logDir ?? FEEDBACK_LOG_DIR;
  const results = [];

  try {
    const files = await readdir(logDirResolved);
    const routingFiles = files
      .filter((f) => f.startsWith(FEEDBACK_PREFIX + '-') && f.endsWith('.jsonl'))
      .sort();

    for (const file of routingFiles) {
      const filePath = join(logDirResolved, file);
      try {
        const content = await readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let entry;
          try {
            entry = JSON.parse(trimmed);
          } catch {
            // Skip malformed lines
            continue;
          }

          // Filter by since date
          if (since) {
            const entryDate = entry.ts?.slice(0, 10);
            if (entryDate && entryDate < since) continue;
          }

          // Filter by tier
          if (tier && entry.tier !== tier) continue;

          results.push(entry);
        }
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Directory doesn't exist — return empty array
  }

  if (limit && results.length > limit) {
    return results.slice(-limit);
  }

  return results;
}

/**
 * Summarize routing decisions.
 *
 * @param {Decision[]} decisions
 * @returns {object} Summary
 * @returns {number} Summary.totalCount
 * @returns {object} Summary.byMode — { explicit: n, implicit: n }
 * @returns {object} Summary.byTier — { bm25: n, slm: n, hybrid: n, none: n }
 * @returns {object} Summary.byRouter — { router-name: n, '(none)': n }
 * @returns {object} Summary.topSkills — [{ name, count }, ...] sorted desc
 * @returns {number} Summary.p50Latency
 * @returns {number} Summary.p95Latency
 * @returns {number} Summary.maxLatency
 * @returns {number} Summary.fallbackRate
 */
export function summarize(decisions) {
  const total = decisions.length;

  const byMode = { explicit: 0, implicit: 0 };
  const byTier = { bm25: 0, slm: 0, hybrid: 0, none: 0 };
  const byRouter = new Map();
  const skillCounts = new Map();
  const latencies = [];

  for (const d of decisions) {
    // Mode
    if (d.mode === 'explicit') byMode.explicit++;
    else byMode.implicit++;

    // Tier
    if (byTier.hasOwnProperty(d.tier)) byTier[d.tier]++;

    // Router
    const routerKey = d.router ?? '(none)';
    byRouter.set(routerKey, (byRouter.get(routerKey) || 0) + 1);

    // Skills
    if (Array.isArray(d.selectedSkills)) {
      for (const name of d.selectedSkills) {
        skillCounts.set(name, (skillCounts.get(name) || 0) + 1);
      }
    }

    // Latency — use total if available, otherwise bm25
    const totalMs = d.latencyMs?.total ?? d.latencyMs?.bm25 ?? 0;
    if (typeof totalMs === 'number') latencies.push(totalMs);
  }

  // Top skills sorted desc
  const topSkills = Array.from(skillCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // Percentiles
  const sortedLatencies = [...latencies].sort((a, b) => a - b);
  const p = (arr, pct) => {
    if (arr.length === 0) return 0;
    const idx = (pct / 100) * (arr.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return arr[lo];
    return arr[lo] + (arr[hi] - arr[lo]) * (idx - lo);
  };

  // Fallback rate: decisions with no selected skills
  const fallbackCount = decisions.filter((d) => !d.selectedSkills || d.selectedSkills.length === 0).length;
  const fallbackRate = total > 0 ? Math.round((fallbackCount / total) * 1000) / 10 : 0;

  // Build byRouter object (top 6 + rest)
  const byRouterObj = {};
  for (const [key, val] of byRouter.entries()) {
    byRouterObj[key] = val;
  }

  return {
    totalCount: total,
    byMode,
    byTier,
    byRouter: byRouterObj,
    topSkills: topSkills.slice(0, 10),
    p50Latency: Math.round(p(sortedLatencies, 50)),
    p95Latency: Math.round(p(sortedLatencies, 95)),
    maxLatency: sortedLatencies.length > 0 ? sortedLatencies[sortedLatencies.length - 1] : 0,
    fallbackRate,
  };
}
