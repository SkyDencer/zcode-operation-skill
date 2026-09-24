/**
 * Adaptive weight adjustment engine.
 *
 * Takes a collection of Attribution records and adjusts BM25 field weights
 * based on which field dominated successful vs. failed decisions.
 *
 * Algorithm:
 *   - Positive outcomes: increase dominant field weight by 5%
 *   - Negative outcomes: decrease dominant field weight by 5%
 *   - Clamp each weight to [0.5, 5.0]
 *   - Normalize so the sum of weights stays constant
 *   - Require at least MIN_OUTCOMES (default 20) before producing a change
 */
import { getDefaults } from '../../config/defaults.mjs';

const MIN_OUTCOMES = 20;
const ADJUSTMENT_FRACTION = 0.05; // 5%
const WEIGHT_MIN = 0.5;
const WEIGHT_MAX = 5.0;

/**
 * Compute weight adjustments from a batch of attributions.
 *
 * @param {import('./attribution.mjs').Attribution[]} attributions
 * @param {object} currentWeights — { name: number, description: number, keywords: number }
 * @param {object} [opts]
 * @param {number} [opts.minOutcomes] — minimum attributions required (default 20)
 * @param {number} [opts.adjustmentFraction] — percent to adjust per outcome (default 0.05)
 * @returns {WeightUpdate}
 */
export function computeWeights(attributions, currentWeights, opts = {}) {
  const minOutcomes = opts.minOutcomes ?? MIN_OUTCOMES;
  const fraction = opts.adjustmentFraction ?? ADJUSTMENT_FRACTION;

  if (!Array.isArray(attributions) || attributions.length === 0) {
    return { changed: false, newWeights: currentWeights, reason: 'insufficient_data', sampleSize: 0 };
  }

  if (attributions.length < minOutcomes) {
    return {
      changed: false,
      newWeights: currentWeights,
      reason: 'insufficient_data',
      sampleSize: attributions.length,
    };
  }

  // Count signal per field per outcome type
  const positiveSignals = { name: 0, description: 0, keywords: 0 };
  const negativeSignals = { name: 0, description: 0, keywords: 0 };

  for (const attr of attributions) {
    if (attr.dominantField && attr.outcome) {
      if (attr.outcome === 'positive') {
        positiveSignals[attr.dominantField]++;
      } else if (attr.outcome === 'negative') {
        negativeSignals[attr.dominantField]++;
      }
    }
  }

  // Check if there is any meaningful signal
  const totalPositive = Object.values(positiveSignals).reduce((s, v) => s + v, 0);
  const totalNegative = Object.values(negativeSignals).reduce((s, v) => s + v, 0);

  if (totalPositive === 0 && totalNegative === 0) {
    return { changed: false, newWeights: currentWeights, reason: 'no_signal', sampleSize: attributions.length };
  }

  // Compute delta for each field
  const deltas = { name: 0, description: 0, keywords: 0 };
  for (const field of ['name', 'description', 'keywords']) {
    deltas[field] = (positiveSignals[field] - negativeSignals[field]) * fraction;
  }

  // Apply deltas and clamp
  const newWeights = {};
  for (const field of ['name', 'description', 'keywords']) {
    const raw = currentWeights[field] * (1 + deltas[field]);
    newWeights[field] = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, raw));
  }

  // Normalize so sum stays constant
  const oldSum = currentWeights.name + currentWeights.description + currentWeights.keywords;
  const newSum = newWeights.name + newWeights.description + newWeights.keywords;
  if (newSum > 0 && Math.abs(newSum - oldSum) > 1e-9) {
    const ratio = oldSum / newSum;
    for (const field of ['name', 'description', 'keywords']) {
      newWeights[field] = newWeights[field] * ratio;
      // Re-clamp after normalization
      newWeights[field] = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, newWeights[field]));
    }
  }

  // Check if anything actually changed
  let changed = false;
  for (const field of ['name', 'description', 'keywords']) {
    if (Math.abs(newWeights[field] - currentWeights[field]) > 1e-9) {
      changed = true;
      break;
    }
  }

  return {
    changed,
    newWeights,
    reason: changed ? 'applied' : 'no_signal',
    sampleSize: attributions.length,
  };
}

/**
 * WeightUpdate record shape.
 * @typedef {object} WeightUpdate
 * @property {boolean} changed — whether weights were actually modified
 * @property {object} newWeights — { name: number, description: number, keywords: number }
 * @property {string} reason — 'insufficient_data' | 'applied' | 'no_signal'
 * @property {number} sampleSize — number of attributions processed
 */
