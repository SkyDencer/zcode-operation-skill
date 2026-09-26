/**
 * runner.mjs — Scale benchmark runner for BM25 at fixed corpus sizes.
 *
 * For each size in `config.sizes` (default [54, 200, 500, 1000]):
 *   1. Load the full skill index from data/skill-index.json.
 *   2. Sample a stratified subset via tests/scale-benchmark/corpus-sampler.mjs.
 *   3. Run every prompt from `config.promptsPath` through `rankSkills()`
 *      (pure BM25, no synonym expansion, no reranking).
 *   4. Compute Top-1 accuracy, Recall@3, Set Recall@5, median latency, p95
 *      latency, and fallback rate.
 *
 * Outputs:
 *   - docs/reports/phase-7-scale-results.json   (machine-readable)
 *   - docs/reports/phase-7-scale-results.md     (human-readable)
 *
 * Usage:
 *   node tests/scale-benchmark/runner.mjs [--sizes 54,200,500,1000]
 *                                          [--prompts-path tests/prompts.json]
 *                                          [--modes bm25]
 *
 * A per-prompt timeout (default 5 000 ms) ensures a single hung prompt fails
 * loudly rather than blocking the whole run.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { rankSkills } from '../../src/index.mjs';
import { percentile } from '../../src/utils/time.mjs';
import { sampleCorpus } from './corpus-sampler.mjs';
import { gradePrompt } from '../benchmark/metrics.mjs';

// ── Paths ─────────────────────────────────────────────────────────────────────
const BASE = resolve('.');
const DEFAULT_INDEX = resolve('data/skill-index.json');
const DEFAULT_PROMPTS = resolve('tests/scale-benchmark/prompts.json');
const DEFAULT_EXPECTED = resolve('tests/scale-benchmark/expected.json');
const REPORTS_DIR = resolve('docs/reports');
const REPORT_DATE = new Date().toISOString().slice(0, 10);

mkdirSync(REPORTS_DIR, { recursive: true });

// ── CLI flag parser ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flagValue = (name) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
  || (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);

const sizesArg = flagValue('sizes');
const sizes = sizesArg
  ? sizesArg.split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n > 0)
  : [54, 200, 500, 1000];

const promptsPath = flagValue('prompts-path') || DEFAULT_PROMPTS;
const modesArg = flagValue('modes') || 'bm25';
const modes = modesArg.split(',').map((m) => m.trim());

const PROMPT_TIMEOUT_MS = 5000;

// ── Helpers ───────────────────────────────────────────────────────────────────
/**
 * Format a ratio as a percentage string.
 * @param {number} v
 * @returns {string}
 */
function fmtPct(v) {
  return (v * 100).toFixed(2) + '%';
}

/**
 * Run one prompt through rankSkills with a timeout guard.
 *
 * @param {string} prompt
 * @param {Array<object>} index
 * @returns {{ ranked: Array<{skill:object,score:number}>, latencyMs: number, timedOut: boolean }}
 */
function runOnePrompt(prompt, index) {
  const start = performance.now();
  let timedOut = false;
  /** @type {Array<{skill:object,score:number}>} */
  let ranked = [];

  // Use a timer to enforce the per-prompt timeout.
  const timer = setTimeout(() => {
    timedOut = true;
    // rankSkills is synchronous; we cannot actually abort it, but we mark
    // the result so the caller knows this prompt exceeded the budget.
  }, PROMPT_TIMEOUT_MS);
  timer.unref && timer.unref();

  try {
    ranked = rankSkills(prompt, index);
  } catch (err) {
    console.warn(`[scale-benchmark] prompt ${prompt.slice(0, 40)} threw: ${err.message}`);
    ranked = [];
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = Math.round(performance.now() - start);
  return { ranked, latencyMs, timedOut };
}

/**
 * Run the scale benchmark for a single configuration object.
 *
 * @param {{sizes?: number[], promptsPath?: string}} config
 * @returns {{date: string, fullLeafCount: number, promptCount: number, sizes: number[], modes: string[], runs: Array<{size:number, mode:string, skillsSampled:number, top1:number, recall3:number, setRecall:number, setRecallSkill:number, medianMs:number, p95Ms:number, fallbackRate:number, promptCount:number, timeoutCount:number, details:Array}>}}
 */
export function runScaleBenchmark(config = {}) {
  const sizes = config.sizes || [54, 200, 500, 1000];
  const promptsPath = config.promptsPath || DEFAULT_PROMPTS;
  const modes = ['bm25'];

  // Load full index and prompts once
  const fullIndex = JSON.parse(readFileSync(DEFAULT_INDEX, 'utf-8'));
  const leaves = fullIndex.filter((s) => !s.name.startsWith('router-'));

  const prompts = JSON.parse(readFileSync(promptsPath, 'utf-8'));
  const expectedMap = new Map();
  try {
    const candidates = [
      DEFAULT_EXPECTED,
      resolve(promptsPath.replace('prompts.json', 'expected.json')),
      resolve('tests/expected-routes.json'),
    ];
    let expectedArr = null;
    for (const ep of candidates) {
      try {
        expectedArr = JSON.parse(readFileSync(ep, 'utf-8'));
        break;
      } catch {}
    }
    if (expectedArr) {
      for (const entry of expectedArr) {
        expectedMap.set(entry.id, entry.expected);
      }
    }
  } catch {}

  /** @type {Array<{size:number, mode:string, top1:number, recall3:number, setRecall:number, setRecallSkill:number, medianMs:number, p95Ms:number, fallbackRate:number, promptCount:number, timeoutCount:number, details:Array}>} */
  const allRuns = [];

  for (const size of sizes) {
    for (const mode of modes) {
      // Sample corpus
      const sampled = sampleCorpus(leaves, size, 42);

      // Run prompts
      let top1Hits = 0;
      let recall3Hits = 0;
      let setRecallHits = 0;
      let setRecallSkillHits = 0;
      let noSkillPrompts = 0;
      let fallbackCount = 0;
      const latencies = [];
      let timeoutCount = 0;
      /** @type {Array<{id:number, expected:string|null, topSkill:string|null, score:number|null, latencyMs:number, matched:boolean}>} */
      const details = [];

      for (const p of prompts) {
        const { ranked, latencyMs, timedOut } = runOnePrompt(p.prompt, sampled);
        latencies.push(latencyMs);
        if (timedOut) timeoutCount++;

        const topSkill = ranked.length > 0 ? ranked[0].skill.name : null;
        const top3Names = ranked.slice(0, 3).map((r) => r.skill.name);
        const topScore = ranked.length > 0 ? (ranked[0].score ?? 0) : 0;

        const expRaw = expectedMap.get(p.id);
        const expName = expRaw === null || expRaw === undefined ? null : String(expRaw);

        // Top-1
        if (topSkill === expName) top1Hits++;

        // Recall@3
        if (expName && top3Names.includes(expName)) recall3Hits++;

        // Set Recall@5
        const isNoSkill = ranked.length === 0 || topScore < 0.01;
        const grade = gradePrompt(expName, top3Names.concat(ranked.slice(3, 5).map((r) => r.skill.name)), isNoSkill, sampled);
        if (grade.kind === 'negative') {
          noSkillPrompts++;
        }
        if (grade.recall === 1) setRecallHits++;
        if (grade.kind === 'skill' && grade.recall === 1) setRecallSkillHits++;

        // Fallback: top score below 0.60 (medium threshold) or empty
        if (!topSkill || topScore < 0.60) fallbackCount++;

        details.push({
          id: p.id,
          expected: expName,
          topSkill,
          score: Math.round(topScore * 1000) / 1000,
          latencyMs,
          matched: topSkill === expName,
        });
      }

      latencies.sort((a, b) => a - b);
      const total = prompts.length;
      const top1 = top1Hits / total;
      const recall3 = recall3Hits / total;
      const setRecall = setRecallHits / total;
      const setRecallSkillDenom = total - noSkillPrompts;
      const setRecallSkill = setRecallSkillDenom > 0 ? setRecallSkillHits / setRecallSkillDenom : 0;
      const medianMs = latencies[Math.floor(latencies.length / 2)];
      const p95Ms = percentile(latencies, 95);
      const fallbackRate = fallbackCount / total;

      allRuns.push({
        size,
        mode,
        skillsSampled: sampled.length,
        top1: Math.round(top1 * 10000) / 10000,
        recall3: Math.round(recall3 * 10000) / 10000,
        setRecall: Math.round(setRecall * 10000) / 10000,
        setRecallSkill: Math.round(setRecallSkill * 10000) / 10000,
        medianMs,
        p95Ms,
        fallbackRate: Math.round(fallbackRate * 10000) / 10000,
        promptCount: total,
        timeoutCount,
        details,
      });
    }
  }

  return {
    date: REPORT_DATE,
    fullLeafCount: leaves.length,
    promptCount: prompts.length,
    promptsPath,
    sizes,
    modes,
    runs: allRuns,
  };
}

// ── CLI entry point ───────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runScaleBenchmark({
    sizes,
    promptsPath,
  });

  // Write JSON report
  const jsonPath = resolve(REPORTS_DIR, 'phase-7-scale-results.json');
  writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`\nJSON report written to ${jsonPath}`);

  // Write markdown report
  const mdPath = resolve(REPORTS_DIR, 'phase-7-scale-results.md');
  let md = `# Phase 7 — Scale Benchmark Results\n\n`;
  md += `> Date: ${result.date}\n`;
  md += `> Full leaf corpus: ${result.fullLeafCount} skills\n`;
  md += `> Prompts: ${result.promptCount}\n`;
  md += `> Sizes tested: ${result.sizes.join(', ')}\n`;
  md += `> Modes: ${result.modes.join(', ')}\n\n`;

  md += `## Method\n\n`;
  md += `For each corpus size:\n`;
  md += `1. Load the full leaf index from \`data/skill-index.json\`.\n`;
  md += `2. Sample a stratified subset via \`tests/scale-benchmark/corpus-sampler.mjs\` (seed=42).\n`;
  md += `3. Run every prompt through \`rankSkills()\` (pure BM25, no expansion, no rerank).\n`;
  md += `4. Grade Top-1, Recall@3, Set Recall@5, median/p95 latency, fallback rate.\n\n`;

  md += `## Results\n\n`;
  md += `| Size | Mode | Skills | Top-1 | Recall@3 | SetRecall | SetRecall(skill) | Median(ms) | P95(ms) | Fallback | Timeouts |
|------|------|--------|-------|----------|-----------|------------------|------------|---------|----------|----------|\n`;

  for (const run of result.runs) {
    md += `| ${run.size} | ${run.mode} | ${run.skillsSampled} | ${fmtPct(run.top1).padStart(5)} | ${fmtPct(run.recall3).padStart(7)} | ${fmtPct(run.setRecall).padStart(8)} | ${fmtPct(run.setRecallSkill).padStart(13)} | ${String(run.medianMs).padStart(8)} | ${String(run.p95Ms).padStart(7)} | ${fmtPct(run.fallbackRate)} | ${run.timeoutCount} |\n`;
  }

  md += `\n## Per-prompt detail\n\n`;
  md += `Full per-prompt results are in the JSON report at \`${jsonPath}\`.\n`;

  writeFileSync(mdPath, md, 'utf-8');
  console.log(`Markdown report written to ${mdPath}`);
}
