/**
 * Tuning report generator.
 *
 * Produces a human-readable markdown report comparing optimized thresholds
 * against the default (hardcoded) thresholds, with benchmark metrics for
 * both configurations.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { optimizeThresholds } from './optimizer.mjs';

/**
 * Format a tuning result as a markdown string.
 *
 * @param {object} result — from optimizeThresholds()
 * @param {object} [options]
 * @param {number} [options.defaultHigh=0.85]
 * @param {number} [options.defaultMedium=0.60]
 * @param {object} [options.baseline] — optional prior benchmark to compare against
 * @param {number} [options.baseline.top1]
 * @param {number} [options.baseline.fallbackRate]
 * @returns {string}
 */
export function reportTuning(result, options = {}) {
  const defaultHigh = options.defaultHigh ?? 0.85;
  const defaultMedium = options.defaultMedium ?? 0.60;
  const baseline = options.baseline ?? {};

  const lines = [];
  lines.push('## Adaptive Threshold Tuning Report');
  lines.push('');
  lines.push(`**Optimized at:** ${result.optimizedAt ?? 'N/A'}`);
  lines.push('');

  // ── Threshold comparison ──────────────────────────────────────────────────
  lines.push('### Threshold Comparison');
  lines.push('');
  lines.push('| Setting | Default | Optimized | Delta |');
  lines.push('|---------|---------|-----------|-------|');
  lines.push(
    `| high    | ${defaultHigh.toFixed(2)}       | ${result.high.toFixed(2)}         | ${(result.high - defaultHigh).toFixed(2)}      |`
  );
  lines.push(
    `| medium  | ${defaultMedium.toFixed(2)}      | ${result.medium.toFixed(2)}         | ${(result.medium - defaultMedium).toFixed(2)}      |`
  );
  lines.push('');

  // ── Benchmark metrics ─────────────────────────────────────────────────────
  lines.push('### Benchmark Metrics (Optimized)');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Top-1 Accuracy | ${(result.top1 * 100).toFixed(2)}% |`);
  lines.push(`| Fallback Rate | ${(result.fallbackRate * 100).toFixed(2)}% |`);
  lines.push(`| No-Skill Count | ${result.noSkill} / ${result.total} |`);
  lines.push(`| Grid Combinations Evaluated | ${result.gridEvaluated} |`);
  lines.push('');

  // ── Baseline comparison ───────────────────────────────────────────────────
  if (baseline.top1 !== undefined || baseline.fallbackRate !== undefined) {
    lines.push('### vs Default Thresholds (Baseline)');
    lines.push('');
    lines.push('| Metric | Baseline | Optimized | Change |');
    lines.push('|--------|----------|-----------|--------|');
    const baselineTop1 = baseline.top1 ?? 0;
    const optTop1 = result.top1;
    const top1Delta = ((optTop1 - baselineTop1) * 100).toFixed(2);
    const sign = top1Delta.startsWith('-') ? '' : '+';
    lines.push(
      `| Top-1 Accuracy | ${(baselineTop1 * 100).toFixed(2)}% | ${(optTop1 * 100).toFixed(2)}% | ${sign}${top1Delta}% |`
    );

    const baselineFallback = baseline.fallbackRate ?? 0;
    const optFallback = result.fallbackRate;
    const fallbackDelta = ((optFallback - baselineFallback) * 100).toFixed(2);
    const fSign = fallbackDelta.startsWith('-') ? '' : '+';
    lines.push(
      `| Fallback Rate | ${(baselineFallback * 100).toFixed(2)}% | ${(optFallback * 100).toFixed(2)}% | ${fSign}${fallbackDelta}% |`
    );
    lines.push('');
  }

  // ── Grid summary ──────────────────────────────────────────────────────────
  lines.push('### Grid Search Summary');
  lines.push('');
  // Compute counts using integer arithmetic to avoid floating-point drift
  const highCount = Math.round((0.95 - 0.70) / 0.05) + 1;
  const mediumCount = Math.round((0.75 - 0.40) / 0.05) + 1;
  lines.push(`- **High range:** [0.70, 0.95] step 0.05 (${highCount} values)`);
  lines.push(`- **Medium range:** [0.40, 0.75] step 0.05 (${mediumCount} values)`);
  lines.push(`- **Valid combinations (medium < high):** ${result.gridEvaluated}`);
  lines.push(`- **Constraint:** fallback rate < 15%`);
  lines.push(`- **Tie-breaker:** closest to defaults (high=${defaultHigh}, medium=${defaultMedium})`);
  lines.push('');

  return lines.join('\n');
}

// ── CLI entry point ──────────────────────────────────────────────────────────

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.url.split('/').slice(3).join('/'))) {
  const BASE = resolve('.');
  const PROMPTS_PATH = resolve(BASE, 'tests/prompts.json');
  const EXPECTED_PATH = resolve(BASE, 'tests/expected-routes.json');
  const INDEX_PATH = resolve(BASE, 'data/skill-index.json');
  const THRESHOLDS_PATH = resolve(BASE, 'data/thresholds.json');

  const prompts = JSON.parse(readFileSync(PROMPTS_PATH, 'utf-8'));
  const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf-8'));
  const index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
  const thresholds = JSON.parse(readFileSync(THRESHOLDS_PATH, 'utf-8'));
  // Report the same implicit-routing corpus as the optimizer: router-* entries
  // are explicit dispatchers and must not lower the leaf-skill benchmark score.
  const leafIndex = index.filter((skill) => !skill.name.startsWith('router-'));

  const result = optimizeThresholds(prompts, leafIndex, expected);
  const report = reportTuning(result, {
    defaultHigh: 0.85,
    defaultMedium: 0.60,
    baseline: {
      top1: thresholds.benchmark?.top1 ?? 0.90,
      fallbackRate: thresholds.benchmark?.fallbackRate ?? 0.0846,
    },
  });

  console.log(report);
}
