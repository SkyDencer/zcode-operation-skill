/**
 * Time utility functions.
 */

/**
 * Return the current timestamp as an ISO 8601 string.
 *
 * @returns {string}
 */
export function now() {
  return new Date().toISOString();
}

/**
 * Measure the execution time of an async function in milliseconds.
 *
 * @param {Function} fn
 * @returns {Promise<{result: *, durationMs: number}>}
 */
export async function measure(fn) {
  const start = performance.now();
  const result = await fn();
  const durationMs = Math.round(performance.now() - start);
  return { result, durationMs };
}

/**
 * Compute the p-th percentile of an array of numbers.
 *
 * @param {number[]} arr
 * @param {number} p — percentile (0–100)
 * @returns {number}
 */
export function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}
