/**
 * Hierarchical routing module — domain-first retrieval for scale.
 *
 * Three-stage pipeline:
 *   Stage 1: Detect top-3 candidate domains via keyword/description matching
 *            against domain registry metadata (fast, O(domains × query_tokens)).
 *   Stage 2: Run BM25 within each candidate domain only (not across all skills).
 *   Stage 3: Merge results, rerank by confidence, return HierarchicalPlan.
 *
 * This approach reduces BM25 scoring from O(N) to O(N_candidates × avg_domain_size),
 * yielding large latency gains when the corpus is large but domains are narrow.
 */
import { tokenize } from '../../utils/text.mjs';
import { computeIdf, bm25 } from '../../scorer.mjs';
import { rankSkills } from '../retriever/bm25.mjs';
import { readAllDomainMeta, matchDomainsToQuery } from './domain-registry.mjs';
import { getConfig } from '../../config/env.mjs';

const config = getConfig();
const { k1, b, nameWeight, descriptionWeight, keywordWeight } = config.bm25;
const { hierarchicalTopDomains = 3, hierarchicalConfidenceThreshold = 0.08 } = config.routing;

/**
 * A HierarchicalPlan describes the outcome of hierarchical routing.
 *
 * @typedef {Object} HierarchicalPlan
 * @property {"hierarchical"} mode — always "hierarchical"
 * @property {Array<{name:string, confidence:number}>} domains — detected domains with scores
 * @property {Array<{skill: object, score: number, domain: string}>} skills — merged ranked skills
 * @property {string|null} primaryDomain — highest-confidence domain
 * @property {number} candidateDomainCount — how many domains were queried
 * @property {number} totalSkillsScored — total skills hit across all domains
 */

/**
 * Route a query hierarchically: detect domains → BM25 per domain → merge & rerank.
 *
 * @param {string} query
 * @param {Array<{name:string, description:string, keywords:string[], domains:string[]}>} index
 * @param {object} [options]
 * @param {number} [options.topK] — final number of skills to return (default 5)
 * @param {number} [options.topDomains] — number of candidate domains to query (default 3)
 * @returns {HierarchicalPlan}
 */
export function routeHierarchical(query, index, options = {}) {
  const topK = options.topK ?? 5;
  const topDomains = options.topDomains ?? hierarchicalTopDomains;

  if (!query || !index || index.length === 0) {
    return {
      mode: 'hierarchical',
      domains: [],
      skills: [],
      primaryDomain: null,
      candidateDomainCount: 0,
      totalSkillsScored: 0,
    };
  }

  // ── Stage 1: Detect top candidate domains ─────────────────────────────────
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return fallbackPlan(index, topK, query);
  }

  const domainMetas = readAllDomainMeta();
  let domainMatches = [];

  if (domainMetas.length > 0) {
    const matched = matchDomainsToQuery(queryTokens, domainMetas);
    domainMatches = [...matched.entries()]
      .map(([name, scores]) => ({
        domain: name,
        confidence: scores.totalScore,
        keywordScore: scores.keywordScore,
        descriptionScore: scores.descriptionScore,
      }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, topDomains);
  }

  // Filter out domains that have no skills in the index (stale metadata)
  // and re-rank after filtering
  if (domainMatches.length > 0) {
    const validMatches = domainMatches.filter((d) => {
      const hasSkills = index.some((s) => (s.domains || []).includes(d.domain));
      return hasSkills;
    });
    if (validMatches.length > 0) {
      domainMatches = validMatches.slice(0, topDomains);
    }
  }

  // If no domain metadata exists or all were filtered out, fall back to using skill domains directly
  if (domainMatches.length === 0) {
    domainMatches = collectDomainsFromIndex(index, queryTokens, topDomains);
  }

  // Threshold check: if the top domain confidence is too weak, skip hierarchical
  // routing and fall back to flat BM25 across all skills. This avoids the case
  // where placeholder/weak domain signals incorrectly narrow the search space.
  const topConfidence = domainMatches.length > 0 ? domainMatches[0].confidence : 0;
  if (topConfidence < hierarchicalConfidenceThreshold) {
    return fallbackPlan(index, topK, query);
  }

  // ── Stage 2: BM25 within each candidate domain ────────────────────────────
  const domainResults = new Map(); // domain → [{skill, rawScore}]
  let totalSkillsScored = 0;

  for (const { domain } of domainMatches) {
    const domainSkills = index.filter((s) => (s.domains || []).includes(domain));
    if (domainSkills.length === 0) continue;

    const scored = rankSkills(query, domainSkills);
    domainResults.set(domain, scored);
    totalSkillsScored += scored.length;
  }

  // ── Stage 3: Merge, rerank by confidence ──────────────────────────────────
  const merged = mergeAndRerank(domainResults, domainMatches, index);
  const topSkills = merged.slice(0, topK);

  // Assign domain to each skill
  const skills = topSkills.map((r) => ({
    ...r,
    domain: findPrimaryDomain(r.skill.name, domainResults),
  }));

  const primaryDomain =
    domainMatches.length > 0 ? domainMatches[0].domain : null;

  return {
    mode: 'hierarchical',
    domains: domainMatches.map((d) => ({
      name: d.domain,
      confidence: d.confidence,
    })),
    skills,
    primaryDomain,
    candidateDomainCount: domainMatches.length,
    totalSkillsScored,
  };
}

/**
 * Fallback plan when no query tokens, no domains match, or confidence is too low.
 * Runs full BM25 across all skills with the original query.
 */
function fallbackPlan(index, topK, query) {
  const ranked = rankSkills(query ?? '', index);
  return {
    mode: 'hierarchical',
    domains: [],
    skills: ranked.slice(0, topK),
    primaryDomain: null,
    candidateDomainCount: 0,
    totalSkillsScored: index.length,
  };
}

/**
 * When no domain registry exists, infer domains directly from the skill index.
 */
function collectDomainsFromIndex(index, queryTokens, topN) {
  const domainScores = new Map();

  for (const skill of index) {
    for (const domain of skill.domains || []) {
      if (!domainScores.has(domain)) {
        domainScores.set(domain, { domain, score: 0, skills: new Set() });
      }
      const agg = domainScores.get(domain);
      agg.skills.add(skill.name);

      // Simple keyword overlap as domain relevance signal
      const domainKeywords = new Set(
        (skill.keywords || []).concat([skill.name, skill.description])
          .join(' ')
          .toLowerCase()
          .split(/\s+/)
      );
      for (const qt of queryTokens) {
        if (domainKeywords.has(qt)) agg.score++;
      }
    }
  }

  return [...domainScores.values()]
    .map((d) => ({
      domain: d.domain,
      confidence: Math.round((d.score / Math.max(queryTokens.length, 1)) * 100) / 100,
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, topN);
}

/**
 * Merge per-domain BM25 results and rerank.
 *
 * Strategy: for each skill, take its best score across domains,
 * then apply a domain-confidence bonus: skills in the primary domain
 * get a small multiplicative boost.
 */
function mergeAndRerank(domainResults, domainMatches, index) {
  const skillBest = new Map(); // skillName → { score, domain }

  for (const [domain, scored] of domainResults) {
    for (const { skill, score } of scored) {
      const existing = skillBest.get(skill.name);
      if (!existing || score > existing.score) {
        skillBest.set(skill.name, { score, domain });
      }
    }
  }

  // Domain confidence bonus: apply only when top confidence is strong enough
  // to justify narrowing the search. Weak signals get no bonus.
  const domainBonus = new Map();
  const bonusThreshold = 0.15; // only bonus when primary confidence >= this
  domainMatches.forEach((d, i) => {
    if (i === 0 && d.confidence >= bonusThreshold) domainBonus.set(d.domain, 1.05);
    else if (i === 1 && d.confidence >= bonusThreshold) domainBonus.set(d.domain, 1.02);
    else domainBonus.set(d.domain, 1.0);
  });

  const merged = [...skillBest.entries()]
    .map(([name, data]) => {
      const bonus = domainBonus.get(data.domain) ?? 1.0;
      return {
        skill: index.find((s) => s.name === name),
        score: data.score * bonus,
      };
    })
    .filter((r) => r.skill != null)
    .sort((a, b) => b.score - a.score);

  return merged;
}

/**
 * Find which domain a skill primarily belongs to (the first matching domain
 * from the detected list, or any domain from the skill).
 */
function findPrimaryDomain(skillName, domainResults) {
  for (const [domain, scored] of domainResults) {
    for (const { skill } of scored) {
      if (skill.name === skillName) return domain;
    }
  }
  return null;
}
