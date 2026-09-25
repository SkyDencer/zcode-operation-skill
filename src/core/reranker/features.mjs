/**
 * Reranker feature extraction module.
 *
 * Computes lexical features from a query–skill pair for use by the reranker.
 * Features are deterministic: same input always produces the same output.
 *
 * When an optional embedding provider is supplied, the module also computes
 * `embeddingSimilarity` — the cosine similarity between the query embedding
 * and the skill-description embedding.
 */
import { tokenize, bigrams } from '../../utils/text.mjs';

/**
 * Extract features from a query–skill pair for use by the reranker.
 *
 * @param {string} query
 * @param {object} skill — { name, description, keywords, domains }
 * @param {object} [options]
 * @param {object} [options.provider] — embedding provider (optional; when absent, embeddingSimilarity is 0)
 * @returns {Record<string, number>}
 */
export function extractFeatures(query, skill, options = {}) {
  const { provider } = options;
  const queryTokens = tokenize(query);
  const queryBigrams = bigrams(queryTokens);

  const skillNameTokens = tokenize(skill.name);
  const skillDescTokens = tokenize(skill.description);
  const skillDescBigrams = bigrams(skillDescTokens);
  const skillKeywordTokens = skill.keywords
    .map((kw) => tokenize(kw))
    .flat();
  const allMatchTokens = [...skillNameTokens, ...skillDescTokens, ...skillKeywordTokens];

  // exactKeyword: count of unique query tokens that appear in name/description/keywords
  const matchSet = new Set(allMatchTokens);
  const exactKeyword = queryTokens.filter((t) => matchSet.has(t)).length;

  // bigramOverlap: count of shared bigrams between query and skill description
  const queryBigramSet = new Set(queryBigrams);
  const bigramOverlap = skillDescBigrams.filter((b) => queryBigramSet.has(b)).length;

  // domainMatch: 1.0 if any query token overlaps with skill domains, else 0
  const domainSet = new Set(skill.domains);
  const domainMatch = queryTokens.some((t) => domainSet.has(t)) ? 1.0 : 0.0;

  // titleMatch: 1.0 if any skill name token appears in the query, else 0
  const queryTokenSet = new Set(queryTokens);
  const titleMatch = skillNameTokens.some((t) => queryTokenSet.has(t)) ? 1.0 : 0.0;

  // embeddingSimilarity: cosine similarity between query and skill-desc embeddings
  let embeddingSimilarity = 0;
  if (provider && provider.isAvailable && provider.embed) {
    try {
      const queryVec = provider.embed(query);
      const descVec = provider.embed(skill.description);
      embeddingSimilarity = cosineSimilarity(queryVec, descVec);
    } catch {
      // Provider unavailable — fall back to 0
      embeddingSimilarity = 0;
    }
  }

  return {
    exactKeyword,
    bigramOverlap,
    domainMatch,
    titleMatch,
    embeddingSimilarity,
  };
}

/**
 * Compute cosine similarity between two unit vectors.
 *
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number} cosine similarity in [0, 1]
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return Math.max(0, Math.min(1, dot));
}
