/**
 * Reranker feature extraction module.
 *
 * Computes lexical features from a query–skill pair for use by the reranker.
 * Features are deterministic: same input always produces the same output.
 */
import { tokenize, bigrams } from '../../utils/text.mjs';

/**
 * Extract features from a query–skill pair for use by the reranker.
 *
 * @param {string} query
 * @param {object} skill — { name, description, keywords, domains }
 * @returns {Record<string, number>}
 */
export function extractFeatures(query, skill) {
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

  return {
    exactKeyword,
    bigramOverlap,
    domainMatch,
    titleMatch,
  };
}
