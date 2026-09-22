/**
 * Benchmark suite for the Skill Router.
 *
 * Runs a set of sample prompts against the current index and reports
 * Top-1 accuracy, Recall@3, median latency, and no-skill rate.
 *
 * Usage:
 *   node tests/run-benchmark.mjs [--mode bm25|hybrid] [--rerank on|off]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { rankSkills } from '../src/index.mjs';
import { hybridRetrieve } from '../src/core/retriever/hybrid.mjs';
import { now, percentile } from '../src/utils/time.mjs';

const BASE = resolve('.');
const PROMPTS_PATH = resolve(BASE, 'tests/prompts.json');
const EXPECTED_PATH = resolve(BASE, 'tests/expected-routes.json');
const INDEX_PATH = resolve(BASE, 'data/skill-index.json');
const LOGS_DIR = resolve(BASE, 'logs');
const REPORT_DATE = now().slice(0, 10);
const REPORT_PATH = resolve(LOGS_DIR, `benchmark-${REPORT_DATE}.json`);

mkdirSync(LOGS_DIR, { recursive: true });

// Parse CLI args
const args = process.argv.slice(2);
const modeFlag = args.find((a) => a.startsWith('--mode='))?.split('=')[1]
  || (args.find((a) => a === '--mode') !== undefined ? args[args.indexOf('--mode') + 1] : undefined)
  || 'hybrid';
const rerankFlag = args.find((a) => a.startsWith('--rerank='))?.split('=')[1]
  || (args.find((a) => a === '--rerank') !== undefined ? args[args.indexOf('--rerank') + 1] : undefined);
const rerankValue = rerankFlag !== undefined ? rerankFlag : 'on';

const prompts = JSON.parse(readFileSync(PROMPTS_PATH, 'utf-8'));
const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf-8'));
const index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));

const results = [];
let top1Hits = 0;
let recallAt3Total = 0;
let latencies = [];
let noSkillCount = 0;

// Choose retrieve function based on mode
const retrieveFn = modeFlag === 'hybrid' ? hybridRetrieve : rankSkills;

// Build options for hybrid mode
const retrieveOptions = modeFlag === 'hybrid'
  ? { rerank: rerankValue !== 'off' }
  : {};

for (const p of prompts) {
  const start = performance.now();
  const ranked = retrieveFn(p.prompt, index, retrieveOptions);
  const latency = Math.round(performance.now() - start);
  latencies.push(latency);

  const topSkill = ranked.length > 0 ? ranked[0].skill.name : null;
  const top3Skills = ranked.slice(0, 3).map((r) => r.skill.name);
  const exp = expected.find((e) => e.id === p.id)?.expected;
  // When expected is null, topSkill must also be null for a match (no-skill prompt)
  const expName = exp === null ? null : (typeof exp === 'string' ? exp : String(exp));

  if (topSkill === expName) top1Hits++;
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

  results.push({
    id: p.id,
    prompt: p.prompt,
    expected: expName,
    topSkill,
    top3: top3Skills,
    topScore: ranked.length > 0 ? (typeof ranked[0].score === 'number' && !Number.isNaN(ranked[0].score) ? ranked[0].score : 0) : 0,
    latency_ms: latency,
  });
}

const total = prompts.length;
const top1Accuracy = (top1Hits / total).toFixed(4);
const recallAt3 = (recallAt3Total / total).toFixed(4);
latencies.sort((a, b) => a - b);
const medianLatency = latencies[Math.floor(latencies.length / 2)];
const p95Latency = percentile(latencies, 95);
const noSkillRate = (noSkillCount / total).toFixed(4);

// Print formatted table
console.log('');
console.log('='.repeat(80));
const label = modeFlag === 'hybrid' && rerankValue === 'off' ? 'hybrid (no-rerank)' : modeFlag;
console.log(`  SKILL ROUTER BENCHMARK — ${REPORT_DATE} [mode: ${label}, rerank: ${rerankValue}]`);
console.log('='.repeat(80));
console.log('');
console.log('  Prompt                                              | Expected           | Top-1        | Score   | Lat(ms)');
console.log('  ' + '-'.repeat(76));
for (const r of results) {
  const promptShort = r.prompt.slice(0, 45);
  const match = r.expected === r.topSkill ? 'YES' : 'NO ';
  console.log(
    `  ${promptShort.padEnd(45)} | ${String(r.expected).padEnd(16)} | ${match.padEnd(10)} | ${r.topScore.toFixed(3).padStart(6)} | ${String(r.latency_ms).padStart(7)}`
  );
}
console.log('');
console.log('='.repeat(80));
console.log('  SUMMARY');
console.log('='.repeat(80));
console.log(`  Top-1 Accuracy:    ${top1Accuracy}  (${top1Hits}/${total})`);
console.log(`  Recall@3:          ${recallAt3}  (${recallAt3Total}/${total})`);
console.log(`  Median Latency:    ${medianLatency} ms`);
console.log(`  P95 Latency:       ${p95Latency} ms`);
console.log(`  No-Skill Rate:     ${noSkillRate}  (${noSkillCount}/${total})`);
console.log('='.repeat(80));
console.log('');

// Write JSON results
const report = {
  date: REPORT_DATE,
  mode: modeFlag,
  rerank: rerankValue,
  totalPrompts: total,
  top1Accuracy: parseFloat(top1Accuracy),
  recallAt3: parseFloat(recallAt3),
  medianLatencyMs: medianLatency,
  p95LatencyMs: p95Latency,
  noSkillRate: parseFloat(noSkillRate),
  results,
};
writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');
console.log(`Results written to ${REPORT_PATH}`);
