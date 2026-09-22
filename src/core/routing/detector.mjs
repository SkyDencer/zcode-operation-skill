/**
 * Domain detector module — identifies which skill domains a query belongs to.
 *
 * Uses three signals per domain:
 *   1. **BM25 signal** — max raw BM25 score among skills in the domain,
 *      normalised against the global maximum across all skills.
 *   2. **Coverage signal** — fraction of skills in the domain with BM25
 *      score above 30% of the global maximum.
 *   3. **Embedding signal** — average cosine similarity of all skills
 *      in the domain to the query embedding.
 *
 * Final confidence = 0.5 × bm25Signal + 0.3 × coverageSignal + 0.2 × embeddingSignal.
 * Results are sorted by confidence descending and bounded to [0, 1].
 */
import { tokenize } from '../../utils/text.mjs';
import { computeIdf, bm25 } from '../../scorer.mjs';
import { embed, cosineSimilarity, buildEmbeddingIndex } from '../embeddings/engine.mjs';
import { getDefaults } from '../../config/defaults.mjs';

const { k1, b, nameWeight, descriptionWeight, keywordWeight } = getDefaults().bm25;

/**
 * A single domain match result.
 * @typedef {Object} DomainMatch
 * @property {string} domain — the domain name
 * @property {number} confidence — normalized score in [0, 1]
 * @property {string[]} matchedTokens — query tokens found in domain skill keywords
 */

/**
 * Detect which domains a query belongs to.
 *
 * @param {string} query
 * @param {Array<{name:string, description:string, keywords:string[], domains:string[]}>} index
 * @returns {DomainMatch[]}
 */
export function detectDomains(query, index) {
  if (!query || !index || index.length === 0) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  // ── Compute per-skill BM25 scores ────────────────────────────────────────
  const docs = index.map((skill) => {
    const nameTokens = tokenize(skill.name);
    const descTokens = tokenize(skill.description);
    const kwTokens = tokenize(skill.keywords.join(' '));
    const combined = [
      ...Array(nameTokens.length * nameWeight).fill(null).flatMap((_, i) => nameTokens),
      ...Array(descTokens.length * descriptionWeight).fill(null).flatMap((_, i) => descTokens),
      ...kwTokens.map((t) => t.repeat(keywordWeight > 1 ? keywordWeight : 1)),
    ];
    return { skill, combinedTokens: combined };
  });

  const allDocs = docs.map((d) => d.combinedTokens);
  const idf = computeIdf(allDocs);
  const avgDocLen =
    allDocs.length > 0
      ? allDocs.reduce((sum, t) => sum + t.length, 0) / allDocs.length
      : 1;

  const skillScores = new Map();
  for (const d of docs) {
    const rawScore = bm25(queryTokens, d.combinedTokens, idf, avgDocLen, k1, b);
    skillScores.set(d.skill.name, rawScore);
  }

  const globalMax = Math.max(...[...skillScores.values()], 0);
  const scoreThreshold = globalMax * 0.3;

  // ── Build per-domain structures ──────────────────────────────────────────
  const domainSkills = new Map(); // domain → Set<skillName>
  const domainKeywordTokens = new Map(); // domain → Set<token>

  for (const skill of index) {
    for (const domain of skill.domains || []) {
      if (!domainSkills.has(domain)) {
        domainSkills.set(domain, new Set());
        domainKeywordTokens.set(domain, new Set());
      }
      domainSkills.get(domain).add(skill.name);
      for (const kw of skill.keywords || []) {
        for (const t of tokenize(kw)) {
          domainKeywordTokens.get(domain).add(t);
        }
      }
    }
  }

  if (domainSkills.size === 0) return [];

  // ── Embedding signal ─────────────────────────────────────────────────────
  const queryVec = embed(query);
  const embIndex = buildEmbeddingIndex(index);

  // ── Compute per-domain confidence ────────────────────────────────────────
  const results = [];

  for (const [domain, skillNames] of domainSkills) {
    const names = [...skillNames];
    const scores = names.map((n) => skillScores.get(n) ?? 0);
    const maxScore = Math.max(...scores, 0);

    // Signal 1: BM25 dominance (max score normalised to global max)
    const bm25Signal = globalMax > 0 ? maxScore / globalMax : 0;

    // Signal 2: Coverage (fraction of skills above 30% threshold)
    const hitCount = scores.filter((s) => s > scoreThreshold).length;
    const coverageSignal = names.length > 0 ? hitCount / names.length : 0;

    // Signal 3: Embedding similarity
    let totalEmb = 0;
    for (const name of names) {
      const vec = embIndex.get(name);
      if (vec) totalEmb += cosineSimilarity(queryVec, vec);
    }
    const embeddingSignal = names.length > 0 ? totalEmb / names.length : 0;

    // Combined confidence
    const confidence =
      0.5 * bm25Signal + 0.3 * coverageSignal + 0.2 * embeddingSignal;

    // Matched tokens: query tokens found in this domain's keyword pools
    const matchedTokens = queryTokens.filter((t) =>
      domainKeywordTokens.get(domain)?.has(t)
    );

    results.push({
      domain,
      confidence: Math.round(Math.min(1, Math.max(0, confidence)) * 100) / 100,
      matchedTokens,
    });
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}
