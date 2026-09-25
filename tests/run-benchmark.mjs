/**
 * Benchmark suite for the Skill Router.
 *
 * Runs a set of sample prompts against the current index and reports
 * Top-1 accuracy, Recall@3, median latency, and no-skill rate.
 *
 * Usage:
 *   node tests/run-benchmark.mjs [--mode bm25|hybrid] [--rerank on|off]
 *   node tests/run-benchmark.mjs --corpus real|synthetic-100|synthetic-200|synthetic-300|synthetic-500 [options]
 */
import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { rankSkills } from '../src/index.mjs';
import { hybridRetrieve } from '../src/core/retriever/hybrid.mjs';
import { QueryCache } from '../src/core/cache/query-cache.mjs';
import { buildSynonymMap } from '../src/core/retrieval/synonyms.mjs';
import { now, percentile } from '../src/utils/time.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(spawn);

const BASE = resolve('.');
const PROMPTS_PATH = resolve(BASE, 'tests/prompts.json');
const EXPECTED_PATH = resolve(BASE, 'tests/expected-routes.json');
const INDEX_PATH = resolve(BASE, 'data/skill-index.json');
const LOGS_DIR = resolve(BASE, 'logs');
const REPORT_DATE = now().slice(0, 10);
const REPORT_PATH = resolve(LOGS_DIR, `benchmark-${REPORT_DATE}.json`);
const SYNTHETIC_DIR = resolve(BASE, 'data/skills-synthetic');
const GENERATOR_PATH = resolve(BASE, 'tests/scale/generate-synthetic.mjs');

mkdirSync(LOGS_DIR, { recursive: true });

// Parse CLI args
const args = process.argv.slice(2);
const modeFlag = args.find((a) => a.startsWith('--mode='))?.split('=')[1]
  || (args.find((a) => a === '--mode') !== undefined ? args[args.indexOf('--mode') + 1] : undefined)
  || 'hybrid';
const rerankFlag = args.find((a) => a.startsWith('--rerank='))?.split('=')[1]
  || (args.find((a) => a === '--rerank') !== undefined ? args[args.indexOf('--rerank') + 1] : undefined);
const rerankValue = rerankFlag !== undefined ? rerankFlag : 'on';

// Corpus flag: real | synthetic-N
const corpusFlag = args.find((a) => a.startsWith('--corpus='))?.split('=')[1]
  || (args.find((a) => a === '--corpus') !== undefined ? args[args.indexOf('--corpus') + 1] : undefined);

// Expand flag: --expand on|off
const expandFlag = args.find((a) => a.startsWith('--expand='))?.split('=')[1]
  || (args.find((a) => a === '--expand') !== undefined ? args[args.indexOf('--expand') + 1] : undefined);
const expandValue = expandFlag !== undefined ? expandFlag : 'off';

// Router flag: --router flat|hierarchical (maps to mode selection for routing tests)
const routerFlag = args.find((a) => a.startsWith('--router='))?.split('=')[1]
  || (args.find((a) => a === '--router') !== undefined ? args[args.indexOf('--router') + 1] : undefined);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse YAML-like frontmatter from a Markdown string.
 */
function parseFrontmatter(content) {
  const frontmatterRegex = /^---\s*\n([\s\S]+?)\n---\s*\n?/;
  const match = content.match(frontmatterRegex);
  if (!match) return {};

  const body = match[1].replace(/\r/g, '');
  const result = {};
  const lines = body.split('\n');
  let currentKey = null;
  let currentList = [];

  for (const line of lines) {
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

/**
 * Recursively walk a directory yielding SKILL.md file paths.
 */
function* walkSkillFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkSkillFiles(full);
    } else if (entry.isFile() && entry.name === 'SKILL.md') {
      yield full;
    }
  }
}

/**
 * Load skills from a directory.
 */
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

/**
 * Count SKILL.md files in a directory.
 */
function countSkillMdFiles(dir) {
  let count = 0;
  for (const _ of walkSkillFiles(dir)) count++;
  return count;
}

/**
 * Ensure synthetic corpus exists with the requested count.
 */
function ensureSyntheticCorpus(count) {
  const currentCount = countSkillMdFiles(SYNTHETIC_DIR);
  if (currentCount >= count) {
    console.log(`  Using existing synthetic corpus (${currentCount} skills)`);
    return;
  }
  console.log(`  Generating synthetic corpus (${count} skills)...`);
  const result = spawnSync('node', [GENERATOR_PATH, String(count)], {
    cwd: BASE,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Synthetic corpus generation failed with exit code ${result.status}`);
  }
}

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

// Build options for hybrid mode
const retrieveOptions = modeFlag === 'hybrid'
  ? { rerank: rerankValue !== 'off' }
  : {};

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

  if (topSkill === expName || (expName === null && ranked.length > 0 && ranked[0].score < 0.01)) top1Hits++;
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
const expandLabel = expandValue === 'on' ? 'expand:on' : 'expand:off';
console.log(`  SKILL ROUTER BENCHMARK — ${REPORT_DATE} [corpus: ${corpusLabel}, mode: ${label}, rerank: ${rerankValue}, expand: ${expandLabel}]`);
console.log('='.repeat(80));
console.log(`  Index size: ${index.length} skills`);
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

// Cache performance
const cacheStats = cache.getStats();
console.log(`  Cache Hits:        ${cacheStats.hits}`);
console.log(`  Cache Misses:      ${cacheStats.misses}`);
console.log(`  Cache Hit Rate:    ${cacheStats.hitRate.toFixed(4)}`);
console.log(`  Cache Size:        ${cacheStats.total}`);
console.log('='.repeat(80));
console.log('');

// Write JSON results
const report = {
  date: REPORT_DATE,
  corpus: corpusLabel,
  mode: modeFlag,
  rerank: rerankValue,
  expand: expandValue,
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
writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');
console.log(`Results written to ${REPORT_PATH}`);
