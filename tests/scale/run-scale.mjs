#!/usr/bin/env node
/**
 * run-scale.mjs — Scale benchmark runner for flat and hierarchical routing.
 *
 * For each corpus size N ∈ {50, 100, 200, 300, 500}:
 *   1. Generate N synthetic skills + N×2 synthetic prompts (deterministic seed).
 *   2. Run flat BM25 retrieval against the prompts.
 *   3. Run hierarchical (domain-first) retrieval against the prompts.
 *   4. Collect Top-1, Recall@3, median latency, p95 latency, fallback rate.
 *
 * Usage:
 *   node tests/scale/run-scale.mjs
 *
 * Writes: docs/reports/phase-3-scale-benchmark.md
 */
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  rmSync,
  statSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { rankSkills } from '../../src/index.mjs';
import { routeHierarchical } from '../../src/core/routing/hierarchical.mjs';
import { populateDomainsFromSkills } from '../../src/core/routing/domain-registry.mjs';
import { percentile } from '../../src/utils/time.mjs';

// ── Paths ─────────────────────────────────────────────────────────────────────
const BASE = resolve('.');
const GENERATOR = resolve(BASE, 'tests/scale/generate-synthetic.mjs');
const REPORTS_DIR = resolve(BASE, 'docs/reports');
const REPORT_DATE = new Date().toISOString().slice(0, 10);
const SEED = 42;
const SCALES = [50, 100, 200, 300, 500];

mkdirSync(REPORTS_DIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseFrontmatter(content) {
  const fmMatch = content.match(/^---\s*\n([\s\S]+?)\n---\s*\n?/);
  if (!fmMatch) return {};
  const body = fmMatch[1].replace(/\r/g, '');
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
  if (currentKey && currentList.length > 0) result[currentKey] = currentList;
  return result;
}

function walkSkillFiles(dir) {
  const files = [];
  function walk(d) {
    const entries = readdirSync(d, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name === 'SKILL.md') files.push(full);
    }
  }
  walk(dir);
  return files;
}

function loadSkills(dir) {
  const skills = [];
  for (const filePath of walkSkillFiles(dir)) {
    try {
      const fm = parseFrontmatter(readFileSync(filePath, 'utf-8'));
      skills.push({
        name: fm.name || 'unknown',
        description: fm.description || '',
        keywords: Array.isArray(fm.keywords) ? fm.keywords : [],
        domains: Array.isArray(fm.domains) ? fm.domains : [],
        path: filePath,
        version: fm.version || '0.1.0',
      });
    } catch {
      // skip unreadable
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

function generateCorpus(count) {
  const outDir = resolve(BASE, `data/skills-synthetic-${count}`);
  // Remove previous corpus if present so we start fresh each run
  try { rmSync(outDir, { recursive: true, force: true }); } catch {}
  const result = spawnSync('node', [GENERATOR, String(count), '--seed', String(SEED), '--out', outDir], {
    cwd: BASE,
    stdio: 'pipe',
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    throw new Error(`Generator failed for ${count} skills:\n${result.stderr}`);
  }
  return outDir;
}

function fmtPct(v) {
  return (v * 100).toFixed(1) + '%';
}

// ── Benchmark runner for a single mode ────────────────────────────────────────
/**
 * @param {'flat'|'hierarchical'} mode
 * @param {string} corpusDir
 * @param {Array} prompts
 * @param {Array} expected
 * @param {Array} skills
 * @returns {{ top1, recall3, medMs, p95Ms, fallbackRate, details }}
 */
function runMode(mode, corpusDir, prompts, expected, skills) {
  // For hierarchical mode, populate domain metadata from the synthetic skills
  if (mode === 'hierarchical') {
    populateDomainsFromSkills(skills);
  }

  let top1 = 0;
  let recall3 = 0;
  let fallback = 0;
  const latencies = [];
  const details = [];

  for (const p of prompts) {
    const t0 = performance.now();

    let ranked;
    if (mode === 'flat') {
      ranked = rankSkills(p.prompt, skills);
    } else {
      const plan = routeHierarchical(p.prompt, skills);
      ranked = plan.skills.map((s) => ({ skill: s.skill, score: s.score }));
    }

    const lat = Math.round(performance.now() - t0);
    latencies.push(lat);

    const topSkill = ranked.length > 0 ? ranked[0].skill.name : null;
    const top3Names = ranked.slice(0, 3).map((r) => r.skill.name);
    const exp = expected.find((e) => e.id === p.id)?.expected;

    if (topSkill === exp) top1++;
    if (exp && top3Names.includes(exp)) recall3++;
    // Fallback: no results or top score is near-zero (treated as "no skill found")
    const topScore = ranked.length > 0 ? (ranked[0].score ?? 0) : 0;
    if (!topSkill || topScore < 0.01) fallback++;

    details.push({
      promptId: p.id,
      promptShort: p.prompt.slice(0, 60),
      expected: exp,
      topSkill,
      topScore: Math.round(topScore * 1000) / 1000,
      latencyMs: lat,
    });
  }

  latencies.sort((a, b) => a - b);
  return {
    top1: top1 / prompts.length,
    recall3: recall3 / prompts.length,
    medMs: latencies[Math.floor(latencies.length / 2)],
    p95Ms: percentile(latencies, 95),
    fallbackRate: fallback / prompts.length,
    details,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
const allResults = [];

for (const N of SCALES) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  SCALE ${N} — generating corpus …`);
  console.log('='.repeat(70));

  const corpusDir = generateCorpus(N);
  const skills = loadSkills(corpusDir);
  const prompts = JSON.parse(readFileSync(resolve(corpusDir, 'prompts.json'), 'utf-8'));
  const expected = JSON.parse(readFileSync(resolve(corpusDir, 'expected-routes.json'), 'utf-8'));

  console.log(`  Corpus: ${skills.length} skills, ${prompts.length} prompts`);

  // Flat (BM25)
  const flat = runMode('flat', corpusDir, prompts, expected, skills);
  console.log(`  FLAT   → Top-1=${fmtPct(flat.top1)}  Recall@3=${fmtPct(flat.recall3)}  med=${flat.medMs}ms  p95=${flat.p95Ms}ms  fallback=${fmtPct(flat.fallbackRate)}`);

  // Hierarchical
  const hier = runMode('hierarchical', corpusDir, prompts, expected, skills);
  console.log(`  HIER   → Top-1=${fmtPct(hier.top1)}  Recall@3=${fmtPct(hier.recall3)}  med=${hier.medMs}ms  p95=${hier.p95Ms}ms  fallback=${fmtPct(hier.fallbackRate)}`);

  allResults.push({ N, skills: skills.length, prompts: prompts.length, flat, hierarchical: hier });
}

// ── Find inflection point (first N where Top-1 drops below 95%) ──────────────
let inflectionN = null;
for (const r of allResults) {
  if (r.flat.top1 < 0.95) {
    inflectionN = r.N;
    break;
  }
}

// ── ASCII bar chart ───────────────────────────────────────────────────────────
function asciiChart(rows, label, maxW) {
  const barW = maxW || 40;
  const lines = [];
  for (const { label: l, value: v } of rows) {
    const filled = Math.round((v / 1.0) * barW);
    lines.push(`  ${l.padEnd(8)} │${'█'.repeat(filled)}${'░'.repeat(barW - filled)}│ ${((v * 100)).toFixed(1)}%`);
  }
  return lines.join('\n');
}

// ── Build markdown report ─────────────────────────────────────────────────────
const rows = [];
for (const r of allResults) {
  rows.push({
    N: r.N,
    skills: r.skills,
    prompts: r.prompts,
    flatTop1: r.flat.top1,
    flatRecall3: r.flat.recall3,
    flatMed: r.flat.medMs,
    flatP95: r.flat.p95Ms,
    flatFallback: r.flat.fallbackRate,
    hierTop1: r.hierarchical.top1,
    hierRecall3: r.hierarchical.recall3,
    hierMed: r.hierarchical.medMs,
    hierP95: r.hierarchical.p95Ms,
    hierFallback: r.hierarchical.fallbackRate,
  });
}

const chartRows = rows.map((r) => ({ label: `N=${r.N}`, value: r.flatTop1 }));

let md = `# Phase 3 — Scale Benchmark Report

> Date: ${REPORT_DATE}
> Sub-agent: scale-benchmark-engineer
> Seed: ${SEED} (deterministic)

## Objective

Measure how flat (BM25-only) and hierarchical (domain-first) routing scale as the
skill corpus grows.  Synthetic SKILL.md manifests are generated deterministically
for each target size N, and each skill is targeted by 2 unambiguous prompts using
rotating template forms (question / imperative / noun-phrase).

## Method

| Step | Detail |
|------|--------|
| Corpus generator | \`tests/scale/generate-synthetic.mjs\` — Mulberry32 PRNG, 8 domains |
| Prompt coverage  | 2 prompts per skill, rotating form, each references the skill name directly |
| Flat mode        | \`rankSkills(prompt, index)\` — pure BM25 over all skills |
| Hierarchical mode| \`routeHierarchical(prompt, index)\` — domain detect → BM25 per domain → merge |
| Domains          | \`populateDomainsFromSkills()\` called before each hierarchical run |

## Results

### Combined table

| N (skills) | Mode | Top-1 | Recall@3 | Median ms | P95 ms | Fallback |
|-----------|------|-------|----------|-----------|--------|----------|
`;

for (const r of rows) {
  md += `| ${r.N} | flat     | ${fmtPct(r.flatTop1).padStart(5)} | ${fmtPct(r.flatRecall3).padStart(7)} | ${String(r.flatMed).padStart(5)} | ${String(r.flatP95).padStart(6)} | ${fmtPct(r.flatFallback)} |\n`;
  md += `| ${r.N} | hierarchical | ${fmtPct(r.hierTop1).padStart(5)} | ${fmtPct(r.hierRecall3).padStart(7)} | ${String(r.hierMed).padStart(5)} | ${String(r.hierP95).padStart(6)} | ${fmtPct(r.hierFallback)} |\n`;
}

md += `
### Top-1 Accuracy vs Corpus Size (BM25 flat)

\`\`\`
${asciiChart(chartRows, 'Top-1', 30)}
\`\`\`

### Top-1 Accuracy vs Corpus Size (Hierarchical)

\`\`\`
${asciiChart(rows.map((r) => ({ label: 'N=' + r.N, value: r.hierTop1 })), 'Top-1', 30)}
\`\`\`

## Key Findings

### Inflection Point

`;
if (inflectionN) {
  md += `The **inflection point** where flat BM25 Top-1 accuracy drops below 95 % is at **N = ${inflectionN}** skills.\n\n`;
} else {
  md += `Flat BM25 Top-1 remained ≥ 95 % across all tested scales (up to N=500).\n\n`;
}

md += `### Flat vs Hierarchical Comparison

| N | Flat Top-1 | Hier Top-1 | Diff (H-F) | Flat Med(ms) | Hier Med(ms) | Hier Speedup |
|--|-----------|-----------|------------|-------------|-------------|-------------|\n`;
for (const r of rows) {
  const diff = (r.hierTop1 - r.flatTop1).toFixed(4);
  const speedup = r.flatMed > 0 ? (r.flatMed / r.hierMed).toFixed(2) : '—';
  md += `| ${r.N} | ${fmtPct(r.flatTop1)} | ${fmtPct(r.hierTop1)} | ${diff.padStart(8)} | ${String(r.flatMed).padStart(10)} | ${String(r.hierMed).padStart(11)} | ${String(speedup).padStart(11)}x |\n`;
}

md += `
### Observations

`;
// Compute summary stats
const top1Diffs = rows.map((r) => r.hierTop1 - r.flatTop1);
const medSpeedups = rows.map((r) => r.flatMed / (r.hierMed || 1));

if (top1Diffs.every((d) => d > 0)) {
  md += `- Hierarchical routing **outperforms** flat BM25 on Top-1 at every scale (positive delta).\n`;
} else if (top1Diffs.every((d) => d < 0)) {
  md += `- Flat BM25 **outperforms** hierarchical routing on Top-1 at every scale (negative delta).\n`;
} else {
  md += `- Hierarchical and flat modes have **mixed** Top-1 performance depending on scale.\n`;
}

if (medSpeedups.every((s) => s > 1.5)) {
  md += `- Hierarchical routing is **consistently faster** (median latency 1.5–${Math.round(Math.max(...medSpeedups))}× speedup) because it scopes BM25 to a subset of domains.\n`;
} else if (medSpeedups.every((s) => s < 1)) {
  md += `- Hierarchical routing is **slower** due to domain detection overhead at small corpus sizes.\n`;
} else {
  md += `- Hierarchical routing latency is **comparable** to flat, with trade-offs depending on domain match quality.\n`;
}

md += `
## Benchmark Commands

\`\`\`
node tests/scale/run-scale.mjs
\`\`\`

Each scale point triggers:
1. \`node tests/scale/generate-synthetic.mjs <N> --seed 42 --out data/skills-synthetic-<N>\`
2. Flat BM25 benchmark on generated prompts
3. Hierarchical benchmark (after domain population) on same prompts
4. Aggregated results written to this file
`;

writeFileSync(resolve(REPORTS_DIR, 'phase-3-scale-benchmark.md'), md, 'utf-8');
console.log(`\nReport written to ${resolve(REPORTS_DIR, 'phase-3-scale-benchmark.md')}`);

// Print machine-readable summary for caller
for (const r of allResults) {
  console.log(`[SCALE] N=${r.N} flat_top1=${r.flat.top1.toFixed(4)} flat_recall3=${r.flat.recall3.toFixed(4)} flat_med=${r.flat.medMs} flat_p95=${r.flat.p95Ms} hier_top1=${r.hierarchical.top1.toFixed(4)} hier_recall3=${r.hierarchical.recall3.toFixed(4)} hier_med=${r.hierarchical.medMs} hier_p95=${r.hierarchical.p95Ms}`);
}
