/**
 * Hybrid retrieval module — BM25 + semantic embeddings fused via RRF.
 *
 * Runs lexical (BM25) and semantic (cosine similarity) retrieval
 * independently, then fuses the rankings using Reciprocal Rank Fusion.
 * When RRF scores are tied, BM25 rank is used as tiebreaker to
 * preserve lexical precision while gaining semantic recall.
 * An optional reranking stage blends RRF scores with feature-based
 * lexical signals for improved top-K precision.
 */
import { rankSkills } from './bm25.mjs';
import { buildEmbeddingIndex, cosineSimilarity, embed } from '../embeddings/engine.mjs';
import { rerank } from '../reranker/engine.mjs';
import { getDefaults } from '../../config/defaults.mjs';

const { rrf } = getDefaults();

/**
 * Hybrid retrieve — BM25 + embedding similarity fused by Reciprocal Rank Fusion.
 *
 * 1. Run BM25 retrieval via rankSkills(prompt, index).
 * 2. Run embedding similarity: embed the query, compute cosine similarity
 *    against every skill embedding.
 * 3. Fuse using RRF: score = Σ (1 / (k + rank_i)) across both sources.
 * 4. When RRF scores are tied, prefer the higher BM25 rank.
 * 5. Optionally re-rank with feature blending for improved top-K precision.
 *
 * @param {string} prompt
 * @param {Array<{name:string, description:string, keywords:string[], domains:string[], path:string, version:string}>} index
 * @param {object} [options]
 * @param {number} [options.k=60] — RRF constant
 * @param {boolean} [options.rerank=true] — apply reranking stage
 * @param {Map<string, Float32Array>} [options.embeddings] — pre-built embedding index (optional)
 * @returns {Array<{skill: object, score: number, bm25Score: number, embeddingScore: number}>}
 */
export function hybridRetrieve(prompt, index, options = {}) {
  const k = options.k ?? rrf.k;
  const doRerank = options.rerank !== false;
  const topK = options.topK ?? 5;

  // ── BM25 retrieval ────────────────────────────────────────────────────────
  const bm25Results = rankSkills(prompt, index);

  const bm25Rank = new Map();
  bm25Results.forEach((r, i) => {
    bm25Rank.set(r.skill.name, i + 1);
  });

  // ── Embedding retrieval ───────────────────────────────────────────────────
  const embeddings = options.embeddings ?? buildEmbeddingIndex(index);
  const queryVec = embed(prompt);

  const simScores = index.map((skill) => {
    const skillVec = embeddings.get(skill.name);
    const sim = skillVec ? cosineSimilarity(queryVec, skillVec) : 0;
    return { name: skill.name, sim };
  });

  simScores.sort((a, b) => b.sim - a.sim);
  const embeddingRank = new Map();
  simScores.forEach((s, i) => {
    embeddingRank.set(s.name, i + 1);
  });

  // ── RRF Fusion ────────────────────────────────────────────────────────────
  const fused = new Map();

  for (const r of bm25Results) {
    const rank = bm25Rank.get(r.skill.name);
    const rrfScore = 1 / (k + rank);
    fused.set(r.skill.name, {
      skill: r.skill,
      bm25Score: r.score,
      embeddingScore: 0,
      rrfScore,
    });
  }

  for (const s of simScores) {
    const rank = embeddingRank.get(s.name);
    const rrfScore = 1 / (k + rank);
    const existing = fused.get(s.name);
    if (existing) {
      existing.rrfScore += rrfScore;
      existing.embeddingScore = s.sim;
    } else {
      const skill = index.find((sk) => sk.name === s.name);
      if (skill) {
        fused.set(s.name, {
          skill,
          bm25Score: 0,
          embeddingScore: s.sim,
          rrfScore,
        });
      }
    }
  }

  // Sort by fused RRF score descending, with BM25 rank as tiebreaker
  const results = [...fused.values()];
  results.sort((a, b) => {
    const diff = b.rrfScore - a.rrfScore;
    if (Math.abs(diff) > 1e-10) return diff;
    const bm25A = bm25Rank.get(a.skill.name) ?? 999;
    const bm25B = bm25Rank.get(b.skill.name) ?? 999;
    return bm25A - bm25B;
  });

  // ── Optional reranking stage ──────────────────────────────────────────────
  // Reranking is opt-in to avoid degrading hybrid retrieval accuracy on larger corpora.
  if (options.rerank === true && results.length > 1) {
    const reranked = rerank(prompt, results, { topK });
    return reranked.map((r) => ({
      skill: r.skill,
      score: r.rerankScore,
      bm25Score: r.bm25Score,
      embeddingScore: r.embeddingScore,
    }));
  }

  // Truncate to topK and return
  return results.slice(0, topK).map((r) => ({
    skill: r.skill,
    score: r.rrfScore,
    bm25Score: r.bm25Score,
    embeddingScore: r.embeddingScore,
  }));
}
