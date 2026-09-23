/**
 * Query expander using synonym maps.
 *
 * Expands a query into weighted tokens: original tokens retain full weight,
 * synonym-expanded tokens receive a reduced weight multiplier.
 * Common/generic tokens are filtered to prevent signal dilution.
 */
import { tokenize } from '../../scorer.mjs';

/**
 * Weight multiplier applied to synonym-expanded tokens relative to original tokens.
 */
const EXPAND_WEIGHT = 0.5;

/**
 * Minimum IDF threshold below which a token is considered too generic
 * and should not be added as a synonym expansion.
 */
const MIN_IDF_THRESHOLD = 0.8;

/**
 * Maximum number of expanded tokens to include per query.
 * Prevents excessive token bloat from diluting the original signal.
 */
const MAX_EXPANDED_TOKENS = 3;

/**
 * Expand a query into an array of { token, weight } objects.
 *
 * Original tokens appear with weight 1.0. For each original token, any
 * synonyms from the map are appended with weight EXPAND_WEIGHT (0.5),
 * subject to IDF filtering and a cap on total expansions.
 *
 * @param {string} query
 * @param {Map<string, string[]>} synonymMap
 * @param {Map<string, number>} [idfMap] — optional pre-computed IDF map for filtering
 * @returns {{token: string, weight: number}[]}
 */
export function expandQuery(query, synonymMap, idfMap) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  // First pass: collect original tokens with full weight
  const result = [];
  const seen = new Set();
  for (const token of tokens) {
    if (!seen.has(token)) {
      result.push({ token, weight: 1.0 });
      seen.add(token);
    }
  }

  // Second pass: append filtered synonyms with reduced weight
  let expandedCount = 0;
  for (const token of tokens) {
    const synonyms = synonymMap.get(token);
    if (!synonyms || synonyms.length === 0) continue;

    for (const synonym of synonyms) {
      if (seen.has(synonym)) continue;
      if (expandedCount >= MAX_EXPANDED_TOKENS) break;

      // Skip synonyms that are shorter than 3 chars (too generic)
      if (synonym.length < 3) continue;

      // Skip if IDF is too low (too common across corpus)
      if (idfMap && idfMap.get(synonym) < MIN_IDF_THRESHOLD) continue;

      result.push({ token: synonym, weight: EXPAND_WEIGHT });
      seen.add(synonym);
      expandedCount++;
    }
  }

  return result;
}

/**
 * Convert weighted tokens to a flat token array for BM25 scoring.
 * Original tokens (weight 1.0) appear three times; expanded tokens (weight 0.5)
 * appear once. This preserves relative weighting in the BM25 scorer.
 *
 * @param {{token: string, weight: number}[]} weightedTokens
 * @returns {string[]}
 */
export function toWeightedTokenArray(weightedTokens) {
  const result = [];
  for (const { token, weight } of weightedTokens) {
    const reps = weight >= 1.0 ? 3 : 1;
    for (let i = 0; i < reps; i++) {
      result.push(token);
    }
  }
  return result;
}
