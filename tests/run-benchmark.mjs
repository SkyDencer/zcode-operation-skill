import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { rankSkills } from '../src/retriever.mjs';

const BASE = resolve('D:/www/local/operation-skill');
const PROMPTS_PATH = resolve(BASE, 'tests/prompts.json');
const EXPECTED_PATH = resolve(BASE, 'tests/expected-routes.json');
const INDEX_PATH = resolve(BASE, 'data/skill-index.json');
const LOGS_DIR = resolve(BASE, 'logs');
const REPORT_PATH = resolve(LOGS_DIR, 'benchmark-20260920.json');

mkdirSync(LOGS_DIR, { recursive: true });

const prompts = JSON.parse(readFileSync(PROMPTS_PATH, 'utf-8'));
const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf-8'));
const index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));

const results = [];
let top1Hits = 0;
let recallAt3Total = 0;
let latencies = [];
let noSkillCount = 0;

for (const p of prompts) {
  const start = performance.now();
  const ranked = rankSkills(p.prompt, index);
  const latency = Math.round(performance.now() - start);
  latencies.push(latency);

  const topSkill = ranked.length > 0 ? ranked[0].skill.name : null;
  const top3Skills = ranked.slice(0, 3).map((r) => r.skill.name);
  const exp = expected.find((e) => e.id === p.id)?.expected;
  const expName = typeof exp === 'string' ? exp : (typeof exp === 'object' ? exp?.expected : String(exp));

  if (topSkill === expName) top1Hits++;
  if (expName && top3Skills.includes(expName)) recallAt3Total++;
  if (!topSkill || ranked[0].score < 0.60) noSkillCount++;

  results.push({
    id: p.id,
    prompt: p.prompt,
    expected: expName,
    topSkill,
    top3: top3Skills,
    topScore: ranked.length > 0 ? ranked[0].score : 0,
    latency_ms: latency,
  });
}

const total = prompts.length;
const top1Accuracy = (top1Hits / total).toFixed(4);
const recallAt3 = (recallAt3Total / total).toFixed(4);
latencies.sort((a, b) => a - b);
const medianLatency = latencies[Math.floor(latencies.length / 2)];
const noSkillRate = (noSkillCount / total).toFixed(4);

// Print formatted table
console.log('');
console.log('='.repeat(80));
console.log('  SKILL ROUTER BENCHMARK — 2026-09-20');
console.log('='.repeat(80));
console.log('');
console.log('  Prompt                                              | Expected           | Top-1        | Score   | Lat(ms)');
console.log('  ' + '-'.repeat(76));
for (const r of results) {
  const promptShort = r.prompt.slice(0, 45);
  const match = r.expected === r.topSkill ? 'YES' : 'NO ';
  console.log(`  ${promptShort.padEnd(45)} | ${String(r.expected).padEnd(16)} | ${match.padEnd(10)} | ${r.topScore.toFixed(3).padStart(6)} | ${String(r.latency_ms).padStart(7)}`);
}
console.log('');
console.log('='.repeat(80));
console.log('  SUMMARY');
console.log('='.repeat(80));
console.log(`  Top-1 Accuracy:    ${top1Accuracy}  (${top1Hits}/${total})`);
console.log(`  Recall@3:          ${recallAt3}  (${recallAt3Total}/${total})`);
console.log(`  Median Latency:    ${medianLatency} ms`);
console.log(`  No-Skill Rate:     ${noSkillRate}  (${noSkillCount}/${total})`);
console.log('='.repeat(80));
console.log('');

// Write JSON results
const report = {
  date: '2026-09-20',
  totalPrompts: total,
  top1Accuracy: parseFloat(top1Accuracy),
  recallAt3: parseFloat(recallAt3),
  medianLatencyMs: medianLatency,
  noSkillRate: parseFloat(noSkillRate),
  results,
};
writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');
console.log(`Results written to ${REPORT_PATH}`);
