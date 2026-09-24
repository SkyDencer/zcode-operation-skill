/**
 * ZCode route hook — intercepts UserPromptSubmit, retrieves relevant
 * skills via hybrid SLM+BM25 routing, and injects context into the model.
 *
 * Reads JSON from stdin, detects explicit `$`-mentions (e.g. `$next`,
 * `$laravel`) before retrieval, scopes BM25 to the matched router's
 * domain when found, otherwise falls back to routeHybrid(). Writes the
 * output plan to .zcode/output.json alongside an additionalContext block.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankSkills, readSkillContent } from '../src/index.mjs';
import { logRetrieve, logError, logRecord } from '../src/core/telemetry/logger.mjs';
import { increment, recordTiming } from '../src/core/telemetry/metrics.mjs';
import { logDecision } from '../src/telemetry/feedback.mjs';
import { getConfig } from '../src/config/env.mjs';
import { routeHybrid, routeWithExplicit } from '../src/core/routing/hybrid.mjs';
import { detectExplicitSkill } from '../src/core/routing/explicit.mjs';
import { fitWithinBudget } from '../src/core/budget/manager.mjs';
import { now } from '../src/utils/time.mjs';
import { QueryCache } from '../src/core/cache/query-cache.mjs';

const HOOK_DIR = resolve(fileURLToPath(import.meta.url), '..');
const INDEX_PATH = resolve(HOOK_DIR, '..', 'data', 'skill-index.json');

const config = getConfig();
const { timeoutMs, maxPromptLength } = config.hook;
const { maxChars: budgetMaxChars, minPerSkill: budgetMinPerSkill } = config.budget;

/**
 * Build the additionalContext string from ranked skills.
 *
 * Includes a Mode line that distinguishes explicit ([$mention]) from
 * implicit (BM25/SLM) routing, plus routerMatched info for telemetry.
 *
 * @param {Array<{name:string, content:string}>} skillsWithContent
 * @param {{tier:string, confidence:number, skills:Array<{name:string}>, explicit?:boolean, routerMatched?:string|null, mode?:string}} decision
 * @returns {string}
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

/**
 * Main entry point for the route hook.
 */
async function main() {
  let input = '';
  const chunks = [];

  // Read all stdin
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  input = Buffer.concat(chunks).toString('utf-8');

  // Input validation
  if (!input.trim()) {
    process.exit(0);
  }

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    // Malformed JSON — fail open
    process.exit(0);
  }

  const { prompt, cwd } = payload;

  // Missing fields → safe defaults
  const safePrompt = typeof prompt === 'string' ? prompt : '';
  const safeCwd = typeof cwd === 'string' ? cwd : process.cwd();

  // Truncate oversized prompts
  const trimmedPrompt =
    safePrompt.length > maxPromptLength
      ? safePrompt.slice(0, maxPromptLength)
      : safePrompt;

  if (trimmedPrompt.trim() === '') {
    process.exit(0);
  }

  const startTime = performance.now();

  let index;
  try {
    const raw = readFileSync(INDEX_PATH, 'utf-8');
    index = JSON.parse(raw);
  } catch {
    // Index not found — fail open
    increment('errors.index_missing');
    await logError({ query: trimmedPrompt, error: 'index not found' });
    process.exit(0);
  }

  // Build name→index-entry map for path lookup
  const indexByName = new Map();
  for (const entry of index) {
    indexByName.set(entry.name, entry);
  }

  // Detect explicit $-mention BEFORE retrieval
  const explicitMatch = detectExplicitSkill(trimmedPrompt, index);
  const hasExplicit = explicitMatch !== null;
  const explicitSkill = hasExplicit ? explicitMatch.skill : null;
  // Use cleaned prompt for routing when explicit match found
  const routingPrompt = hasExplicit ? explicitMatch.cleanedPrompt : trimmedPrompt;

  // Build a leaf-only index for implicit BM25 routing.
  // Router skills (router-*) are dispatchers, not content skills — they must
  // not compete in lexical ranking. They remain available for explicit detection
  // via detectExplicitSkill above.
  const leafIndex = index.filter((s) => !s.name.startsWith('router-'));

  // Timeout guard: wrap retrieval in Promise.race
  const cache = new QueryCache({ index: leafIndex, maxSize: 64, ttlMs: 300000 });
  let decision;
  try {
    decision = await cache.getOrSet(routingPrompt + (hasExplicit ? `|$${explicitSkill}` : ''), async (query, idx) => {
      if (hasExplicit) {
        // Explicit routing: scope BM25 to the router's domain
        return routeWithExplicit(query, index, explicitSkill);
      }
      // Implicit routing: full hybrid pipeline on leaf skills only
      const slmEnabled = config.slm?.enabled !== false;
      if (!slmEnabled) {
        const ranked = rankSkills(query, idx);
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
          latencyMs: { total: 0, bm25: 0, slmEnabled: false },
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

  // Log cache stats when available
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

  // Log routing-specific telemetry including explicit/implicit mode
  await logRecord({
    event: 'route',
    query: trimmedPrompt,
    tier,
    candidates: candidates.map((c) => c.name),
    slmLatency,
    bm25Latency,
    explicit: decision.explicit ?? false,
    routerMatched: decision.routerMatched ?? null,
    mode: decision.mode ?? tier,
    slmEnabled: config.slm?.enabled ?? false,
  });

  // Log structured routing decision for feedback analytics
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

  if (rankedNames.length === 0) {
    process.exit(0);
  }

  increment(`mode.${tier}`);

  // Augment ranked names with full index entries (for path resolution)
  const ranked = rankedNames.map((s) => ({
    skill: indexByName.get(s.name) ?? { name: s.name, path: '' },
    score: s.score,
  }));

  const skillsWithContent = await readSkillContent(ranked);

  // Fit into context budget with paragraph-safe truncation
  const { selected, totalChars } = fitWithinBudget(skillsWithContent, {
    maxChars: budgetMaxChars,
    minPerSkill: budgetMinPerSkill,
  });

  // Log actual injected context size for telemetry
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

  // Write output alongside additionalContext
  const outputPath = join(safeCwd, '.zcode', 'output.json');
  try {
    const fs = await import('node:fs/promises');
    await fs.mkdir(join(safeCwd, '.zcode'), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(output), 'utf-8');
  } catch (err) {
    writeFileSync(join(safeCwd, '.zcode', 'output.json'), JSON.stringify(output), 'utf-8');
  }

  process.exit(0);
}

// Error boundary: any uncaught error → exit 0, log to stderr
main().catch((err) => {
  if (process.env.SKILL_ROUTER_DEBUG) console.error('[skill-router] unhandled error:', err.message);
  process.exit(0);
});
