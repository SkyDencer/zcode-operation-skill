#!/usr/bin/env node
/**
 * run-synthetic-benchmark.mjs — Benchmark the Skill Router against synthetic
 * prompts that unambiguously target generated synthetic skills.
 *
 * Usage:
 *   node tests/scale/run-synthetic-benchmark.mjs <skill-count> [--mode bm25|hybrid] [--rerank on|off]
 *
 * Examples:
 *   node tests/scale/run-synthetic-benchmark.mjs 100 --mode bm25
 *   node tests/scale/run-synthetic-benchmark.mjs 200
 *   node tests/scale/run-synthetic-benchmark.mjs 500 --mode bm25 --rerank off
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { rankSkills } from '../../src/index.mjs';
import { hybridRetrieve } from '../../src/core/retriever/hybrid.mjs';
import { QueryCache } from '../../src/core/cache/query-cache.mjs';
import { percentile } from '../../src/utils/time.mjs';

const BASE = resolve('.');
const GENERATOR_PATH = resolve(BASE, 'tests/scale/generate-synthetic.mjs');
const LOGS_DIR = resolve(BASE, 'logs');
const REPORT_DIR = resolve(BASE, 'docs/reports');
const REPORT_DATE = new Date().toISOString().slice(0, 10);

mkdirSync(LOGS_DIR, { recursive: true });
mkdirSync(REPORT_DIR, { recursive: true });

// ── Parse CLI args ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const countArg = args.find((a) => /^\d+$/.test(a));
const modeFlag = args.find((a) => a.startsWith('--mode='))?.split('=')[1]
  || (args.find((a) => a === '--mode') !== undefined ? args[args.indexOf('--mode') + 1] : undefined)
  || 'hybrid';
const rerankFlag = args.find((a) => a.startsWith('--rerank='))?.split('=')[1]
  || (args.find((a) => a === '--rerank') !== undefined ? args[args.indexOf('--rerank') + 1] : undefined);
const rerankValue = rerankFlag !== undefined ? rerankFlag : 'on';

if (!countArg) {
  console.error('Usage: node tests/scale/run-synthetic-benchmark.mjs <skill-count> [--mode bm25|hybrid] [--rerank on|off]');
  process.exit(1);
}

const skillCount = parseInt(countArg, 10);
const outDir = resolve(BASE, `data/skills-synthetic-${skillCount}`);
const promptsPath = resolve(outDir, 'prompts.json');
const expectedPath = resolve(outDir, 'expected-routes.json');

// ── Helpers ──────────────────────────────────────────────────────────────────
function parseFrontmatter(content) {
  const frontmatterRegex = /^---\s*\n([\s\S]+?)\n---\s*\n?/;
  const match = content.match(frontmatterRegex);
  if (!match) return {};
  const body = match[1].replace(/\r/g, '');
  const result = {};
  let currentKey = null;
  let currentList = [];
  for (const line of body.split('\n')) {
    const listMatch = line.match(/^\s*-\s+(.+)$/);
    if (listMatch && currentKey) {
      currentList.push(listMatch[1].trim());
      continue;
    }
    if (currentKey && currentList.length > 0) {
      result[currentKey] = currentList;
      currentList = [];
    }
    const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const value = kvMatch[2].trim();
      if (value === '') {
        currentKey = key;
        currentList = [];
      } else {
        result[key] = value;
        currentKey = null;
      }
    }
  }
  if (currentKey && currentList.length > 0) {
    result[currentKey] = currentList;
  }
  return result;
}

function* walkSkillFiles(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkSkillFiles(full);
    else if (entry.isFile() && entry.name === 'SKILL.md') yield full;
  }
}

function loadSkillsFromDir(dir) {
  const skills = [];
  for (const filePath of walkSkillFiles(dir)) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const fm = parseFrontmatter(content);
      skills.push({
        name: fm.name || 'unknown',
        description: fm.description || '',
        keywords: Array.isArray(fm.keywords) ? fm.keywords : [],
        domains: Array.isArray(fm.domains) ? fm.domains : [],
        path: filePath,
        version: fm.version || '0.1.0',
      });
    } catch (err) {
      console.warn(`[benchmark] skipped unreadable file: ${filePath} — ${err.message}`);
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

async function generateOrLoadCorpus(count, outDir) {
  const result = spawnSync('node', [GENERATOR_PATH, String(count), '--out', outDir], {
    cwd: BASE,
    stdio: 'pipe',
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    throw new Error(`Synthetic corpus generation failed:\n${result.stderr}`);
  }
  console.log(result.stdout.trim());
}

// ── Ensure corpus exists ────────────────────────────────────────────────────
if (!existsSync(promptsPath)) {
  console.log(`  Generating synthetic corpus (${skillCount} skills)...`);
  await generateOrLoadCorpus(skillCount, outDir);
}

// ── Load data ───────────────────────────────────────────────────────────────
const index = loadSkillsFromDir(outDir);
const prompts = JSON.parse(readFileSync(promptsPath, 'utf-8'));
const expected = JSON.parse(readFileSync(expectedPath, 'utf-8'));

console.log(`\n  Corpus: ${index.length} skills | ${prompts.length} prompts`);
console.log(`  Mode: ${modeFlag} | Rerank: ${rerankValue}`);

// ── Run benchmark ───────────────────────────────────────────────────────────
const retrieveFn = modeFlag === 'hybrid' ? hybridRetrieve : rankSkills;
const retrieveOptions = modeFlag === 'hybrid' ? { rerank: rerankValue !== 'off' } : {};
const cache = new QueryCache({ index, maxSize: 256, ttlMs: 600000 });

let top1Hits = 0;
let recallAt3Total = 0;
let latencies = [];
let noSkillCount = 0;
const results = [];

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
  const expName = exp === null ? null : (typeof exp === 'string' ? exp : String(exp));

  if (topSkill === expName || (expName === null && ranked.length > 0 && ranked[0].score < 0.01)) top1Hits++;
  if (expName && top3Skills.includes(expName)) recallAt3Total++;
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

// ── Output ───────────────────────────────────────────────────────────────────
console.log('');
console.log('='.repeat(80));
const label = modeFlag === 'hybrid' && rerankValue === 'off' ? 'hybrid (no-rerank)' : modeFlag;
console.log(`  SYNTHETIC BENCHMARK — ${REPORT_DATE} [corpus: synthetic-${skillCount}, mode: ${label}, rerank: ${rerankValue}]`);
console.log('='.repeat(80));
console.log(`  Index size: ${index.length} skills`);
console.log(`  Prompts: ${total}`);
console.log('');
console.log('  Prompt                                              | Expected           | Top-1        | Score   | Lat(ms)');
console.log('  ' + '-'.repeat(76));
for (const r of results) {
  const promptShort = r.prompt.slice(0, 45);
  const match = (r.expected === r.topSkill || (r.expected === null && r.topScore < 0.01)) ? 'YES' : 'NO ';
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

const cacheStats = cache.getStats();
console.log(`  Cache Hits:        ${cacheStats.hits}`);
console.log(`  Cache Misses:      ${cacheStats.misses}`);
console.log(`  Cache Hit Rate:    ${cacheStats.hitRate.toFixed(4)}`);
console.log(`  Cache Size:        ${cacheStats.total}`);
console.log('='.repeat(80));
console.log('');

// ── Write JSON report ────────────────────────────────────────────────────────
const report = {
  date: REPORT_DATE,
  corpus: `synthetic-${skillCount}`,
  mode: modeFlag,
  rerank: rerankValue,
  totalSkills: index.length,
  totalPrompts: total,
  top1Accuracy: parseFloat(top1Accuracy),
  recallAt3: parseFloat(recallAt3),
  medianLatencyMs: medianLatency,
  p95LatencyMs: p95Latency,
  noSkillRate: parseFloat(noSkillRate),
  cache: {
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    hitRate: cacheStats.hitRate,
    size: cacheStats.total,
  },
  results,
};

const reportPath = resolve(LOGS_DIR, `benchmark-synthetic-${skillCount}-${REPORT_DATE}.json`);
writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
console.log(`Results written to ${reportPath}`);

// Also print a machine-readable summary line for the caller
console.log(`\n[SCALE_RESULT] skills=${skillCount} mode=${modeFlag} top1=${top1Accuracy} recall3=${recallAt3} median_ms=${medianLatency} p95_ms=${p95Latency}`);
