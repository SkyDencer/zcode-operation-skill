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
const { maxChars: budgetMaxChars, minPerSkill: budgetMinPerSkill } = config.budget;

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
    `Selected: ${decision.skills.map((s) => s.name).join(', ')}`,
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
  const safeCwd = typeof cwd === 'string' ? cwd : process.cwd();

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
            ranked = await Promise.race([
              hybridRetrieve(query, idx, { provider, rerank: false, minBm25Score, _prebuilt: prepared }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('embedding retrieval timeout')), timeoutMs)
              ),
            ]);
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

  const rankedNames = decision.skills ?? [];
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

  const { selected, totalChars } = fitWithinBudget(skillsWithContent, {
    maxChars: budgetMaxChars,
    minPerSkill: budgetMinPerSkill,
  });

  await logRecord({
    event: 'budget',
    query: trimmedPrompt,
    totalSkills: skillsWithContent.length,
    selectedCount: selected.length,
    rawTotalChars: skillsWithContent.reduce((s, sk) => s + sk.content.length, 0),
    injectedChars: totalChars,
    budgetMaxChars,
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
