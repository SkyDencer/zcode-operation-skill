/**
 * Route-telemetry emitter for hooks/route.mjs (Sub-Phase 7.6).
 *
 * Centralises the hook's `route` telemetry event so that every exit path of
 * the hook — routed, abstained, and all fail-open paths — emits the same
 * complete timing breakdown:
 *
 *   indexLoadMs    time spent reading and parsing data/skill-index.json
 *   bm25Ms         retrieval time (hybrid BM25 pass or pure-BM25 pass)
 *   contextBuildMs readSkillContent + budget fit + additionalContext build
 *   totalMs        process.uptime() at emission: the whole invocation,
 *                  including interpreter startup
 *
 * Stages that did not run record 0, never an omitted field. A fail-open
 * path additionally carries `failOpen: true` and a `failOpenReason`, so a
 * consumer can distinguish "hook gave up" from "hook abstained by design".
 *
 * `emitMemProfile()` is an opt-in stderr diagnostic gated on the
 * SKILL_ROUTER_MEM_PROFILE environment variable; it is how the performance
 * test measures per-invocation memory without changing the hook's output
 * contract (default runs stay silent on stderr).
 */
import { logRecord } from '../core/telemetry/logger.mjs';

/**
 * Emit one complete `route` telemetry record.
 *
 * All timings are rounded to whole milliseconds and default to 0, so the
 * record shape is identical on every exit path of the hook.
 *
 * @param {object} record
 * @param {string|null} [record.query] — the raw prompt (or null before one
 *   exists). The logger never persists it: `logRecord()` replaces `query` with
 *   a `queryHash` (SHA-256), so the on-disk route event carries no raw prompt.
 * @param {string} [record.tier] — 'bm25' | 'none' | 'slm' | 'hybrid' | 'fail-open'
 * @param {string} [record.reason] — fail-open reason; sets failOpen: true
 * @param {number} [record.indexLoadMs]
 * @param {number} [record.bm25Ms]
 * @param {number} [record.contextBuildMs]
 * @param {Array<string>} [record.candidates] — candidate skill names
 * @param {object} [record.extra] — additional route-event fields, or spread
 *   them directly into `record` (slmLatency, bm25Latency, explicit,
 *   routerMatched, mode, slmEnabled, embeddingProvider, …)
 */
export async function emitRouteEvent(record = {}) {
  const {
    query,
    tier,
    reason,
    indexLoadMs,
    bm25Ms,
    contextBuildMs,
    candidates,
    extra = {},
    // Callers may either pass `extra` or spread route-event fields
    // (slmLatency, bm25Latency, explicit, routerMatched, mode, slmEnabled,
    // embeddingProvider, …) directly into the record; `rest` carries them.
    ...rest
  } = record;
  await logRecord({
    event: 'route',
    query: query ?? null,
    tier: tier ?? 'fail-open',
    ...(reason ? { failOpen: true, failOpenReason: reason } : {}),
    candidates: Array.isArray(candidates) ? candidates : [],
    ...extra,
    ...rest,
    indexLoadMs: Math.round(indexLoadMs ?? 0),
    bm25Ms: Math.round(bm25Ms ?? 0),
    contextBuildMs: Math.round(contextBuildMs ?? 0),
    totalMs: Math.round(process.uptime() * 1000),
  });
}

/**
 * Write a one-line memory snapshot to stderr when SKILL_ROUTER_MEM_PROFILE
 * is set. The hook's normal output contract (stdout/stderr stay quiet on
 * default runs, JSON goes to .zcode/output.json) is unchanged.
 */
export function emitMemProfile() {
  if (!process.env.SKILL_ROUTER_MEM_PROFILE) return;
  const m = process.memoryUsage();
  process.stderr.write(
    JSON.stringify({
      skillRouterMem: {
        rss: m.rss,
        heapUsed: m.heapUsed,
        heapTotal: m.heapTotal,
        external: m.external,
        arrayBuffers: m.arrayBuffers,
      },
    }) + '\n'
  );
}
