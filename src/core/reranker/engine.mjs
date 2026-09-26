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
 * Only keys that name a known feature are kept, so provenance metadata in the
 * file (sample counts, R², the provider the fit was run against) can never
 * leak into the weighted feature sum below.
 *
 * @returns {Record<string, number>|undefined}
 */
function loadTrainedWeights() {
  try {
    const path = resolve('data/reranker-weights.json');
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw);
    if (typeof data === 'object' && !Array.isArray(data)) {
      const picked = {};
      for (const name of Object.keys(reranker.weights)) {
        if (typeof data[name] === 'number') picked[name] = data[name];
      }
      return Object.keys(picked).length > 0 ? picked : undefined;
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
 * When `options.provider` is asynchronous (ONNX), `extractFeatures` returns a
 * Promise and so does `rerank` — the same mixed sync/async contract
 * `hybridRetrieve` uses. Callers must therefore be prepared for either shape.
 *
 * @param {string} query
 * @param {Array<{skill: object, score?: number, rrfScore?: number}>} candidates
 * @param {object} options
 * @param {number} [options.topK=5] — maximum number of results to return
 * @param {object} [options.provider] — embedding provider (optional; enables embeddingSimilarity feature)
 * @returns {Array<{skill: object, score: number, rerankScore: number}>|Promise<Array>}
 */
export function rerank(query, candidates, options = {}) {
  const topK = options.topK ?? 5;
  const provider = options.provider;

  if (!candidates || candidates.length === 0) return [];

  /**
   * Blend one feature set with its candidate and the configured weights.
   *
   * @param {object} c — candidate
   * @param {Record<string, number>|Promise<Record<string, number>>} features
   * @returns {object|Promise<object>} the scored row
   */
  const scoreOne = (c, features) => {
    const applyFeatures = (f) => {
      let featureScore = 0;
      for (const [feature, weight] of Object.entries(weights)) {
        featureScore += (f[feature] ?? 0) * weight;
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
    };
    return features instanceof Promise ? features.then(applyFeatures) : applyFeatures(features);
  };

  const rows = candidates.map((c) => scoreOne(c, extractFeatures(query, c.skill, { provider })));

  /**
   * Sort descending by blended score and truncate to topK.
   *
   * @param {Array<object>} scored
   * @returns {Array<object>}
   */
  const finalise = (scored) => {
    scored.sort((a, b) => b.rerankScore - a.rerankScore);
    // Return top-K, never more than the number of candidates received
    return scored.slice(0, Math.min(topK, scored.length));
  };

  // Async provider: one Promise per candidate, resolved together so a single
  // rejected feature extraction cannot silently zero the other features.
  if (rows.some((r) => r instanceof Promise)) {
    return Promise.all(rows).then(finalise);
  }
  return finalise(rows);
}
