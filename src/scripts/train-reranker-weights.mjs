/**
 * Train reranker feature weights via ordinary least squares on the 30-prompt
 * benchmark dataset.
 *
 * For each prompt, the script:
 *   1. Runs hybrid retrieval to get the top-20 candidate skills.
 *   2. Computes all reranker features for each candidate (including
 *      embeddingSimilarity when a provider is available).
 *   3. Labels each candidate: 1 if it appears in the expected answers, 0 otherwise.
 *   4. Solves the OLS normal equations (X'X)^-1 X'y to find optimal weights.
 *   5. Reports R² in-sample AND on a held-out 20% prompt split.
 *   6. Writes the trained weights to data/reranker-weights.json.
 *
 * The training is deterministic and idempotent: re-running produces the same
 * weights (assuming the benchmark data and index are unchanged).
 *
 * WHAT THE FIT NUMBERS DO AND DO NOT MEAN — read before quoting R²:
 *   - R² reported as "in-sample" is computed on the same (X, y) the weights
 *     were fitted on. It is a goodness-of-fit statistic, NOT a generalisation
 *     estimate. The held-out figure is the one to quote.
 *   - Labels merge "expected" and "acceptable" answers, which are two
 *     different notions of correctness.
 *   - The corpus is heavily imbalanced: roughly 9% of the 600 samples are
 *     positive, so a high R² is mostly explained by the majority class.
 *   - Candidates are the top-20 of hybrid retrieval, so the reranker can
 *     never rescue a skill the retriever already ranked below 20.
 *   - Weights are fitted against FNV-1a cosines but the engine applies them
 *     regardless of the active provider, so `embeddingSimilarity` is an
 *     out-of-distribution feature when ONNX is enabled.
 *
 * Usage:
 *   node src/scripts/train-reranker-weights.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hybridRetrieve } from '../core/retriever/hybrid.mjs';
import { extractFeatures } from '../core/reranker/features.mjs';
import { createProvider } from '../core/embeddings/provider.mjs';

const BASE = resolve('.');
const PROMPTS_PATH = resolve(BASE, 'tests/slm-benchmark/prompts.json');
const EXPECTED_PATH = resolve(BASE, 'tests/slm-benchmark/expected.json');
const INDEX_PATH = resolve(BASE, 'data/skill-index.json');
const OUTPUT_PATH = resolve(BASE, 'data/reranker-weights.json');

const prompts = JSON.parse(readFileSync(PROMPTS_PATH, 'utf-8'));
const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf-8'));
const index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
const leafIndex = index.filter((s) => !s.name.startsWith('router-'));

// Feature names (must match the keys returned by extractFeatures)
const FEATURE_NAMES = ['exactKeyword', 'bigramOverlap', 'domainMatch', 'titleMatch', 'embeddingSimilarity'];

/**
 * Build the design matrix X and target vector y from the benchmark.
 *
 * Each row of X corresponds to one (prompt, candidate) pair.
 * Each entry of y is 1 if the candidate is an expected answer, 0 otherwise.
 *
 * @returns {{X: number[][], y: number[]}}
 */
function buildTrainingData() {
  const X = [];
  const y = [];
  const promptIds = [];

  for (const prompt of prompts) {
    const promptId = prompt.id;
    const expectedEntry = expected[promptId];
    if (!expectedEntry) continue;

    const expectedSkills = new Set(expectedEntry.skills || []);
    const acceptableSkills = new Set(expectedEntry.acceptable || expectedEntry.skills || []);

    // Get top candidates from hybrid retrieval
    const results = hybridRetrieve(prompt.prompt, leafIndex, {
      rerank: false,
      topK: 20,
      provider: createProvider('fnv1a'),
    });

    for (const result of results) {
      const skill = result.skill;
      const features = extractFeatures(prompt.prompt, skill, {
        provider: createProvider('fnv1a'),
      });

      const row = FEATURE_NAMES.map((name) => features[name] ?? 0);
      // Label: 1 if expected or acceptable, 0 otherwise
      const label = expectedSkills.has(skill.name) || acceptableSkills.has(skill.name) ? 1 : 0;

      X.push(row);
      y.push(label);
      promptIds.push(promptId);
    }
  }

  return { X, y, promptIds };
}

/**
 * Split sample indices into a fit set and a held-out set by prompt.
 *
 * The split is by prompt, not by sample, so every candidate of a held-out
 * prompt stays out of the fit. Prompt ids are ordered deterministically and
 * the last 20% are held out.
 *
 * @param {string[]} promptIds — one id per row of X
 * @param {number} [holdoutFraction=0.2]
 * @returns {{fit: number[], holdout: number[]}} row indices
 */
export function splitByPrompt(promptIds, holdoutFraction = 0.2) {
  const unique = [...new Set(promptIds)].sort();
  const holdoutCount = Math.max(1, Math.round(unique.length * holdoutFraction));
  const holdoutIds = new Set(unique.slice(-holdoutCount));
  const fit = [];
  const holdout = [];
  promptIds.forEach((id, i) => (holdoutIds.has(id) ? holdout : fit).push(i));
  return { fit, holdout };
}

/**
 * Solve the OLS normal equations: w = (X'X)^-1 X'y.
 *
 * Uses Gaussian elimination with partial pivoting for numerical stability.
 *
 * @param {number[][]} X — design matrix (n x p)
 * @param {number[]} y — target vector (n,)
 * @returns {number[]} — weight vector (p,)
 */
function ols(X, y) {
  const n = X.length;
  const p = X[0].length;

  // Compute X'X
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      for (let b = 0; b < p; b++) {
        XtX[a][b] += X[i][a] * X[i][b];
      }
    }
  }

  // Compute X'y
  const XtY = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      XtY[a] += X[i][a] * y[i];
    }
  }

  // Add small ridge regularization for numerical stability
  for (let i = 0; i < p; i++) {
    XtX[i][i] += 1e-6;
  }

  // Gaussian elimination with partial pivoting
  const aug = XtX.map((row, i) => [...row, XtY[i]]);
  for (let col = 0; col < p; col++) {
    // Partial pivot
    let maxRow = col;
    for (let row = col + 1; row < p; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) {
        maxRow = row;
      }
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) continue;

    for (let row = col + 1; row < p; row++) {
      const factor = aug[row][col] / pivot;
      for (let j = col; j <= p; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Back substitution
  const weights = new Array(p).fill(0);
  for (let i = p - 1; i >= 0; i--) {
    let sum = aug[i][p];
    for (let j = i + 1; j < p; j++) {
      sum -= aug[i][j] * weights[j];
    }
    weights[i] = sum / aug[i][i];
  }

  return weights;
}

/**
 * Evaluate R² on the training data.
 *
 * @param {number[][]} X
 * @param {number[]} y
 * @param {number[]} weights
 * @returns {number}
 */
function rSquared(X, y, weights) {
  const n = y.length;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const pred = X[i].reduce((sum, x, j) => sum + x * weights[j], 0);
    ssTot += (y[i] - meanY) ** 2;
    ssRes += (y[i] - pred) ** 2;
  }
  return ssTot === 0 ? 1 : 1 - ssRes / ssTot;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('Training reranker weights on 30-prompt benchmark...\n');

const { X, y, promptIds } = buildTrainingData();
console.log(`  Training samples: ${X.length}`);
console.log(`  Features: ${FEATURE_NAMES.join(', ')}`);
console.log(`  Positive labels: ${y.filter((v) => v === 1).length} / ${y.length}`);
console.log(`  Label rule: expected OR acceptable (two different notions of correctness)`);
console.log(`  Candidate ceiling: hybrid top-20 per prompt`);

const weights = ols(X, y);
const r2InSample = rSquared(X, y, weights);

// Held-out estimate: fit on 80% of the prompts, score the remaining 20%.
// The in-sample figure above is a fit statistic and is labelled as such.
const { fit, holdout } = splitByPrompt(promptIds);
const holdoutWeights = ols(fit.map((i) => X[i]), fit.map((i) => y[i]));
const r2HeldOut = rSquared(
  holdout.map((i) => X[i]),
  holdout.map((i) => y[i]),
  holdoutWeights
);

console.log('\nTrained weights:');
for (let i = 0; i < FEATURE_NAMES.length; i++) {
  console.log(`  ${FEATURE_NAMES[i]}: ${weights[i].toFixed(4)}`);
}
console.log(`  R² (in-sample, fit statistic): ${r2InSample.toFixed(4)}`);
console.log(`  R² (held-out, ${holdout.length} of ${X.length} rows): ${r2HeldOut.toFixed(4)}`);

// Write trained weights
const weightData = {};
for (let i = 0; i < FEATURE_NAMES.length; i++) {
  weightData[FEATURE_NAMES[i]] = Math.round(weights[i] * 10000) / 10000;
}

writeFileSync(OUTPUT_PATH, JSON.stringify(weightData, null, 2), 'utf-8');
console.log(`\nWeights written to ${OUTPUT_PATH}`);
