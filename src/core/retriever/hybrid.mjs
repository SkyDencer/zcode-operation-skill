/**
 * Hybrid retrieval module — BM25 + semantic embeddings fused via RRF.
 *
 * Runs lexical (BM25) and semantic (cosine similarity) retrieval
 * independently, then fuses the rankings with weighted Reciprocal Rank
 * Fusion (see src/core/retriever/rrf.mjs):
 *
 *   score = w_bm25 / (k + rank_bm25) + w_semantic / (k + rank_semantic)
 *
 * Weights come from `embeddings.weights` in src/config/defaults.mjs and can
 * be overridden per call. The shipped default is bm25=1.0 / semantic=0.0:
 * a weight sweep on the 130-prompt real corpus (table in defaults.mjs) shows
 * the semantic channel costs accuracy at every weight and with both
 * providers, so it is skipped entirely and the provider is never touched.
 * An optional reranking stage blends RRF scores with feature-based lexical
 * signals for improved top-K precision.
 *
 * Neither source is a relevance gate on its own: `rankSkills` returns an
 * entry for every indexed skill and every skill has a non-zero cosine
 * similarity, so callers that must abstain (the routing hook) pass
 * `options.minBm25Score`; fusion then returns an empty list whenever the best
 * lexical score in the result set is below that floor.
 *
 * The embedding backend is abstracted via the Provider interface
 * (see src/core/embeddings/provider.mjs). A provider instance can be
 * passed through `options.provider`; when omitted the retriever falls
 * back to Fnv1aProvider for backward compatibility. Retrieval is fail-open:
 * unless `options.fallbackToFnv1a === false`, a provider that throws or
 * rejects is swapped for Fnv1aProvider and a warning is passed to
 * `options.onDegrade`.
 *
 * Providers may return a Promise from `buildIndex()` (e.g. ONNX). When
 * that happens, `hybridRetrieve()` returns a Promise; otherwise it
 * returns synchronously for backward compatibility with sync providers.
 */
import { rankSkills } from './bm25.mjs';
import { fuseRankings } from './rrf.mjs';
import { rerank } from '../reranker/engine.mjs';
import { createProvider } from '../embeddings/provider.mjs';
import { getConfig } from '../../config/env.mjs';

// getConfig() (not getDefaults()) so the weights and k honour their
// SKILL_ROUTER_* environment overrides at runtime.
const { rrf, embeddings } = getConfig();
// Default provider type comes from the env-var-controlled factory so that
// SKILL_ROUTER_EMBEDDING_PROVIDER is respected even when no provider is
// passed explicitly to hybridRetrieve().
const DEFAULT_PROVIDER_TYPE =
  process.env.SKILL_ROUTER_EMBEDDING_PROVIDER?.toLowerCase().trim() || 'fnv1a';

// Default weights loaded at module scope; overridden per-call when
// options._weightBm25 / options._weightSemantic are supplied.
const DEFAULT_BM25_WEIGHT = embeddings.weights.bm25;
const DEFAULT_SEMANTIC_WEIGHT = embeddings.weights.semantic;

/**
 * Hybrid retrieve — BM25 + embedding similarity fused by weighted RRF.
 *
 * 1. Run BM25 retrieval via rankSkills(prompt, index).
 * 2. Run embedding similarity using the configured provider.
 * 3. Fuse with weighted RRF (skipped when the semantic weight is 0).
 * 4. When RRF scores are tied, prefer the higher BM25 rank.
 * 5. Optionally re-rank with feature blending for improved top-K precision.
 *
 * @param {string} prompt
 * @param {Array<{name:string, description:string, keywords:string[], domains:string[], path:string, version:string}>} index
 * @param {object} [options]
 * @param {object} [options.provider] — embedding provider instance (default: Fnv1aProvider)
 * @param {number} [options.k] — RRF constant (default: getConfig().rrf.k)
 * @param {boolean} [options.rerank=true] — apply the reranking stage
 * @param {number} [options.topK=5] — maximum number of results
 * @param {number} [options.minBm25Score=0] — relevance floor on the normalised
 *   BM25 score. When the best BM25 score in the fused set is below the floor,
 *   an empty array is returned so the caller can abstain. 0 disables the floor.
 * @param {boolean} [options.fallbackToFnv1a=true] — swap a throwing provider
 *   for Fnv1aProvider instead of propagating the error
 * @param {Function} [options.onDegrade] — called with a message when a fallback happens
 * @param {Map<string, Float32Array>} [options.embeddings] — pre-built embedding index (optional)
 * @param {number} [options._weightBm25] — per-call BM25 RRF weight override (test-only)
 * @param {number} [options._weightSemantic] — per-call semantic RRF weight override (test-only)
 * @returns {Array<{skill: object, score: number, bm25Score: number, embeddingScore: number}>|Promise<Array>}
 */
export function hybridRetrieve(prompt, index, options = {}) {
  const k = options.k ?? rrf.k;
  const doRerank = options.rerank !== false;
  const topK = options.topK ?? 5;
  const minBm25Score = options.minBm25Score ?? 0;
  // Per-call weight overrides; fall back to module-level defaults.
  const wBm25 =
    options._weightBm25 !== undefined ? options._weightBm25 : DEFAULT_BM25_WEIGHT;
  const wSemantic =
    options._weightSemantic !== undefined
      ? options._weightSemantic
      : DEFAULT_SEMANTIC_WEIGHT;

  const lookup = (name) => index.find((sk) => sk.name === name);

  // Resolved only when the semantic channel is in use; stays null otherwise.
  /** @type {object|null} */
  let provider = null;

  // ── BM25 retrieval ────────────────────────────────────────────────────────
  const bm25Results = rankSkills(prompt, index);

  /**
   * Shape fused rows for the public API and apply the reranking stage.
   *
   * @param {Array<object>} results — fused rows from fuseRankings()
   * @returns {Array<object>|Promise<Array<object>>}
   */
  const finish = (results) => {
    if (minBm25Score > 0) {
      const topBm25 = results.reduce((max, r) => Math.max(max, r.bm25Score), 0);
      if (topBm25 < minBm25Score) return [];
    }
    const shape = (rows) =>
      rows.map((r) => ({
        skill: r.skill,
        score: r.rerankScore ?? r.rrfScore,
        bm25Score: r.bm25Score,
        embeddingScore: r.embeddingScore,
        bm25Rrf: r.bm25Rrf,
        semanticRrf: r.semanticRrf,
      }));
    if (doRerank && results.length > 1) {
      // rerank() returns a Promise when the provider is async, so both
      // shapes are handled without a second fusion pass.
      const reranked = rerank(prompt, results, { topK, provider });
      return reranked instanceof Promise ? reranked.then(shape) : shape(reranked);
    }
    return shape(results.slice(0, topK));
  };

  // Semantic channel off: there is nothing for a provider to contribute, so
  // it is never constructed, read or awaited. This also keeps the default
  // routing path synchronous and free of a cold model load.
  if (wSemantic === 0) {
    return finish(fuseRankings(bm25Results, [], { k, wBm25, wSemantic, lookup }));
  }

  // Resolve provider: explicit option > default factory
  provider = options.provider ?? createProvider(DEFAULT_PROVIDER_TYPE);

  /**
   * Read the embedding index and the query vector from a provider.
   *
   * @param {object} p — provider instance
   * @returns {{build: *, query: *}} possibly-Promise members
   */
  const readEmbeddings = (p) => ({
    build: options.embeddings ?? p.buildIndex(index),
    query: p.embed(prompt),
  });

  // Fail-open: a provider that is constructed but unusable (e.g. ONNX with a
  // cold model cache) must not take the whole routing path down. The fallback
  // provider is zero-dependency and always available.
  const fallbackToFnv1a = options.fallbackToFnv1a !== false;
  const onDegrade = options.onDegrade ?? ((msg) => console.error(msg));

  /**
   * Complete the fusion once both embedding artefacts are available.
   *
   * @param {Map<string, Float32Array>} skillVectors
   * @param {Float32Array} queryVector
   * @returns {Array<object>|Promise<Array<object>>}
   */
  const withEmbeddings = (skillVectors, queryVector) => {
    const simScores = index.map((skill) => {
      const skillVec = skillVectors.get(skill.name);
      return { name: skill.name, sim: skillVec ? cosineSimilarity(queryVector, skillVec) : 0 };
    });
    return finish(fuseRankings(bm25Results, simScores, { k, wBm25, wSemantic, lookup }));
  };

  /** @type {{build: *, query: *}} */
  let embeddingSource;
  try {
    embeddingSource = readEmbeddings(provider);
  } catch (err) {
    if (!fallbackToFnv1a) throw err;
    onDegrade(
      `[skill-router] embedding provider "${provider.name}" unavailable ` +
        `(${err.message}); using fnv1a`
    );
    provider = createProvider('fnv1a');
    embeddingSource = readEmbeddings(provider);
  }

  // Track whether the async path is needed. We check the raw return values,
  // not Promise.resolve() wrappers, because Promise.resolve(x) is always a
  // Promise even when x is not.
  const buildIsPromise = embeddingSource.build instanceof Promise;
  const queryIsPromise = embeddingSource.query instanceof Promise;

  if (buildIsPromise || queryIsPromise) {
    const fused = Promise.all([
      buildIsPromise ? embeddingSource.build : Promise.resolve(embeddingSource.build),
      queryIsPromise ? embeddingSource.query : Promise.resolve(embeddingSource.query),
    ]).then(([skillVectors, queryVector]) => withEmbeddings(skillVectors, queryVector));
    if (!fallbackToFnv1a) {
      return fused;
    }
    // Async provider rejected (e.g. a truncated model file): retry once with
    // the always-available FNV-1a provider so the caller still gets a ranking.
    return fused.catch((err) => {
      onDegrade(`[skill-router] embedding provider failed (${err.message}); using fnv1a`);
      const fb = createProvider('fnv1a');
      return withEmbeddings(fb.buildIndex(index), fb.embed(prompt));
    });
  }
  return withEmbeddings(embeddingSource.build, embeddingSource.query);
}

/**
 * Compute cosine similarity between two unit vectors.
 *
 * Since both inputs are expected to be normalized to unit length,
 * this is equivalent to the dot product, bounded to [0, 1].
 *
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number} cosine similarity in [0, 1]
 */
function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return Math.max(0, Math.min(1, dot));
}
