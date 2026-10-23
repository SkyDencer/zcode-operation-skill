/**
 * Adaptive threshold tuner for the Skill Router.
 *
 * Uses grid search over confidence thresholds to find the combination
 * that maximizes Top-1 accuracy while keeping the fallback (no-skill)
 * rate below 15%.
 *
 * Usage:
 *   node src/tuning/optimizer.mjs [--output data/thresholds.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rankSkills } from '../core/retriever/bm25.mjs';

// ── Grid definition ──────────────────────────────────────────────────────────

const HIGH_RANGE = [];
for (let v = 0.70; v <= 0.95 + 1e-9; v += 0.05) {
  HIGH_RANGE.push(Math.round(v * 100) / 100);
}

const MEDIUM_RANGE = [];
for (let v = 0.40; v <= 0.75 + 1e-9; v += 0.05) {
  MEDIUM_RANGE.push(Math.round(v * 100) / 100);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Rank every prompt against the index exactly once.
 *
 * The ranking is threshold-independent: a grid cell only re-scores the
 * confidence band, never the ordering. Running the grid with the ranking
 * inside the cell loop re-ranked every prompt once per cell (45 redundant
 * full-index rankSkills calls per prompt) and a single optimizer run took
 * ~164 s on the 252-skill corpus. Hoisting the ranking out keeps the result
 * bit-identical (cells read only ranked[0].skill.name and ranked[0].score)
 * and drops the dominant cost to one rankSkills call per prompt.
 *
 * @param {Array<{prompt:string}>} prompts
 * @param {Array} index
 * @returns {Array<{topSkill:string|null, topScore:number}>}
 */
function rankPromptsOnce(prompts, index) {
  return prompts.map((p) => {
    const ranked = rankSkills(p.prompt, index);
    return {
      topSkill: ranked.length > 0 ? ranked[0].skill.name : null,
      topScore: ranked.length > 0 ? ranked[0].score : 0,
    };
  });
}

/**
 * Evaluate one medium threshold against pre-ranked prompts.
 *
 * `high` is deliberately not a parameter: it constrains the grid and
 * tie-breaks the winner, but a cell's per-prompt result depends on
 * `medium` only (fallback = no top skill, or top score below medium).
 *
 * @param {Array<{topSkill:string|null, topScore:number}>} preRanked
 * @param {Array<{id:number, expected:string|null}>} expected
 * @param {number} medium
 * @returns {{top1:number, fallbackRate:number, total:number, hits:number, fallbacks:number}}
 */
function evaluateCell(preRanked, expected, medium) {
  let hits = 0;
  let fallbacks = 0;
  const total = preRanked.length;

  for (let i = 0; i < total; i++) {
    const topSkill = preRanked[i].topSkill;
    const topScore = preRanked[i].topScore;
    const exp = expected[i]?.expected;
    const expName = exp === null ? null : String(exp);

    // Top-1 hit: top skill matches expected
    if (topSkill === expName) hits++;

    // Fallback: no skill or score below medium threshold
    if (!topSkill || topScore < medium) fallbacks++;
  }

  return {
    top1: hits / total,
    fallbackRate: fallbacks / total,
    total,
    hits,
    fallbacks,
  };
}

/**
 * Distance from a value to the reference (current default).
 */
function distTo(val, ref) {
  return Math.abs(val - ref);
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Optimize confidence thresholds via grid search.
 *
 * @param {Array<{prompt:string}>} prompts — from tests/prompts.json
 * @param {Array} index — skill index from data/skill-index.json
 * @param {Array<{id:number, expected:string|null}>} expected — from tests/expected-routes.json
 * @param {object} [options]
 * @param {number} [options.highDefault=0.85] — reference high threshold for tie-breaking
 * @param {number} [options.mediumDefault=0.60] — reference medium threshold for tie-breaking
 * @returns {{high:number, medium:number, noSkill:number, top1:number, fallbackRate:number, gridEvaluated:number}}
 */
export function optimizeThresholds(prompts, index, expected, options = {}) {
  const highDefault = options.highDefault ?? 0.85;
  const mediumDefault = options.mediumDefault ?? 0.60;

  // Rank every prompt once; the 45-cell grid then only re-scores the
  // confidence band on those fixed rankings (see rankPromptsOnce).
  const preRanked = rankPromptsOnce(prompts, index);

  let best = null;
  let gridEvaluated = 0;

  for (const high of HIGH_RANGE) {
    for (const medium of MEDIUM_RANGE) {
      // Sanity: medium must be strictly less than high
      if (medium >= high) continue;

      gridEvaluated++;
      const result = evaluateCell(preRanked, expected, medium);

      if (result.fallbackRate >= 0.15) continue; // constraint violated

      if (best === null) {
        best = { high, medium, ...result };
        continue;
      }

      // Primary: maximize Top-1
      if (result.top1 > best.top1) {
        best = { high, medium, ...result };
        continue;
      }
      if (result.top1 < best.top1) continue;

      // Tie-break: minimize fallback rate
      if (result.fallbackRate < best.fallbackRate) {
        best = { high, medium, ...result };
        continue;
      }
      if (result.fallbackRate > best.fallbackRate) continue;

      // Tie-break: closest to current defaults
      const bestDist = distTo(best.high, highDefault) + distTo(best.medium, mediumDefault);
      const curDist = distTo(high, highDefault) + distTo(medium, mediumDefault);
      if (curDist < bestDist) {
        best = { high, medium, ...result };
      }
    }
  }

  if (best === null) {
    // Fallback to defaults if no valid combination found
    const atDefaults = evaluateCell(preRanked, expected, mediumDefault);
    best = {
      high: highDefault,
      medium: mediumDefault,
      top1: atDefaults.top1,
      fallbackRate: atDefaults.fallbackRate,
      total: prompts.length,
      hits: 0,
      fallbacks: 0,
    };
  }

  // noSkill = fallback rate expressed as a count
  const noSkill = Math.round(best.fallbackRate * best.total);

  return {
    high: best.high,
    medium: best.medium,
    noSkill,
    total: best.total,
    top1: best.top1,
    fallbackRate: best.fallbackRate,
    gridEvaluated,
  };
}

// ── CLI entry point ──────────────────────────────────────────────────────────

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.url.split('/').slice(3).join('/'))) {
  const BASE = resolve('.');
  const PROMPTS_PATH = resolve(BASE, 'tests/prompts.json');
  const EXPECTED_PATH = resolve(BASE, 'tests/expected-routes.json');
  const INDEX_PATH = resolve(BASE, 'data/skill-index.json');

  const args = process.argv.slice(2);
  let outputPath = resolve(BASE, 'data/thresholds.json');
  const outputFlag = args.find((a) => a.startsWith('--output='))?.split('=')[1];
  if (outputFlag) outputPath = resolve(BASE, outputFlag);

  const startTime = performance.now();

  const prompts = JSON.parse(readFileSync(PROMPTS_PATH, 'utf-8'));
  const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf-8'));
  const index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
  // Threshold tuning mirrors the hook's implicit route: router-* dispatchers are
  // used only for explicit mentions and must not compete with leaf skills.
  const leafIndex = index.filter((skill) => !skill.name.startsWith('router-'));

  const result = optimizeThresholds(prompts, leafIndex, expected);
  const elapsed = performance.now() - startTime;

  // Write thresholds file
  const thresholdsData = {
    high: result.high,
    medium: result.medium,
    noSkill: result.noSkill,
    optimizedAt: new Date().toISOString(),
    benchmark: {
      top1: result.top1,
      fallbackRate: result.fallbackRate,
      gridEvaluated: result.gridEvaluated,
      elapsedMs: Math.round(elapsed),
    },
  };
  writeFileSync(outputPath, JSON.stringify(thresholdsData, null, 2), 'utf-8');

  console.log(`Optimized thresholds written to ${outputPath}`);
  console.log(`  high:    ${result.high}`);
  console.log(`  medium:  ${result.medium}`);
  console.log(`  noSkill: ${result.noSkill} / ${result.total}`);
  console.log(`  Top-1:   ${(result.top1 * 100).toFixed(2)}%`);
  console.log(`  Fallback: ${(result.fallbackRate * 100).toFixed(2)}%`);
  console.log(`  Grid:    ${result.gridEvaluated} combinations evaluated`);
  console.log(`  Time:    ${elapsed.toFixed(0)} ms`);
}
