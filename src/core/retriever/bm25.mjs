/**
 * BM25 retrieval module.
 *
 * Provides rankSkills(prompt, index) and readSkillContent(ranked) functions
 * for lexical skill ranking using the BM25 scoring algorithm.
 * Supports optional synonym expansion via src/core/retrieval/expander.mjs.
 */
import { tokenize, computeIdf, resolveFieldWeight } from '../../scorer.mjs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getDefaults } from '../../config/defaults.mjs';
import { expandQuery, toWeightedTokenArray } from '../retrieval/expander.mjs';

const { k1, b } = getDefaults().bm25;

/**
 * Build the weighted token array for one skill.
 *
 * Field weights are applied as token multiplicity, so the weight is normalised
 * to a positive integer first (see resolveFieldWeight). Without that step a
 * fractional weight — which data/weights.json and src/core/retriever/weights.mjs
 * can both produce — makes `Array(n * w)` / `String.repeat(w)` throw a
 * RangeError and takes the whole ranking down.
 *
 * @param {{name:string, description:string, keywords:string[]}} skill
 * @param {{nameWeight?:number, descriptionWeight?:number, keywordWeight?:number}} weights
 * @returns {string[]}
 */
export function buildWeightedDocTokens(skill, weights = {}) {
  const nameReps = resolveFieldWeight(weights.nameWeight);
  const descReps = resolveFieldWeight(weights.descriptionWeight);
  const keywordReps = resolveFieldWeight(weights.keywordWeight);

  const nameTokens = tokenize(skill.name);
  const descTokens = tokenize(skill.description);
  const kwTokens = tokenize(Array.isArray(skill.keywords) ? skill.keywords.join(' ') : '');

  return [
    ...Array(nameTokens.length * nameReps).fill(null).flatMap(() => nameTokens),
    ...Array(descTokens.length * descReps).fill(null).flatMap(() => descTokens),
    ...kwTokens.flatMap((t) => Array(keywordReps).fill(t)),
  ];
}

/**
 * Build a scored, sorted ranking of skills for a given prompt.
 *
 * Score = BM25(name tokens × nameWeight) + BM25(description tokens × descriptionWeight)
 *        + BM25(keywords tokens × keywordWeight)
 * Scores are normalized to [0, 1] by dividing by the max raw score.
 *
 * When `synonymMap` is provided, query tokens are expanded with synonyms
 * (via src/core/retrieval/expander.mjs) before scoring. Expanded tokens
 * receive half weight relative to original tokens.
 *
 * @param {string} prompt
 * @param {Array<{name:string, description:string, keywords:string[], domains:string[], path:string, version:string}>} index
 * @param {object} [options]
 * @param {Map<string, string[]>} [options.synonymMap] — synonym map from buildSynonymMap
 * @param {object} [options._prebuilt] — prebuilt corpus side
 *   (src/core/retriever/prebuilt.mjs `preparePrebuiltFor` result):
 *   `{ docs: Array<{skill, tf: Map, len}>, idf: Map, avgDocLen }` aligned
 *   positionally with `index`. Skips per-call tokenization, IDF and
 *   term-frequency construction; the scoring math is unchanged.
 * @returns {Array<{skill: object, score: number}>}
 */
export function rankSkills(prompt, index, options = {}) {
  const synonymMap = options.synonymMap;
  const fieldWeights = getDefaults().bm25;

  const prepared = options._prebuilt;
  const docs = [];
  let idf;
  let avgDocLen;
  if (prepared && Array.isArray(prepared.docs) && prepared.docs.length === index.length) {
    // Prebuilt fast path: corpus side cached on disk (Sub-Phase 7.6).
    // docs[i] must belong to index[i]; the caller prepared it for this array.
    for (let i = 0; i < index.length; i++) {
      docs.push({ skill: index[i], tf: prepared.docs[i].tf, len: prepared.docs[i].len });
    }
    idf = prepared.idf;
    avgDocLen = prepared.avgDocLen;
  } else {
    // Build per-doc token arrays with field weights
    const built = index.map((skill) => ({
      skill,
      combinedTokens: buildWeightedDocTokens(skill, fieldWeights),
    }));
    const allDocs = built.map((d) => d.combinedTokens);
    idf = computeIdf(allDocs);
    avgDocLen =
      allDocs.length > 0
        ? allDocs.reduce((sum, t) => sum + t.length, 0) / allDocs.length
        : 1;
    for (const d of built) {
      const tf = new Map();
      for (const t of d.combinedTokens) tf.set(t, (tf.get(t) || 0) + 1);
      docs.push({ skill: d.skill, tf, len: d.combinedTokens.length });
    }
  }

  // If synonym expansion is enabled, expand query tokens with weighted synonyms
  let queryTokens;
  if (synonymMap) {
    const weightedTokens = expandQuery(prompt, synonymMap, idf);
    queryTokens = toWeightedTokenArray(weightedTokens);
  } else {
    queryTokens = tokenize(prompt);
  }

  if (queryTokens.length === 0) return [];

  const scored = docs.map((d) => ({
    skill: d.skill,
    rawScore: scoreDoc(queryTokens, d.tf, d.len, idf, avgDocLen, k1, b),
  }));

  const maxScore = scored.reduce((max, s) => Math.max(max, s.rawScore), 0);

  // Normalize to [0, 1]
  scored.sort((a, b) => b.rawScore - a.rawScore);
  return scored.map((s) => ({
    skill: s.skill,
    score: maxScore > 0 ? s.rawScore / maxScore : 0,
  }));
}

/**
 * Score one document's term-frequency map against query tokens.
 *
 * Identical arithmetic to src/scorer.mjs `bm25()` (same k1/b formula, same
 * summation order), reading tf from a prebuilt Map instead of rebuilding it
 * per call — so the prebuilt fast path and the slow path score bit-identical
 * results.
 *
 * @param {string[]} queryTokens
 * @param {Map<string, number>} tf
 * @param {number} docLen — weighted document length
 * @param {Map<string, number>} idf
 * @param {number} avgDocLen
 * @param {number} k1
 * @param {number} b
 * @returns {number}
 */
function scoreDoc(queryTokens, tf, docLen, idf, avgDocLen, k1, b) {
  if (docLen === 0 || queryTokens.length === 0) return 0;
  let score = 0;
  for (const q of queryTokens) {
    const idfVal = idf.get(q) ?? 0;
    const termFreq = tf.get(q) ?? 0;
    if (termFreq === 0) continue;
    const numerator = termFreq * (k1 + 1);
    const denominator = termFreq + k1 * (1 - b + b * (docLen / avgDocLen));
    score += idfVal * (numerator / denominator);
  }
  return score;
}

/**
 * Read skill markdown files and return their content (capped at 4000 chars each).
 * @param {Array<{skill: object, score: number}>} ranked
 * @returns {Promise<Array<{name: string, content: string}>>}
 */
export async function readSkillContent(ranked) {
  const results = [];
  for (const { skill } of ranked) {
    try {
      const content = await readFile(resolve(skill.path), 'utf-8');
      results.push({ name: skill.name, content: content.slice(0, 4000) });
    } catch {
      // Skip unreadable files
    }
  }
  return results;
}
