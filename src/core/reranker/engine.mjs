/**
 * Reranker engine module.
 *
 * Re-ranks a list of candidate skills by blending their existing RRF scores
 * with feature-based lexical signals (keyword overlap, bigram match, domain,
 * title, and optionally embedding similarity). This preserves the strong
 * ranking from hybrid retrieval while nudging results when the reranker has
 * clear additional evidence.
 *
 * Weights are loaded from data/reranker-weights.json when present
 * (produced by src/scripts/train-reranker-weights.mjs), otherwise the
 * hardcoded defaults from getDefaults() are used.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractFeatures } from './features.mjs';
import { getDefaults } from '../../config/defaults.mjs';

const { reranker } = getDefaults();
const BLEND = 0.01; // weight given to feature signal vs. original RRF score

/**
 * Load trained reranker weights from data/reranker-weights.json if present.
 *
 * @returns {Record<string, number>|undefined}
 */
function loadTrainedWeights() {
  try {
    const path = resolve('data/reranker-weights.json');
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw);
    if (typeof data === 'object' && !Array.isArray(data)) {
      return data;
    }
  } catch {
    // File missing or malformed — use defaults from getDefaults()
  }
  return undefined;
}

const _trainedWeights = loadTrainedWeights();
const weights = { ...reranker.weights, ...(_trainedWeights ?? {}) };

/**
 * Rerank a list of candidate skills.
 *
 * For each candidate, computes a blended score:
 *   blendedScore = (1 - BLEND) * originalScore + BLEND * featureScore
 * where featureScore is the weighted sum of extractFeatures outputs.
 * The original score is taken from c.score if present, otherwise c.rrfScore.
 *
 * Results are sorted descending by blendedScore and truncated to topK.
 *
 * @param {string} query
 * @param {Array<{skill: object, score?: number, rrfScore?: number}>} candidates
 * @param {object} options
 * @param {number} [options.topK=5] — maximum number of results to return
 * @param {object} [options.provider] — embedding provider (optional; enables embeddingSimilarity feature)
 * @returns {Array<{skill: object, score: number, rerankScore: number}>}
 */
export function rerank(query, candidates, options = {}) {
  const topK = options.topK ?? 5;
  const provider = options.provider;

  if (!candidates || candidates.length === 0) return [];

  // Compute weighted feature score for each candidate
  const scored = candidates.map((c) => {
    const features = extractFeatures(query, c.skill, { provider });
    let featureScore = 0;
    for (const [feature, weight] of Object.entries(weights)) {
      featureScore += (features[feature] ?? 0) * weight;
    }
    // Use c.score if available (public API), otherwise c.rrfScore (internal)
    const originalScore = c.score ?? c.rrfScore ?? 0;
    // Blend original RRF score with feature signal
    const blended = (1 - BLEND) * originalScore + BLEND * featureScore;
    return {
      skill: c.skill,
      score: blended,
      rerankScore: blended,
      bm25Score: c.bm25Score ?? 0,
      embeddingScore: c.embeddingScore ?? 0,
      bm25Rrf: c.bm25Rrf ?? 0,
      semanticRrf: c.semanticRrf ?? 0,
      featureScore,
    };
  });

  // Sort descending by blended score
  scored.sort((a, b) => b.rerankScore - a.rerankScore);

  // Return top-K, never more than the number of candidates received
  return scored.slice(0, Math.min(topK, scored.length));
}
