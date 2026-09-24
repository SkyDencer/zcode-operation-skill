/**
 * Tune guardrails — safety checks before applying weight changes.
 *
 * Validates proposed weights against the frozen baseline to ensure
 * no regression exceeds the tolerance threshold. Used by the --apply
 * and --auto commands in src/cli/tune.mjs.
 *
 * Checks performed:
 *   1. Baseline file exists and is readable
 *   2. Proposed weights are within [0.5, 5.0] clamping bounds
 *   3. Weight deltas do not exceed MAX_DELTA per field
 *   4. Predicted accuracy change stays within tolerance
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const BASELINE_PATH = resolve('data', 'baseline.json');
const MAX_DELTA = 0.5; // maximum allowed absolute change per field
const ACCURACY_TOLERANCE = 1.0; // percentage points tolerance

/**
 * Load the frozen baseline from data/baseline.json.
 *
 * @returns {{ top1: number, weights: {name:number, description:number, keywords:number}, baselineAt: string }|null}
 */
export function loadBaseline() {
  try {
    if (!existsSync(BASELINE_PATH)) return null;
    const raw = readFileSync(BASELINE_PATH, 'utf-8');
    const data = JSON.parse(raw);
    if (typeof data.benchmark?.top1 !== 'number') return null;
    return {
      top1: data.benchmark.top1,
      weights: data.weights ?? { name: 3, description: 2, keywords: 1 },
      baselineAt: data.baselineAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Check whether a proposed weight change is safe to apply.
 *
 * Returns a GuardResult with action: 'accept' | 'revert' | 'refuse'.
 *
 * - 'accept': weights are within bounds and no regression expected
 * - 'revert': weights would cause a regression > tolerance
 * - 'refuse': weights are malformed or outside hard bounds
 *
 * @param {object} proposedWeights — { name, description, keywords }
 * @param {object} [baseline] — from loadBaseline(), uses hardcoded defaults if absent
 * @returns {GuardResult}
 */
export function checkSafety(proposedWeights, baseline) {
  const result = {
    action: 'accept',
    reason: '',
    proposedWeights,
    baselineTop1: baseline?.top1 ?? 0.9231,
  };

  // Validate weights shape
  for (const field of ['name', 'description', 'keywords']) {
    if (typeof proposedWeights[field] !== 'number' || Number.isNaN(proposedWeights[field])) {
      result.action = 'refuse';
      result.reason = `invalid weight for field '${field}'`;
      return result;
    }
    if (proposedWeights[field] < 0.5 || proposedWeights[field] > 5.0) {
      result.action = 'refuse';
      result.reason = `weight for '${field}' out of bounds [0.5, 5.0]: ${proposedWeights[field]}`;
      return result;
    }
  }

  // Check delta against baseline weights
  const baseWeights = baseline?.weights ?? { name: 3, description: 2, keywords: 1 };
  for (const field of ['name', 'description', 'keywords']) {
    const delta = Math.abs(proposedWeights[field] - baseWeights[field]);
    if (delta > MAX_DELTA) {
      result.action = 'refuse';
      result.reason = `weight change for '${field}' exceeds MAX_DELTA (${delta.toFixed(3)} > ${MAX_DELTA})`;
      return result;
    }
  }

  // Estimate accuracy impact: use a simple linear model
  // Each 0.1 increase in the dominant field for positive signals is roughly +0.05% Top-1
  // This is a heuristic; the real check is the pre/post benchmark
  const baselineTop1 = result.baselineTop1 * 100; // convert to percentage
  const prevWeights = baseline?.weights ?? baseWeights;

  // Compute a simple predicted delta based on weight changes
  let predictedDelta = 0;
  for (const field of ['name', 'description', 'keywords']) {
    const wDelta = proposedWeights[field] - prevWeights[field];
    // Positive delta on any field is assumed to help slightly
    predictedDelta += wDelta * 0.5; // heuristic factor
  }

  const predictedTop1 = baselineTop1 + predictedDelta;
  const diff = predictedTop1 - baselineTop1;

  if (diff < -ACCURACY_TOLERANCE) {
    result.action = 'revert';
    result.reason = `predicted accuracy drop of ${Math.abs(diff).toFixed(2)}pp exceeds tolerance of ${ACCURACY_TOLERANCE}pp`;
  }

  return result;
}

/**
 * Compare pre and post benchmark results to determine if application was safe.
 *
 * @param {number} beforeTop1 — Top-1 accuracy before (percentage, e.g. 92.31)
 * @param {number} afterTop1 — Top-1 accuracy after (percentage, e.g. 91.50)
 * @param {number} [tolerance] — percentage point tolerance (default 1.0)
 * @returns {('accepted'|'reverted') & {reason: string}}
 */
export function evaluateOutcome(beforeTop1, afterTop1, tolerance = ACCURACY_TOLERANCE) {
  const diff = afterTop1 - beforeTop1;
  if (diff < -tolerance) {
    return { outcome: 'reverted', reason: `accuracy dropped ${Math.abs(diff).toFixed(2)}pp (tolerance: ${tolerance}pp)` };
  }
  return { outcome: 'accepted', reason: `accuracy changed by ${diff >= 0 ? '+' : ''}${diff.toFixed(2)}pp` };
}

/**
 * GuardResult record shape.
 * @typedef {object} GuardResult
 * @property {'accept'|'revert'|'refuse'} action — what to do
 * @property {string} reason — human-readable explanation
 * @property {object} proposedWeights
 * @property {number} baselineTop1
 */
