/**
 * Hybrid SLM+BM25 routing engine.
 *
 * Combines lexical BM25 retrieval with a local small-language-model (SLM)
 * reranker. The pipeline is:
 *
 *  1. Run BM25 top-N retrieval (default N=20).
 *  2. If the top BM25 score is below the minimum threshold, return tier:'none'.
 *  3. If SLM is enabled and there are >= 2 candidates, query the SLM to
 *     select the best skill(s) from the BM25 top candidates.
 *  4. If the SLM returns >= 1 valid skill with confidence >= slmMinConfidence,
 *     use the SLM result as the final ranking.
 *  5. Otherwise, fall back to the BM25 top-1 / top-3 results.
 *  6. If no candidates remain at any stage, return tier:'none'.
 *
 * All SLM interactions are wrapped in a timeout guard; on timeout or
 * unavailability the engine degrades gracefully to pure BM25.
 *
 * @module src/core/routing/hybrid
 */

import { rankSkills } from '../retriever/bm25.mjs';
import { SlmClient } from '../slm/client.mjs';
import { parseMultiSelection } from '../slm/parser.mjs';
import { buildMultiSelectorPrompt } from '../slm/prompt-builder.mjs';
import { getDefaults } from '../../config/defaults.mjs';
import { ROUTER_DOMAINS } from './explicit.mjs';

const cfg = getDefaults();
const _slmCfg = cfg.slm ?? {};

/**
 * Build a SlmClient configured from the active defaults.
 *
 * @returns {import('../slm/client.mjs').SlmClient}
 */
function buildSlmClient() {
  return new SlmClient({
    endpoint: _slmCfg.endpoint ?? 'http://127.0.0.1:8080',
    model: _slmCfg.model ?? 'qwen2.5',
    timeoutMs: _slmCfg.slmTimeoutMs ?? 2000,
  });
}

/**
 * Build a RouteDecision object from pipeline results.
 *
 * @param {Array<{name:string, score:number, reason?:string}>} skills
 * @param {'hybrid'|'bm25'|'heuristic'|'none'} tier
 * @param {number} confidence
 * @param {Array<{name:string, description:string, bm25Score:number}>} candidates
 * @param {{total:number, bm25:number, slm?:number}} latencies
 * @param {object} [extra] — additional fields (e.g. {explicit, routerMatched, mode})
 * @returns {{skills:Array<{name:string,score:number,reason?:string}>, tier:'hybrid'|'bm25'|'heuristic'|'none', confidence:number, candidates:Array<{name:string,description:string,bm25Score:number}>, latencyMs:{total:number,bm25:number,slm?:number}, explicit?:boolean, routerMatched?:string|null, mode?:string}}
 */
function buildDecision(skills, tier, confidence, candidates, latencies, extra = {}) {
  return { skills, tier, confidence, candidates, latencyMs: latencies, ...extra };
}

/**
 * Run the hybrid routing pipeline (async because SLM calls are async).
 *
 * @param {string} task — user authoring prompt / task description
 * @param {Array<{name:string, description:string, keywords:string[], domains:string[], path:string, version:string}>} index — flat skill index
 * @param {object} [options]
 * @param {number} [options.topCandidates] — BM25 top-N (default 20)
 * @param {number} [options.maxSelected] — cap on final selected skills (default 7)
 * @param {number} [options.bm25MinThreshold] — minimum top BM25 score to proceed (default 0.35)
 * @param {number} [options.slmMinConfidence] — minimum SLM confidence to accept SLM results (default 0.5)
 * @param {number} [options.slmTimeoutMs] — override SLM timeout (uses default if omitted)
 * @param {boolean} [options.slmEnabled] — force-enable/disable SLM override
 * @param {boolean} [options.useSlm] — alias for slmEnabled (backward compat)
 * @returns {Promise<{skills:Array<{name:string,score:number,reason?:string}>, tier:'hybrid'|'bm25'|'heuristic'|'none', confidence:number, candidates:Array<{name:string,description:string,bm25Score:number}>, latencyMs:{total:number,bm25:number,slm?:number}, explicit?:boolean, routerMatched?:string|null, mode?:string}>}
 */
export async function routeHybrid(task, index, options = {}) {
  const t0 = performance.now();

  const topCandidates = options.topCandidates ?? _slmCfg.topCandidates ?? 20;
  const maxSelected = options.maxSelected ?? _slmCfg.maxSelected ?? 7;
  const bm25MinThreshold = options.bm25MinThreshold ?? _slmCfg.bm25MinThreshold ?? 0.35;
  const slmMinConfidence = options.slmMinConfidence ?? _slmCfg.slmMinConfidence ?? 0.5;
  const slmTimeoutMs = options.slmTimeoutMs ?? _slmCfg.slmTimeoutMs ?? 2000;
  // slmEnabled wins over useSlm; falls back to cfg default
  const slmEnabled =
    typeof options.slmEnabled === 'boolean'
      ? options.slmEnabled
      : typeof options.useSlm === 'boolean'
        ? options.useSlm
        : _slmCfg.enabled !== false;

  // ── Step 1: BM25 top-N ─────────────────────────────────────────────────────
  const bm25Start = performance.now();
  const bm25Ranked = rankSkills(task, index);
  const bm25Latency = Math.round(performance.now() - bm25Start);

  // Clamp to topCandidates
  const candidates = bm25Ranked.slice(0, topCandidates).map((r) => ({
    name: r.skill.name,
    description: r.skill.description,
    bm25Score: r.score,
  }));

  // ── Step 2: Quick exit if top BM25 score is too low ───────────────────────
  const topBm25Score = candidates.length > 0 ? candidates[0].bm25Score : 0;
  if (topBm25Score < bm25MinThreshold) {
    return buildDecision([], 'none', 0, candidates, { total: Math.round(performance.now() - t0), bm25: bm25Latency });
  }

  // ── Step 3: Try SLM reranking ──────────────────────────────────────────────
  let slmLatency = 0;
  let slmSkills = [];

  if (slmEnabled && candidates.length >= 2) {
    const client = buildSlmClient();
    // Override client timeout so routeHybrid owns the deadline
    client.timeoutMs = slmTimeoutMs;
    // Allow per-call endpoint override (useful for tests with mock servers)
    if (options.endpoint) {
      client.endpoint = options.endpoint;
    }

    try {
      const { system, user } = buildMultiSelectorPrompt(task, candidates);
      const slmStart = performance.now();
      const result = await client.chat([
        { role: 'system', content: system },
        { role: 'user', content: user },
      ]);
      slmLatency = Math.round(performance.now() - slmStart);

      // ── Step 4: Validate SLM response ────────────────────────────────────
      const knownNames = candidates.map((c) => c.name);
      const parsed = parseMultiSelection(result.content, knownNames);
      slmSkills = parsed.skills
        .filter((s) => s.score >= slmMinConfidence)
        .slice(0, maxSelected);
    } catch {
      // SLM unavailable or timed out — degrade to BM25 fallback (step 5)
      slmSkills = [];
    }
  }

  // ── Step 4/5: Decide which tier to return ──────────────────────────────────
  if (slmSkills.length >= 1) {
    // SLM produced valid results — use them
    return buildDecision(
      slmSkills,
      'hybrid',
      slmSkills[0].score,
      candidates,
      { total: Math.round(performance.now() - t0), bm25: bm25Latency, slm: slmLatency },
    );
  }

  // ── Step 5: Fallback to BM25 top-1 / top-3 ─────────────────────────────────
  const fallbackCount = candidates.length >= 3 ? 3 : Math.max(1, candidates.length);
  const fallbackSkills = candidates.slice(0, fallbackCount).map((c) => ({
    name: c.name,
    score: c.bm25Score,
  }));

  if (fallbackSkills.length === 0) {
    return buildDecision([], 'none', 0, candidates, { total: Math.round(performance.now() - t0), bm25: bm25Latency });
  }

  return buildDecision(
    fallbackSkills,
    'bm25',
    fallbackSkills[0].score,
    candidates,
    { total: Math.round(performance.now() - t0), bm25: bm25Latency },
  );
}

/**
 * Explicit router dispatch: when the user includes a `$` mention, scope
 * BM25 retrieval to the leaf skills belonging to that router's domain,
 * then pick the single top-ranked result.
 *
 * This bypasses SLM entirely — the $-mention IS the routing signal.
 *
 * @param {string} task — the cleaned prompt (after stripping the $mention)
 * @param {Array<{name:string, description:string, keywords:string[], domains:string[], path:string, version:string}>} index — full skill index
 * @param {string} explicitSkill — the resolved router skill name (e.g. "router-next")
 * @param {object} [options]
 * @param {number} [options.bm25MinThreshold] — minimum top BM25 score to proceed (default 0.35)
 * @returns {{skills:Array<{name:string,score:number,reason?:string}>, tier:string, confidence:number, candidates:Array<{name:string,description:string,bm25Score:number}>, latencyMs:{total:number,bm25:number}, explicit:true, routerMatched:string, mode:'explicit'}}
 */
export function routeWithExplicit(task, index, explicitSkill, options = {}) {
  const t0 = performance.now();
  const bm25MinThreshold = options.bm25MinThreshold ?? _slmCfg.bm25MinThreshold ?? 0.35;

  // Determine which domains this router dispatches to.
  const targetDomains = ROUTER_DOMAINS[explicitSkill] ?? [];

  // Filter index to leaf skills in the target domain(s).
  const domainSkills = targetDomains.length > 0
    ? index.filter((skill) => skill.domains && skill.domains.some((d) => targetDomains.includes(d)))
    : index;

  // Run BM25 within the scoped subset.
  const bm25Start = performance.now();
  const ranked = rankSkills(task, domainSkills);
  const bm25Latency = Math.round(performance.now() - bm25Start);

  if (ranked.length === 0) {
    return buildDecision(
      [], 'bm25', 0, [],
      { total: Math.round(performance.now() - t0), bm25: bm25Latency },
      { explicit: true, routerMatched: explicitSkill, mode: 'explicit' },
    );
  }

  const topScore = ranked[0].score;
  if (topScore < bm25MinThreshold) {
    return buildDecision(
      [], 'none', 0, [],
      { total: Math.round(performance.now() - t0), bm25: bm25Latency },
      { explicit: true, routerMatched: explicitSkill, mode: 'explicit' },
    );
  }

  // Pick top-1 from the scoped subset.
  const skills = ranked.slice(0, 1).map((r) => ({
    name: r.skill.name,
    score: r.score,
    reason: `Explicit ${explicitSkill} dispatch`,
  }));

  const candidates = ranked.slice(0, 5).map((r) => ({
    name: r.skill.name,
    description: r.skill.description,
    bm25Score: r.score,
  }));

  return buildDecision(
    skills,
    'bm25',
    skills[0]?.score ?? 0,
    candidates,
    { total: Math.round(performance.now() - t0), bm25: bm25Latency },
    { explicit: true, routerMatched: explicitSkill, mode: 'explicit' },
  );
}
