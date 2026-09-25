/**
 * Router selector — chooses between flat and hierarchical routing
 * based on corpus size and benchmark findings.
 *
 * Phase 3 scale benchmark (docs/reports/phase-3-scale-benchmark.md) found:
 *   - Flat is faster at ALL corpus sizes (2ms vs 4ms at N=50 up to 15ms vs 17ms at N=500)
 *   - Flat has equal or slightly better Top-1 accuracy at every scale
 *   - Hierarchical has equal or higher fallback rates
 *   - The "inflection point" at N=50 refers to accuracy dropping below 95%,
 *     not a routing-mode boundary
 *
 * Decision: hierarchical is deprecated as default; flat is the primary path.
 * Hierarchical remains reachable via the `mode: 'hierarchical'` or
 * `experimental: true` option to selectRouter(). There is no --experimental
 * CLI flag; no src/cli/ module parses one.
 */

/**
 * Select the routing strategy based on corpus size and options.
 *
 * @param {number} corpusSize — number of skills in the index
 * @param {object} [options]
 * @param {"flat"|"hierarchical"} [options.mode] — force a specific mode
 * @param {boolean} [options.experimental] — enable deprecated hierarchical path
 * @returns {"flat" | "hierarchical"}
 */
export function selectRouter(corpusSize, options = {}) {
  const { mode, experimental } = options;

  // Explicit mode override takes highest priority
  if (mode === 'hierarchical' || mode === 'flat') {
    return mode;
  }

  // Experimental flag allows hierarchical even though it is deprecated
  if (experimental) {
    return 'hierarchical';
  }

  // Default: always select flat.
  // Benchmark evidence (phase-3-scale-benchmark.md):
  //   N=50  flat=85.0% hier=85.0%  flat 2x faster
  //   N=100 flat=76.0% hier=76.0%  flat 1.67x faster
  //   N=200 flat=50.2% hier=50.2%  flat 1.5x faster
  //   N=300 flat=36.7% hier=36.5%  flat 1.22x faster
  //   N=500 flat=39.5% hier=39.4%  flat 1.13x faster
  // Flat wins on speed at every scale and ties or edges out on accuracy.
  return 'flat';
}
