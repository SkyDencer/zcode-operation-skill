import { tokenize, computeIdf, bm25 } from './scorer.mjs';
import { readFile } from 'fs/promises';
import { resolve } from 'path';

/**
 * Build a scored, sorted ranking of skills for a given prompt.
 *
 * Score = BM25(name tokens ×3) + BM25(description tokens ×2) + BM25(keywords tokens ×1)
 * Scores are normalized to [0, 1] by dividing by the max raw score.
 *
 * @param {string} prompt
 * @param {Array<{name:string, description:string, keywords:string[], domains:string[], path:string, version:string}>} index
 * @returns {Array<{skill: object, score: number}>}
 */
export function rankSkills(prompt, index) {
  const queryTokens = tokenize(prompt);
  if (queryTokens.length === 0) return [];

  // Build per-doc token arrays with field weights
  const docs = index.map((skill) => {
    const nameTokens = tokenize(skill.name);
    const descTokens = tokenize(skill.description);
    const kwTokens = tokenize(skill.keywords.join(' '));
    // Combine with multiplicity: name×3, desc×2, keywords×1
    const combined = [
      ...Array(nameTokens.length * 3).fill(null).flatMap((_, i) => nameTokens),
      ...Array(descTokens.length * 2).fill(null).flatMap((_, i) => descTokens),
      ...kwTokens,
    ];
    return { skill, combinedTokens: combined };
  });

  const allDocs = docs.map((d) => d.combinedTokens);
  const idf = computeIdf(allDocs);
  const avgDocLen =
    allDocs.length > 0
      ? allDocs.reduce((sum, t) => sum + t.length, 0) / allDocs.length
      : 1;

  const scored = docs.map((d) => {
    const rawScore = bm25(queryTokens, d.combinedTokens, idf, avgDocLen);
    return { skill: d.skill, rawScore };
  });

  const maxScore = scored.reduce((max, s) => Math.max(max, s.rawScore), 0);

  // Normalize to [0, 1]
  scored.sort((a, b) => b.rawScore - a.rawScore);
  return scored.map((s) => ({
    skill: s.skill,
    score: maxScore > 0 ? s.rawScore / maxScore : 0,
  }));
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
