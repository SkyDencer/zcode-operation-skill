/**
 * ZCode route hook — intercepts UserPromptSubmit, retrieves relevant
 * skills via hybrid SLM+BM25 routing, and injects context into the model.
 * Explicit $-mentions scope BM25 to the matched router's domain; otherwise
 * routeHybrid() runs. Writes the plan to .zcode/output.json.
 *
 * D29: default embedding mode 'bm25-only' (FNV-1a fallback); the
 * experimental 'onnx' mode emits an experimental_mode event.
 * Sub-Phase 7.6: every exit path — including fail-open — emits a complete
 * route record with indexLoadMs, bm25Ms, contextBuildMs and totalMs, and
 * retrieval reuses the builder's pre-tokenized parsed-index cache when it
 * is present and still valid (prebuilt: on|off in telemetry).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { rankSkills, readSkillContent } from '../src/index.mjs';
import { hybridRetrieve } from '../src/core/retriever/hybrid.mjs';
import { preparePrebuiltFor } from '../src/core/retriever/prebuilt.mjs';
import { logRetrieve, logError, logRecord } from '../src/core/telemetry/logger.mjs';
import { increment, recordTiming } from '../src/core/telemetry/metrics.mjs';
import { logDecision } from '../src/telemetry/feedback.mjs';
import { trackPrompt } from '../src/telemetry/session-tracker.mjs';
import { recordSignal } from '../src/telemetry/signals.mjs';
import { emitRouteEvent, emitMemProfile } from '../src/telemetry/route-telemetry.mjs';
import { getConfig } from '../src/config/env.mjs';
import { resolveProvider } from '../src/core/embeddings/resolve.mjs';
import { emitExperimentalMode } from '../src/core/embeddings/experimental.mjs';
import { routeHybrid, routeWithExplicit } from '../src/core/routing/hybrid.mjs';
import { detectExplicitSkill } from '../src/core/routing/explicit.mjs';
import { fitWithinBudget } from '../src/core/budget/manager.mjs';
import { QueryCache } from '../src/core/cache/query-cache.mjs';

const HOOK_DIR = resolve(fileURLToPath(import.meta.url), '..');
const INDEX_PATH = resolve(HOOK_DIR, '..', 'data', 'skill-index.json');
// Parsed-index cache written by the index builders next to the index
// (Sub-Phase 7.6): pre-tokenized BM25 corpus side. Optional — the hook
// falls back to the slow path when it is missing or stale.
const PREBUILT_PATH = resolve(HOOK_DIR, '..', 'data', 'skill-index.prebuilt.json');

const config = getConfig();
const { timeoutMs, maxPromptLength } = config.hook;
const { maxChars: budgetMaxChars } = config.budget;
// P6-H-001: hard cap on injected skills. The env layer (src/config/env.mjs)
// already clamps SKILL_ROUTER_TOPK to [1, 20]; this second clamp is the
// fail-safe that holds even if the config is produced by another path.
const topK = Math.max(1, Math.min(20, config.routing?.topK ?? 5));

// Resolve the embedding provider from config (a filesystem probe only —
// it never loads a model). Falls back to FNV-1a, or null for pure BM25.
const providerResolution = resolveProvider(config);

// Phase 7.1 (D29): experimental 'onnx' mode emits `experimental_mode`
// telemetry before the decision path; the guard keeps the hook at exit 0.
await emitExperimentalMode(config).catch(() => {});

/**
 * Get the active embedding provider, or null when the caller should fall
 * back to pure BM25 retrieval.
 */
function getProvider() {
  return providerResolution.provider;
}

/**
 * Build the additionalContext string: Mode/Router/Tier/Selected/Confidence
 * header plus one `--- SKILL: name ---` section per selected skill.
 */
function buildContext(skillsWithContent, decision) {
  if (skillsWithContent.length === 0) return '';
  const isExplicit = !!decision.explicit;
  const routerTag = decision.routerMatched ?? 'none';
  const modeLabel = isExplicit ? `explicit (${routerTag})` : 'implicit';
  const lines = [
    '[SKILL ROUTER]',
    `Mode: ${isExplicit ? 'explicit' : 'implicit'}`,
    `Router: ${routerTag}`,
    `Tier: ${decision.tier}`,
    // Reflect the skills actually being injected (post-topK cap and budget),
    // not the full decision list — otherwise the header over-reports.
    `Selected: ${skillsWithContent.map((s) => s.name).join(', ')}`,
    `Confidence: ${decision.confidence}`,
    '',
  ];
  for (const s of skillsWithContent) {
    lines.push(`--- SKILL: ${s.name} ---`);
    lines.push('');
    lines.push(s.content.trim());
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Sanitize the hook-supplied `cwd` used as the base for `.zcode/output.json`.
 *
 * The hook's stdin payload is untrusted input. A `cwd` containing a `..`
 * segment could otherwise escape the workspace and write the output file
 * anywhere on disk (path traversal). Clean relative or absolute paths are
 * accepted and resolved to an absolute path. Anything with a `..` segment, or
 * a non-string / empty value, is rejected and falls back to the hook's own
 * process.cwd() — the workspace root, where it is legitimate for the hook to
 * write `.zcode/`.
 *
 * @param {unknown} rawCwd — the `cwd` field from the hook payload
 * @returns {string} an absolute path that is safe to write into
 */
function sanitizeCwd(rawCwd) {
  if (typeof rawCwd !== 'string' || rawCwd.trim() === '') {
    return process.cwd();
  }
  // Reject path traversal before resolving — resolve() alone cannot help,
  // because resolve('../../x') still lands somewhere relative to the workspace.
  const segments = rawCwd.split(/[\\/]+/);
  if (segments.includes('..')) {
    return process.cwd();
  }
  return resolve(rawCwd);
}

async function main() {
  let input = '';
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  input = Buffer.concat(chunks).toString('utf-8');

  if (!input.trim()) {
    await emitRouteEvent({ query: null, tier: 'fail-open', reason: 'empty input' });
    emitMemProfile();
    process.exit(0);
  }

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    await emitRouteEvent({ query: null, tier: 'fail-open', reason: 'malformed json input' });
    emitMemProfile();
    process.exit(0);
  }

  const { prompt, cwd } = payload;
  const safePrompt = typeof prompt === 'string' ? prompt : '';
  const safeCwd = sanitizeCwd(cwd);

  const trimmedPrompt =
    safePrompt.length > maxPromptLength
      ? safePrompt.slice(0, maxPromptLength)
      : safePrompt;

  if (trimmedPrompt.trim() === '') {
    await emitRouteEvent({ query: null, tier: 'fail-open', reason: 'empty prompt after defaults' });
    emitMemProfile();
    process.exit(0);
  }

  const startTime = performance.now();

  let index;
  let prebuilt = null;
  const indexLoadStart = performance.now();
  let indexLoadMs = 0;
  try {
    const raw = readFileSync(INDEX_PATH, 'utf-8');
    index = JSON.parse(raw);
    // Parsed-index cache (Sub-Phase 7.6): optional; absent/corrupt stays on
    // the slow path. Loading it is part of the "load the index" stage.
    try {
      prebuilt = JSON.parse(readFileSync(PREBUILT_PATH, 'utf-8'));
    } catch {
      prebuilt = null;
    }
    indexLoadMs = performance.now() - indexLoadStart;
  } catch {
    // Index not found — fail open (timings still emitted, Sub-Phase 7.6)
    indexLoadMs = performance.now() - indexLoadStart;
    increment('errors.index_missing');
    await logError({ query: trimmedPrompt, error: 'index not found' });
    await emitRouteEvent({ query: trimmedPrompt, tier: 'fail-open', reason: 'index not found', indexLoadMs });
    emitMemProfile();
    process.exit(0);
  }

  const indexByName = new Map();
  for (const entry of index) {
    indexByName.set(entry.name, entry);
  }

  const explicitMatch = detectExplicitSkill(trimmedPrompt, index);
  const hasExplicit = explicitMatch !== null;
  const explicitSkill = hasExplicit ? explicitMatch.skill : null;
  const routingPrompt = hasExplicit ? explicitMatch.cleanedPrompt : trimmedPrompt;

  // Leaf-only index: router-* dispatchers must not compete in lexical
  // ranking; they stay available for explicit detection above.
  const leafIndex = index.filter((s) => !s.name.startsWith('router-'));

  // Sub-Phase 7.6: reuse the builder's pre-tokenized corpus when it still
  // matches this index; reported in telemetry as prebuilt: on|off.
  let prepared = null;
  try {
    prepared = prebuilt ? preparePrebuiltFor(index, leafIndex, prebuilt) : null;
  } catch {
    prepared = null; // stale/malformed cache falls back to the slow path
  }

  const cache = new QueryCache({ index: leafIndex, maxSize: 64, ttlMs: 300000 });
  let decision;
  try {
    decision = await cache.getOrSet(routingPrompt + (hasExplicit ? `|$${explicitSkill}` : ''), async (query, idx) => {
      if (hasExplicit) {
        // Explicit routing: scope BM25 to the router's domain
        return routeWithExplicit(query, index, explicitSkill);
      }
      // `slm.enabled` is false by default, so the branch below is the
      // production path; `routeHybrid` only runs when the operator opts in.
      const slmEnabled = config.slm?.enabled !== false;
      if (!slmEnabled) {
        // Lexical relevance floor: rankSkills returns every skill and every
        // skill has a non-zero cosine similarity, so without it the hook
        // would inject skills into unrelated prompts. Abstain instead.
        const minBm25Score = config.slm?.bm25MinThreshold ?? 0.35;
        const provider = getProvider();
        if (provider) {
          const hybridStart = performance.now();
          // Providers such as ONNX build their index asynchronously; the
          // race keeps a cold load from blowing through hook.timeoutMs.
          let ranked;
          try {
            // Pass the hook's topK cap so the fused list may be wider than
            // the retriever's own default (5); the per-skill floor below
            // still trims everything under the relevance threshold.
            const fused = await Promise.race([
              hybridRetrieve(query, idx, {
                provider,
                rerank: false,
                minBm25Score,
                topK,
                _prebuilt: prepared,
              }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('embedding retrieval timeout')), timeoutMs)
              ),
            ]);
            // P6-H-001: hybridRetrieve only abstains when the top fused score
            // is below the floor; the fused list can still carry lower-ranked
            // rows with a below-floor bm25Score (padding with unrelated skills).
            // Apply the same per-skill floor as the pure-BM25 branch below,
            // then let the uniform topK cap further down trim the survivors.
            ranked = fused.filter((r) => r.bm25Score >= minBm25Score);
          } catch (err) {
            await logError({ query, error: `hybrid retrieval degraded: ${err.message}` });
            ranked = rankSkills(query, idx, { _prebuilt: prepared }).filter((r) => r.score >= minBm25Score);
          }
          // No unfloored fallback: empty `ranked` means the floor rejected
          // every skill (finding B1); abstain rather than re-run unfloored.
          const bm25Ms = Math.round(performance.now() - hybridStart);
          // Confidence is on the BM25 scale (normalised [0,1]), comparable
          // with the confidence thresholds; the RRF score is on a different
          // scale entirely.
          const confidence = ranked.length > 0 ? ranked[0].bm25Score : 0;
          return {
            skills: ranked.map((r) => ({ name: r.skill.name, score: r.score })),
            tier: ranked.length > 0 ? 'bm25' : 'none',
            confidence,
            candidates: ranked.slice(0, config.slm?.topCandidates ?? 20).map((r) => ({
              name: r.skill.name,
              description: r.skill.description,
              bm25Score: r.bm25Score,
            })),
            latencyMs: { total: bm25Ms, bm25: bm25Ms, slmEnabled: false },
          };
        }
        // No provider — pure BM25 fallback; the relevance floor applies
        // here too, so an empty list means the hook abstains.
        const bm25Start = performance.now();
        const ranked = rankSkills(query, idx, { _prebuilt: prepared }).filter((r) => r.score >= minBm25Score);
        const bm25Ms = Math.round(performance.now() - bm25Start);
        const tier = ranked.length > 0 ? 'bm25' : 'none';
        const confidence = ranked.length > 0 ? ranked[0].score : 0;
        return {
          skills: ranked.map((r) => ({ name: r.skill.name, score: r.score })),
          tier,
          confidence,
          candidates: ranked.slice(0, config.slm?.topCandidates ?? 20).map((r) => ({
            name: r.skill.name,
            description: r.skill.description,
            bm25Score: r.score,
          })),
          latencyMs: { total: bm25Ms, bm25: bm25Ms, slmEnabled: false },
        };
      }
      return await Promise.race([
        routeHybrid(query, idx),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('routing timeout')), timeoutMs)
        ),
      ]);
    });
  } catch (err) {
    increment('errors.rerouting');
    await logError({ query: trimmedPrompt, error: err.message });
    await emitRouteEvent({ query: trimmedPrompt, tier: 'fail-open', reason: `retrieval error: ${err.message}`, indexLoadMs });
    emitMemProfile();
    process.exit(0);
  }

  // P6-H-001: apply the topK shortlist cap uniformly to every decision path
  // (implicit BM25, provider hybrid, SLM, explicit). The relevance floor
  // already removed unrelated skills; this bounds how many of the survivors
  // are ever injected, regardless of corpus size.
  const rankedNames = (decision.skills ?? []).slice(0, topK);
  const tier = decision.tier;
  const confidence = decision.confidence;
  const candidates = decision.candidates ?? [];
  const bm25Latency = decision.latencyMs?.bm25 ?? 0;
  const slmLatency = decision.latencyMs?.slm;
  const latency = Math.round(performance.now() - startTime);
  recordTiming('retrieve.latency', latency);
  increment('retrieve.count');

  await logRetrieve({
    query: trimmedPrompt,
    resultCount: rankedNames.length,
    durationMs: latency,
  });

  if (cache) {
    const cs = cache.getStats();
    await logRecord({
      event: 'cache',
      query: trimmedPrompt,
      cacheHits: cs.hits,
      cacheMisses: cs.misses,
      cacheTotal: cs.total,
      cacheHitRate: cs.hitRate,
      cacheSize: cache.size,
    });
  }

  // Shared fields for the route record (Sub-Phase 7.6); bm25Ms repeats
  // bm25Latency under its canonical name for new consumers.
  const routeExtra = {
    slmLatency, bm25Latency, bm25Ms: bm25Latency,
    explicit: decision.explicit ?? false,
    routerMatched: decision.routerMatched ?? null,
    mode: decision.mode ?? tier,
    slmEnabled: config.slm?.enabled ?? false,
    embeddingProvider: providerResolution.used,
    embeddingProviderFallback: providerResolution.fellBack,
    prebuilt: prepared ? 'on' : 'off',
    topK,
  };

  const modeLabel = (decision.explicit ?? false) ? 'explicit' : 'implicit';
  await logDecision({
    mode: modeLabel,
    router: decision.routerMatched ?? null,
    tier,
    selectedSkills: rankedNames.map((s) => s.name),
    latencyMs: { total: latency, bm25: bm25Latency },
    confidence,
    prompt: trimmedPrompt,
  });

  // Emit feedback signal if detected (fire-and-forget, never blocks routing)
  try {
    const promptHash = 'sha256:' + createHash('sha256').update(trimmedPrompt).digest('hex');
    const signal = trackPrompt(trimmedPrompt, promptHash);
    if (signal) {
      await recordSignal(signal);
    }
  } catch {
    // Signal logging failures must never block the hook
  }

  const contextBuildStart = performance.now();
  let contextBuildMs = 0;

  if (rankedNames.length === 0) {
    // Legitimate abstention (relevance floor), not a fail-open; the context
    // build was skipped and records 0.
    await emitRouteEvent({ query: trimmedPrompt, tier, candidates: candidates.map((c) => c.name), indexLoadMs, ...routeExtra });
    emitMemProfile();
    process.exit(0);
  }

  increment(`mode.${tier}`);

  const ranked = rankedNames.map((s) => ({
    skill: indexByName.get(s.name) ?? { name: s.name, path: '' },
    score: s.score,
  }));

  const skillsWithContent = await readSkillContent(ranked);

  // P6-H-002: the budget manager drops whole skills (never truncates),
  // ordered by score. readSkillContent skips unreadable files, so join
  // the scores back by name instead of relying on positional alignment.
  const scoreByName = new Map(ranked.map((r) => [r.skill.name, r.score]));
  const scoredItems = skillsWithContent.map((s) => ({
    name: s.name,
    content: s.content,
    score: scoreByName.get(s.name) ?? 0,
  }));

  const { selected, totalChars, droppedCount, rejected } = fitWithinBudget(scoredItems, {
    maxChars: budgetMaxChars,
  });

  await logRecord({
    event: 'budget',
    query: trimmedPrompt,
    totalSkills: skillsWithContent.length,
    selectedCount: selected.length,
    injectedCount: selected.length,
    topK,
    rawTotalChars: skillsWithContent.reduce((s, sk) => s + sk.content.length, 0),
    injectedChars: totalChars,
    budgetMaxChars,
    // P6-H-002: hard-limit accounting — what actually went in, the cap, how
    // many whole skills were dropped, and whether even the top skill was
    // rejected (empty context, fail-open).
    budgetChars: totalChars,
    budgetMax: budgetMaxChars,
    budgetDropped: droppedCount,
    ...(rejected ? { budgetRejected: true } : {}),
  });

  const additionalContext = buildContext(selected, decision);
  contextBuildMs = performance.now() - contextBuildStart;

  const output = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext,
    },
    RoutePlan: {
      mode: decision.mode ?? tier,
      domains: [],
      primary: null,
      candidates: candidates.map((c) => ({ name: c.name, score: c.bm25Score })),
      latencyMs: latency,
    },
  };

  // Write output.json alongside additionalContext
  const outputPath = join(safeCwd, '.zcode', 'output.json');
  try {
    const fs = await import('node:fs/promises');
    await fs.mkdir(join(safeCwd, '.zcode'), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(output), 'utf-8');
  } catch {
    writeFileSync(join(safeCwd, '.zcode', 'output.json'), JSON.stringify(output), 'utf-8');
  }

  // Complete route telemetry (emitted last so totalMs covers the whole invocation).
  await emitRouteEvent({ query: trimmedPrompt, tier, candidates: candidates.map((c) => c.name), indexLoadMs, contextBuildMs, ...routeExtra });
  emitMemProfile();
  process.exit(0);
}

// Error boundary: any uncaught error → exit 0, log to stderr
main().catch(async (err) => {
  if (process.env.SKILL_ROUTER_DEBUG) console.error('[skill-router] unhandled error:', err.message);
  await emitRouteEvent({ query: null, tier: 'fail-open', reason: `unhandled error: ${err.message}` }).catch(() => {});
  process.exit(0);
});
