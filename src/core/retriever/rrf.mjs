/**
 * Weighted Reciprocal Rank Fusion (RRF) primitives.
 *
 * Fusion is a pure function of two ranked lists, so it lives apart from the
 * retrieval orchestration in hybrid.mjs:
 *
 *   score(d) = w_bm25 * 1/(k + rank_bm25(d)) + w_semantic * 1/(k + rank_sem(d))
 *
 * with a BM25-rank tiebreaker so lexical precision survives tied scores. The
 * weights are a convex combination and should sum to 1.0; they come from
 * `embeddings.weights` in src/config/defaults.mjs.
 *
 * @module src/core/retriever/rrf
 */

/**
 * Reciprocal-rank contribution of one source.
 *
 * @param {number} weight — source weight (0 disables the source)
 * @param {number} k — RRF constant (default getDefaults().rrf.k, 60)
 * @param {number} rank — 1-based rank of the document in that source
 * @returns {number}
 */
export function rrfTerm(weight, k, rank) {
  return weight * (1 / (k + rank));
}

/**
 * Build a rank lookup from an ordered list of items.
 *
 * @template {{name?: string, skill?: {name: string}}} T
 * @param {T[]} ordered — items in rank order (index 0 is rank 1)
 * @returns {Map<string, number>} name → 1-based rank
 */
export function rankByName(ordered) {
  const ranks = new Map();
  ordered.forEach((item, i) => {
    const name = item.name ?? item.skill?.name;
    if (name !== undefined) ranks.set(name, i + 1);
  });
  return ranks;
}

/**
 * Fuse a BM25 ranking with an embedding-similarity ranking.
 *
 * @param {Array<{skill: object, score: number}>} bm25Results — BM25 ranking, best first
 * @param {Array<{name: string, sim: number}>} simScores — similarity per skill, any order
 * @param {object} options
 * @param {number} options.k — RRF constant
 * @param {number} options.wBm25 — BM25 weight
 * @param {number} options.wSemantic — semantic weight
 * @param {(name: string) => object} options.lookup — name → index entry
 * @returns {Array<{skill: object, bm25Score: number, embeddingScore: number, rrfScore: number, bm25Rrf: number, semanticRrf: number}>}
 *   sorted by fused score descending, BM25 rank as tiebreaker
 */
export function fuseRankings(bm25Results, simScores, { k, wBm25, wSemantic, lookup }) {
  const bm25Rank = rankByName(bm25Results);
  const embeddingRank = rankByName([...simScores].sort((a, b) => b.sim - a.sim));

  const fused = new Map();
  for (const r of bm25Results) {
    const rrfScore = rrfTerm(wBm25, k, bm25Rank.get(r.skill.name));
    fused.set(r.skill.name, {
      skill: r.skill,
      bm25Score: r.score,
      embeddingScore: 0,
      rrfScore,
      bm25Rrf: rrfScore,
      semanticRrf: 0,
    });
  }

  for (const s of simScores) {
    const rrfScore = rrfTerm(wSemantic, k, embeddingRank.get(s.name));
    const existing = fused.get(s.name);
    if (existing) {
      existing.rrfScore += rrfScore;
      existing.semanticRrf = rrfScore;
      existing.embeddingScore = s.sim;
      continue;
    }
    // A skill BM25 never scored still gets its semantic rank, which is how
    // the semantic channel adds recall.
    const skill = lookup(s.name);
    if (skill) {
      fused.set(s.name, {
        skill,
        bm25Score: 0,
        embeddingScore: s.sim,
        rrfScore,
        bm25Rrf: 0,
        semanticRrf: rrfScore,
      });
    }
  }

  const results = [...fused.values()];
  results.sort((a, b) => {
    const diff = b.rrfScore - a.rrfScore;
    if (Math.abs(diff) > 1e-10) return diff;
    return (bm25Rank.get(a.skill.name) ?? 999) - (bm25Rank.get(b.skill.name) ?? 999);
  });
  return results;
}
