/**
 * Attribution engine — determines which BM25 field drove each routing decision.
 *
 * Computes per-field BM25 scores (name, description, keywords) independently,
 * then attributes the outcome to the dominant field. Returns an Attribution
 * record that can be fed into src/core/retriever/weights.mjs for adaptive
 * weight adjustment.
 */
import { tokenize, computeIdf, bm25 } from '../../scorer.mjs';
import { getDefaults } from '../../config/defaults.mjs';

const { nameWeight, descriptionWeight, keywordWeight } = getDefaults().bm25;

/**
 * Compute per-field BM25 scores for a single skill against query tokens.
 *
 * Returns raw (unweighted) BM25 scores for each field, plus the weighted
 * contribution used for dominant-field determination.
 *
 * @param {string[]} queryTokens
 * @param {object} skill — { name, description, keywords }
 * @param {Map<string, number>} idf
 * @param {number} avgDocLen
 * @returns {{ name: number, description: number, keywords: number }}
 */
function fieldScores(queryTokens, skill, idf, avgDocLen) {
  const nameTokens = tokenize(skill.name);
  const descTokens = tokenize(skill.description);
  const kwTokens = tokenize(Array.isArray(skill.keywords) ? skill.keywords.join(' ') : '');

  const nameScore = bm25(queryTokens, nameTokens, idf, avgDocLen);
  const descScore = bm25(queryTokens, descTokens, idf, avgDocLen);
  const kwScore = bm25(queryTokens, kwTokens, idf, avgDocLen);

  return { name: nameScore, description: descScore, keywords: kwScore };
}

/**
 * Determine which field contributed the most to the selected skill's score.
 *
 * Uses the weighted per-field scores to find the dominant contributor.
 *
 * @param {object} scores — { name, description, keywords } raw BM25 scores
 * @param {object} weights — { nameWeight, descriptionWeight, keywordWeight }
 * @returns {string} one of 'name' | 'description' | 'keywords'
 */
function dominantField(scores, weights) {
  const weighted = {
    name: scores.name * weights.nameWeight,
    description: scores.description * weights.descriptionWeight,
    keywords: scores.keywords * weights.keywordWeight,
  };

  let best = 'name';
  let bestVal = weighted.name;
  if (weighted.description > bestVal) {
    best = 'description';
    bestVal = weighted.description;
  }
  if (weighted.keywords > bestVal) {
    best = 'keywords';
    bestVal = weighted.keywords;
  }
  return best;
}

/**
 * Attribute a routing decision to the field that drove it.
 *
 * @param {object} decision — routing decision with prompt and selectedSkills
 * @param {string} decision.prompt — raw prompt text for BM25 scoring
 * @param {string} decision.promptHash — SHA-256 hash for correlation
 * @param {string[]} decision.selectedSkills — top-ranked skill names
 * @param {string} outcome — 'positive' | 'negative' | 'unknown'
 * @param {Array<{name:string, description:string, keywords:string[]}>} index — skill index
 * @returns {Attribution|null} — null if no prompt or empty index
 */
export function attributeOutcome(decision, outcome, index) {
  const prompt = decision?.prompt;
  if (!prompt || !index || index.length === 0) return null;

  const queryTokens = tokenize(prompt);
  if (queryTokens.length === 0) return null;

  // Build per-doc token arrays for IDF computation
  const allDocs = index.map((skill) => {
    const nameT = tokenize(skill.name);
    const descT = tokenize(skill.description);
    const kwT = tokenize(Array.isArray(skill.keywords) ? skill.keywords.join(' ') : '');
    return [...nameT, ...descT, ...kwT];
  });

  const idf = computeIdf(allDocs);
  const avgDocLen =
    allDocs.length > 0
      ? allDocs.reduce((sum, t) => sum + t.length, 0) / allDocs.length
      : 1;

  // Score each skill and find the top-ranked one
  let bestSkill = null;
  let bestTotalScore = -Infinity;
  const fieldScoresMap = new Map();

  for (const skill of index) {
    const fs = fieldScores(queryTokens, skill, idf, avgDocLen);
    const total =
      fs.name * nameWeight +
      fs.description * descriptionWeight +
      fs.keywords * keywordWeight;
    fieldScoresMap.set(skill.name, fs);
    if (total > bestTotalScore) {
      bestTotalScore = total;
      bestSkill = skill;
    }
  }

  if (!bestSkill) return null;

  const scores = fieldScoresMap.get(bestSkill.name) ?? { name: 0, description: 0, keywords: 0 };
  const dom = dominantField(scores, { nameWeight, descriptionWeight, keywordWeight });

  return {
    decisionHash: decision.promptHash ?? null,
    outcome,
    fields: {
      name: parseFloat(scores.name.toFixed(6)),
      description: parseFloat(scores.description.toFixed(6)),
      keywords: parseFloat(scores.keywords.toFixed(6)),
    },
    dominantField: dom,
    selectedSkill: bestSkill.name,
  };
}

/**
 * Attribution record shape.
 * @typedef {object} Attribution
 * @property {string|null} decisionHash — SHA-256 hash of the associated prompt
 * @property {string} outcome — 'positive' | 'negative' | 'unknown'
 * @property {object} fields — { name: number, description: number, keywords: number }
 * @property {string} dominantField — 'name' | 'description' | 'keywords'
 * @property {string} selectedSkill — name of the top-ranked skill
 */
