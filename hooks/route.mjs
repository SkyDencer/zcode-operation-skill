/**
 * ZCode route hook — intercepts UserPromptSubmit, retrieves relevant
 * skills via BM25, and injects context into the model.
 *
 * Reads JSON from stdin, ranks skills, applies confidence policy,
 * and writes the output plan to .zcode/output.json alongside
 * an additionalContext block.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankSkills, readSkillContent } from '../src/index.mjs';
import { logRetrieve, logError, logRecord } from '../src/core/telemetry/logger.mjs';
import { increment, recordTiming } from '../src/core/telemetry/metrics.mjs';
import { getConfig } from '../src/config/env.mjs';
import { planRoutes } from '../src/core/routing/planner.mjs';
import { routeHierarchical } from '../src/core/routing/hierarchical.mjs';
import { fitWithinBudget } from '../src/core/budget/manager.mjs';
import { now } from '../src/utils/time.mjs';
import { QueryCache } from '../src/core/cache/query-cache.mjs';
import { selectRouter } from '../src/routing/selector.mjs';

const HOOK_DIR = resolve(fileURLToPath(import.meta.url), '..');
const INDEX_PATH = resolve(HOOK_DIR, '..', 'data', 'skill-index.json');

const config = getConfig();
const { timeoutMs, maxPromptLength } = config.hook;
const { maxChars: budgetMaxChars, minPerSkill: budgetMinPerSkill } = config.budget;

// CLI flag: --hierarchical forces hierarchical mode
const useHierarchical = process.argv.includes('--hierarchical');

/**
 * Build the additionalContext string from ranked skills.
 *
 * @param {Array<{name:string, content:string}>} skillsWithContent
 * @returns {string}
 */
function buildContext(skillsWithContent) {
  if (skillsWithContent.length === 0) return '';
  const lines = ['== SKILL CONTEXT ==', ''];
  for (const s of skillsWithContent) {
    lines.push(`# ${s.name}`);
    lines.push('');
    lines.push(s.content.trim());
    lines.push('');
  }
  lines.push('== END SKILL CONTEXT ==');
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

  // Timeout guard: wrap retrieval in Promise.race
  // Build query cache keyed by index fingerprint
  const cache = new QueryCache({ index, maxSize: 64, ttlMs: 300000 });
  let plan;
  let routerMode;
  try {
    // Select routing strategy based on corpus size and options
    const routerMode = selectRouter(index.length, {
      mode: useHierarchical ? 'hierarchical' : undefined,
      experimental: process.argv.includes('--experimental'),
    });

    if (routerMode === 'hierarchical') {
      plan = await cache.getOrSet(trimmedPrompt, async (query, idx) => {
        return await Promise.race([
          routeHierarchical(query, idx),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('routing timeout')), timeoutMs)
          ),
        ]);
      });
    } else {
      plan = await cache.getOrSet(trimmedPrompt, async (query, idx) => {
        return await Promise.race([
          planRoutes(query, idx),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('routing timeout')), timeoutMs)
          ),
        ]);
      });
    }
  } catch (err) {
    increment('errors.rerouting');
    await logError({ query: trimmedPrompt, error: err.message });
    process.exit(0);
  }

  // Normalize plan shape: hierarchical uses 'skills' + 'primaryDomain',
  // planner uses 'ranked' + 'primary'. Unify to 'ranked' + 'primary'.
  const ranked = plan.skills ?? plan.ranked;
  const primary = plan.primaryDomain ?? plan.primary;
  const mode = plan.mode;
  const domains = plan.domains;
  const latency = Math.round(performance.now() - startTime);
  recordTiming('retrieve.latency', latency);
  increment('retrieve.count');

  await logRetrieve({
    query: trimmedPrompt,
    resultCount: ranked.length,
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

  if (ranked.length === 0) {
    process.exit(0);
  }

  increment(`mode.${mode}`);

  // Log routing strategy selection for telemetry
  await logRecord({
    event: 'route',
    query: trimmedPrompt,
    corpusSize: index.length,
    routerMode,
  });

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

  const additionalContext = buildContext(selected);

  const output = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext,
    },
    RoutePlan: {
      mode,
      domains,
      primary,
      candidates: ranked.map((r) => ({ name: r.skill.name, score: r.score })),
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
