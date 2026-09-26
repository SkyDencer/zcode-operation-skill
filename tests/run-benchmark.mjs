/**
 * Benchmark suite for the Skill Router.
 *
 * Runs a set of sample prompts against the current index and reports
 * Top-1 accuracy, Recall@3, median latency, and no-skill rate.
 *
 * Usage:
 *   node tests/run-benchmark.mjs [--mode bm25|hybrid] [--rerank on|off]
 *   node tests/run-benchmark.mjs --corpus real|synthetic-100|synthetic-200|synthetic-300|synthetic-500 [options]
 *   node tests/run-benchmark.mjs --corpus real --router flat|hybrid [--provider fnv1a|onnx]
 *
 * `--router flat` is the pure-BM25 path (identical to `--mode bm25`); the two
 * spellings exist because the benchmark is quoted both ways in the reports.
 * `--provider` selects the embedding provider handed to hybridRetrieve(); it
 * is reported in the JSON output so a run cannot be mistaken for a different
 * provider than the one it names. Set Recall@5 is computed for every mode
 * (see tests/benchmark/metrics.mjs).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { rankSkills } from '../src/index.mjs';
import { hybridRetrieve } from '../src/core/retriever/hybrid.mjs';
import { QueryCache } from '../src/core/cache/query-cache.mjs';
import { buildSynonymMap } from '../src/core/retrieval/synonyms.mjs';
import { createProvider } from '../src/core/embeddings/provider.mjs';
import { now, percentile } from '../src/utils/time.mjs';
import { getDefaults } from '../src/config/defaults.mjs';
import { getConfig } from '../src/config/env.mjs';
import { loadSkillsFromDir, ensureSyntheticCorpus, SYNTHETIC_DIR } from './benchmark/corpus.mjs';
import { gradePrompt, summarizeSetRecall } from './benchmark/metrics.mjs';
import { printReport } from './benchmark/report.mjs';

const INDEX_PATH = resolve('data/skill-index.json');
const LOGS_DIR = resolve('logs');
const REPORT_DATE = now().slice(0, 10);
const REPORT_PATH = resolve(LOGS_DIR, `benchmark-${REPORT_DATE}.json`);

const BASE = resolve('.');
const PROMPTS_PATH = resolve(BASE, 'tests/prompts.json');
const EXPECTED_PATH = resolve(BASE, 'tests/expected-routes.json');

mkdirSync(LOGS_DIR, { recursive: true });

// Parse CLI args
const args = process.argv.slice(2);
/**
 * Read a `--flag value` or `--flag=value` argument.
 *
 * @param {string} name
 * @returns {string|undefined}
 */
const flagValue = (name) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
  || (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);

const routerFlag = flagValue('router');
// Router selection, then the explicit mode. `flat` is the pure-BM25 path;
// an unknown router name is rejected rather than silently measured as hybrid.
const ROUTER_TO_MODE = { flat: 'bm25', bm25: 'bm25', hybrid: 'hybrid', hierarchical: 'bm25' };
const modeFlag = routerFlag !== undefined
  ? (ROUTER_TO_MODE[routerFlag.toLowerCase()] ?? (() => {
      console.error(`Unknown router: ${routerFlag}. Use flat or hybrid.`);
      process.exit(1);
    })())
  : (flagValue('mode') ?? 'hybrid');
const rerankFlag = flagValue('rerank');
// Default matches the hook: hooks/route.mjs calls hybridRetrieve with
// `rerank: false`, so measuring hybrid *with* the reranker on would report a
// configuration production never runs.
const rerankValue = rerankFlag !== undefined ? rerankFlag : 'off';

// Corpus flag: real | synthetic-N
const corpusFlag = flagValue('corpus');

// Expand flag: --expand on|off
const expandValue = flagValue('expand') ?? 'off';

// Provider flag: --provider fnv1a|onnx (hybrid mode only)
const providerFlag = flagValue('provider');

// ── Main ─────────────────────────────────────────────────────────────────────
let index;
let corpusLabel = 'real';

try {
  if (corpusFlag) {
    const match = corpusFlag.match(/^synthetic-(\d+)$/);
    if (match) {
      const count = parseInt(match[1], 10);
      corpusLabel = `synthetic-${count}`;
      ensureSyntheticCorpus(count);
      index = loadSkillsFromDir(SYNTHETIC_DIR);
    } else if (corpusFlag === 'real') {
      corpusLabel = 'real';
      index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
    } else {
      console.error(`Unknown corpus: ${corpusFlag}. Use real or synthetic-N`);
      process.exit(1);
    }
  } else {
    // Default: use real corpus
    index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
  }
} catch (err) {
  console.error('Failed to load index:', err.message);
  process.exit(1);
}

const prompts = JSON.parse(readFileSync(PROMPTS_PATH, 'utf-8'));
const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf-8'));

const results = [];
let top1Hits = 0;
let recallAt3Total = 0;
let latencies = [];
let noSkillCount = 0;

// Choose retrieve function based on mode
const retrieveFn = modeFlag === 'hybrid' ? hybridRetrieve : rankSkills;

// Build options for hybrid mode. The relevance floor and the semantic
// weight mirror what hooks/route.mjs passes, so the measured configuration is
// the one production runs (the hook also uses a leaf-only index; the benchmark
// keeps the full index so the frozen BM25 baseline stays comparable).
const DEFAULTS = getDefaults();
// The retriever reads its weights and k from getConfig() (so the
// SKILL_ROUTER_RRF_* overrides apply); the report records the effective values
// next to the shipped ones, otherwise a run with an override in the
// environment would be filed under the shipped weights.
const EFFECTIVE = getConfig();
const rrfK = EFFECTIVE.rrf.k;
const retrieveOptions = modeFlag === 'hybrid'
  ? {
    rerank: rerankValue !== 'off',
    minBm25Score: DEFAULTS.slm.bm25MinThreshold,
  }
  : {};

// Embedding provider for hybrid mode. The named provider is constructed once
// and shared by every prompt, so a cold model load is paid a single time (and
// shows up in the first prompt's latency). Degradations are collected rather
// than printed so the report can state how often the router actually fell back.
let providerName = 'none';
/** @type {string[]} */
const degradeEvents = [];
if (modeFlag === 'hybrid' && providerFlag !== undefined) {
  const provider = createProvider(providerFlag);
  providerName = provider.name;
  retrieveOptions.provider = provider;
  retrieveOptions.onDegrade = (msg) => degradeEvents.push(msg);
} else if (modeFlag === 'hybrid') {
  providerName = 'fnv1a (default)';
}

// Build synonym map when expansion is enabled
let synonymMap;
if (expandValue === 'on' && modeFlag !== 'hybrid') {
  synonymMap = buildSynonymMap(index);
  retrieveOptions.synonymMap = synonymMap;
  console.log(`  Synonym map built: ${synonymMap.size} terms`);
}

// Query cache for benchmark (warm-up + hit tracking)
const cache = new QueryCache({ index, maxSize: 256, ttlMs: 600000 });

for (const p of prompts) {
  const start = performance.now();
  const ranked = await cache.getOrSet(p.prompt, async (query, idx) => {
    return retrieveFn(query, idx, retrieveOptions);
  });
  const latency = Math.round(performance.now() - start);
  latencies.push(latency);

  const topSkill = ranked.length > 0 ? ranked[0].skill.name : null;
  const top3Skills = ranked.slice(0, 3).map((r) => r.skill.name);
  const exp = expected.find((e) => e.id === p.id)?.expected;
  // When expected is null, topSkill must also be null for a match (no-skill prompt)
  const expName = exp === null ? null : (typeof exp === 'string' ? exp : String(exp));
  const topScore = ranked.length > 0
    ? (typeof ranked[0].score === 'number' && !Number.isNaN(ranked[0].score) ? ranked[0].score : 0)
    : 0;
  // A prompt is a no-skill prompt when nothing was returned, or when the top
  // score is below the abstention floor. Testing `ranked.length === 0` first
  // matters for hybrid mode: its scores are RRF values whose maximum
  // (1/61 = 0.0164) sits above the old 0.01 cut, so a relevance floor that
  // empties the result set would otherwise be scored as a miss.
  const isNoSkill = ranked.length === 0 || topScore < 0.01;

  if (topSkill === expName || (expName === null && isNoSkill)) top1Hits++;
  const expStr = String(exp);
  // For multi-domain prompts, check that any of the expected domain skills appear in top-3
  const isMultiDomain = expStr.startsWith('multi:');
  if (isMultiDomain) {
    const domainSkills = expStr
      .replace('multi:', '')
      .split(',')
      .map((s) => s.trim())
      .flatMap((domain) => index.filter((s) => s.domains.includes(domain)).map((s) => s.name));
    if (domainSkills.some((sn) => top3Skills.includes(sn))) recallAt3Total++;
  } else if (expName && top3Skills.includes(expName)) {
    recallAt3Total++;
  }
  if (!topSkill || (modeFlag === 'bm25' && ranked[0].score < 0.60)) noSkillCount++;

  // Set Recall@5: the decision metric for Sub-Phase 6.10. See
  // tests/benchmark/metrics.mjs for the convention (top-5 returned set,
  // negative prompts scored on the abstention decision).
  const grade = gradePrompt(
    expName,
    ranked.map((r) => r.skill.name),
    isNoSkill,
    index
  );

  results.push({
    id: p.id,
    prompt: p.prompt,
    expected: expName,
    topSkill,
    top3: top3Skills,
    topScore,
    latency_ms: latency,
    setRecall: grade.recall,
    setKind: grade.kind,
  });
}

const setSummary = summarizeSetRecall(results);

const total = prompts.length;
const top1Accuracy = (top1Hits / total).toFixed(4);
const recallAt3 = (recallAt3Total / total).toFixed(4);
latencies.sort((a, b) => a - b);
const medianLatency = latencies[Math.floor(latencies.length / 2)];
const p95Latency = percentile(latencies, 95);
const noSkillRate = (noSkillCount / total).toFixed(4);

const cacheStats = cache.getStats();

printReport({
  date: REPORT_DATE,
  corpusLabel,
  mode: modeFlag,
  provider: providerName,
  rerank: rerankValue,
  expand: expandValue,
  indexSize: index.length,
  results,
  top1: top1Accuracy,
  top1Hits,
  recallAt3,
  recallAt3Total,
  setSummary,
  medianLatency,
  p95Latency,
  noSkillRate,
  noSkillCount,
  degradeEvents,
  cacheStats,
});

// Write JSON results
const report = {
  date: REPORT_DATE,
  corpus: corpusLabel,
  mode: modeFlag,
  provider: providerName,
  rerank: rerankValue,
  expand: expandValue,
  retrieval: {
    rrfWeights: EFFECTIVE.embeddings.weights,
    rrfWeightsShipped: DEFAULTS.embeddings.weights,
    rrfK: rrfK,
    minBm25Score: modeFlag === 'hybrid' ? retrieveOptions.minBm25Score : null,
  },
  totalSkills: index.length,
  totalPrompts: total,
  top1Accuracy: parseFloat(top1Accuracy),
  recallAt3: parseFloat(recallAt3),
  setRecall: setSummary.setRecall,
  setRecallSkillPrompts: setSummary.setRecallSkillPrompts,
  negativePromptsHandled: `${setSummary.negativeHits}/${setSummary.negativePrompts}`,
  medianLatencyMs: medianLatency,
  p95LatencyMs: p95Latency,
  noSkillRate: parseFloat(noSkillRate),
  providerFallbacks: degradeEvents.length,
  cache: {
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    hitRate: cacheStats.hitRate,
    size: cacheStats.total,
  },
  results,
};
writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');
console.log(`Results written to ${REPORT_PATH}`);
