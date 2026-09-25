/**
 * Route planner module — multi-domain fan-out routing.
 *
 * Plans which skills to retrieve and in what order based on detected domains
 * and query complexity. Supports three modes:
 *   - single  : one domain with confidence > domainThreshold (0.90) AND a clear gap
 *   - multi   : two or more domains each with confidence >= multiDomainThreshold (0.50)
 *                AND no single domain strongly dominates
 *   - fallback: no strong domain signal → top-k BM25 retrieval
 */
import { rankSkills } from '../retriever/bm25.mjs';
import { hybridRetrieve } from '../retriever/hybrid.mjs';
import { detectDomains } from './detector.mjs';
import { getConfig } from '../../config/env.mjs';

const config = getConfig();
const { domainThreshold, multiDomainThreshold } = config.routing;
// Single-domain needs strong confidence with a clear gap over the runner-up
const SINGLE_THRESHOLD = domainThreshold ?? 0.90;
const SINGLE_GAP = 0.15; // minimum gap over second domain to qualify as single
// Multi-domain requires multiple strong signals without one dominating
const MULTI_THRESHOLD = multiDomainThreshold ?? 0.50;

/**
 * A RoutePlan describes how the query should be routed.
 *
 * @typedef {Object} RoutePlan
 * @property {"single"|"multi"|"fallback"} mode
 * @property {Array<{name:string, skills:Array<string>}>} domains
 * @property {string|null} primary — name of the highest-confidence domain
 * @property {Array<{skill: object, score: number}>} ranked — top-k ranked skills
 */

/**
 * Plan routes for a given query against the skill index.
 *
 * @param {string} query
 * @param {Array<{name:string, description:string, keywords:string[], domains:string[], path:string, version:string}>} index
 * @param {object} [options]
 * @param {"bm25"|"hybrid"} [options.mode] — retrieval backend to use
 * @param {number} [options.topK] — number of skills per domain (default 5)
 * @returns {RoutePlan}
 */
export function planRoutes(query, index, options = {}) {
  const topK = options.topK ?? 5;
  // Default to BM25 for domain-based routing. Hybrid (weighted RRF) changes
  // ranking order compared to pure BM25, which breaks the routing test
  // expectations. The planner's job is domain detection, not semantic fusion.
  const retrievalMode = options.mode ?? 'bm25';

  // ── Detect domains ───────────────────────────────────────────────────────
  const domainMatches = detectDomains(query, index);

  // ── Single-domain: one domain clearly dominates ──────────────────────────
  // Priority: single wins when one domain is strong AND has a meaningful
  // gap over the second-highest. This must be checked BEFORE multi to
  // avoid ambiguous queries being routed multi when one domain is dominant.
  if (
    domainMatches.length > 0 &&
    domainMatches[0].confidence > SINGLE_THRESHOLD
  ) {
    const gap =
      domainMatches.length > 1
        ? domainMatches[0].confidence - domainMatches[1].confidence
        : 1.0;

    if (gap >= SINGLE_GAP) {
      const primaryDomain = domainMatches[0].domain;
      const domainSkills = index
        .filter((s) => s.domains.includes(primaryDomain))
        .map((s) => s.name);

      const ranked =
        retrievalMode === 'hybrid'
          ? hybridRetrieve(query, index, { topK })
          : rankSkills(query, index);

      const scored = ranked.map((r) => ({
        ...r,
        score: domainSkills.includes(r.skill.name) ? r.score : 0,
      }));
      scored.sort((a, b) => b.score - a.score);

      return {
        mode: 'single',
        domains: [{ name: primaryDomain, skills: domainSkills }],
        primary: primaryDomain,
        ranked: scored.slice(0, topK),
      };
    }
  }

  // ── Multi-domain: 2+ strong domains, no single dominates ────────────────
  // Only reached when no single domain has both high confidence AND a clear gap.
  const qualifyingDomains = domainMatches.filter(
    (d) => d.confidence >= MULTI_THRESHOLD
  );

  if (qualifyingDomains.length >= 2) {
    // Run hybrid retrieve ONCE and distribute scores across domains
    const ranked =
      retrievalMode === 'hybrid'
        ? hybridRetrieve(query, index, { topK })
        : rankSkills(query, index);

    const domainSkillScores = new Map();
    for (const { domain } of qualifyingDomains) {
      const domainSkillNames = new Set(
        index.filter((s) => s.domains.includes(domain)).map((s) => s.name)
      );
      for (const r of ranked) {
        if (domainSkillNames.has(r.skill.name)) {
          let existing = domainSkillScores.get(r.skill.name);
          if (!existing) {
            existing = { score: 0, domainCount: 0 };
            domainSkillScores.set(r.skill.name, existing);
          }
          existing.score += 1 / (ranked.indexOf(r) + 1);
          existing.domainCount++;
        }
      }
    }

    const merged = [...domainSkillScores.entries()]
      .map(([name, data]) => {
        const skill = index.find((s) => s.name === name);
        return { skill, score: data.score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    const domains = qualifyingDomains.map((d) => ({
      name: d.domain,
      skills: index
        .filter((s) => s.domains.includes(d.domain))
        .map((s) => s.name),
    }));

    return {
      mode: 'multi',
      domains,
      primary: qualifyingDomains[0].domain,
      ranked: merged,
    };
  }

  // ── Fallback ─────────────────────────────────────────────────────────────
  const ranked =
    retrievalMode === 'hybrid'
      ? hybridRetrieve(query, index, { topK })
      : rankSkills(query, index);

  return {
    mode: 'fallback',
    domains: [],
    primary: null,
    ranked,
  };
}
