/**
 * In-memory metrics aggregator for the Skill Router.
 *
 * Collects timing, accuracy, and count metrics during a session
 * and exposes snapshot / reset APIs.
 */
const counters = new Map();
const timings = new Map();

/**
 * Increment a counter metric.
 *
 * @param {string} name
 * @param {number} delta
 */
export function increment(name, delta = 1) {
  counters.set(name, (counters.get(name) || 0) + delta);
}

/**
 * Record a duration sample for a named metric.
 *
 * @param {string} name
 * @param {number} durationMs
 */
export function recordTiming(name, durationMs) {
  if (!timings.has(name)) timings.set(name, []);
  timings.get(name).push(durationMs);
  // Keep only the last 1000 samples to bound memory
  if (timings.get(name).length > 1000) {
    timings.get(name).shift();
  }
}

/**
 * Take a snapshot of all current metrics.
 *
 * @returns {object}
 */
export function getSnapshot() {
  const result = { counters: Object.fromEntries(counters), timings: {} };
  for (const [name, samples] of timings) {
    const sorted = [...samples].sort((a, b) => a - b);
    const n = sorted.length;
    result.timings[name] = {
      count: n,
      min: sorted[0],
      max: sorted[n - 1],
      mean: sorted.reduce((s, v) => s + v, 0) / n,
      median: sorted[Math.floor(n / 2)],
    };
  }
  return result;
}

/**
 * Reset all recorded metrics.
 */
export function resetMetrics() {
  counters.clear();
  timings.clear();
}
