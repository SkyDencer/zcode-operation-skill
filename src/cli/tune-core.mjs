/**
 * Core tuning logic for src/cli/tune.mjs.
 *
 * Exports:
 *   loadCurrentWeights  — read data/weights.json or defaults
 *   latestSnapshot      — path to most recent snapshot in logs/weights/
 *   buildAttributions   — compute per-field attributions from benchmark data
 *   runBenchmark        — run tests/run-benchmark.mjs, return {top1, total}
 *   cmdApply            — write weights, snapshot, pre/post benchmark, auto-rollback
 *   cmdRollback         — restore from latest snapshot
 *   cmdReport           — print tuning history from logs/tuning/decisions.jsonl
 */
import { resolve } from 'node:path';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  appendFileSync,
  unlinkSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { rankSkills } from '../core/retriever/bm25.mjs';
import { attributeOutcome } from '../core/retriever/attribution.mjs';
import { computeWeights } from '../core/retriever/weights.mjs';
import { getDefaults } from '../config/defaults.mjs';
import { checkSafety, evaluateOutcome } from './tune-guard.mjs';

const ROOT = resolve('.');
const WEIGHTS_PATH = resolve(ROOT, 'data', 'weights.json');
const SNAPSHOT_DIR = resolve(ROOT, 'logs', 'weights');
const DECISIONS_LOG = resolve(ROOT, 'logs', 'tuning', 'decisions.jsonl');
const INDEX_PATH = resolve(ROOT, 'data', 'skill-index.json');
const PROMPTS_PATH = resolve(ROOT, 'tests', 'prompts.json');
const EXPECTED_PATH = resolve(ROOT, 'tests', 'expected-routes.json');

// ── Color helpers ──────────────────────────────────────────────────────────────

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
function green(msg) { return `${GREEN}${msg}${RESET}`; }
function red(msg) { return `${RED}${msg}${RESET}`; }
function yellow(msg) { return `${YELLOW}${msg}${RESET}`; }
function bold(msg) { return `${BOLD}${msg}${RESET}`; }

// ── Exported helpers ───────────────────────────────────────────────────────────

/**
 * Load current weights from data/weights.json or fall back to defaults.
 */
export function loadCurrentWeights() {
  try {
    if (existsSync(WEIGHTS_PATH)) {
      const data = JSON.parse(readFileSync(WEIGHTS_PATH, 'utf-8'));
      if (typeof data.name === 'number' && typeof data.description === 'number' && typeof data.keywords === 'number') {
        return { name: data.name, description: data.description, keywords: data.keywords };
      }
    }
  } catch { /* fall through */ }
  const d = getDefaults();
  return { name: d.bm25.nameWeight, description: d.bm25.descriptionWeight, keywords: d.bm25.keywordWeight };
}

/**
 * Get the latest snapshot path from logs/weights/.
 */
export function latestSnapshot() {
  try {
    if (!existsSync(SNAPSHOT_DIR)) return null;
    const files = readdirSync(SNAPSHOT_DIR)
      .filter((f) => f.startsWith('weights-') && f.endsWith('.json'))
      .sort();
    return files.length > 0 ? resolve(SNAPSHOT_DIR, files[files.length - 1]) : null;
  } catch { return null; }
}

/**
 * Compute attributions from the benchmark dataset.
 *
 * Runs rankSkills on each benchmark prompt, classifies outcome based on
 * Top-1 match against expected route, then attributes to the dominant BM25
 * field. Returns attributions suitable for computeWeights().
 *
 * @param {number} [maxSamples] — max number of prompts to process (default 130)
 * @returns {{ attributions: Array, counts: {positive:number, negative:number, unknown:number}, dominantCounts: {name:number, description:number, keywords:number} }}
 */
export function buildAttributions(maxSamples = 130) {
  let index, prompts, expected;
  try {
    index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
    prompts = JSON.parse(readFileSync(PROMPTS_PATH, 'utf-8'));
    expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf-8'));
  } catch {
    return { attributions: [], counts: { positive: 0, negative: 0, unknown: 0 }, dominantCounts: { name: 0, description: 0, keywords: 0 } };
  }

  const leaf = index.filter((s) => !s.name.startsWith('router-'));
  if (leaf.length === 0) {
    return { attributions: [], counts: { positive: 0, negative: 0, unknown: 0 }, dominantCounts: { name: 0, description: 0, keywords: 0 } };
  }

  const samples = prompts.slice(0, maxSamples);
  const attributions = [];
  let positive = 0, negative = 0, unknown = 0;

  for (const p of samples) {
    const ranking = rankSkills(p.prompt, leaf);
    const topSkill = ranking.length > 0 ? ranking[0].skill.name : null;
    const expEntry = expected.find((e) => e.id === p.id);
    const expName = expEntry?.expected === null ? null : String(expEntry?.expected ?? '');

    let outcome = 'unknown';
    if (expName === null && topSkill === null) {
      outcome = 'positive';
    } else if (topSkill === expName) {
      outcome = 'positive';
    } else if (topSkill !== null) {
      outcome = 'negative';
    }

    if (outcome === 'positive') positive++;
    else if (outcome === 'negative') negative++;
    else unknown++;

    const attr = attributeOutcome(
      { prompt: p.prompt, promptHash: `sha256:${p.id}`, selectedSkills: topSkill ? [topSkill] : [] },
      outcome,
      leaf
    );
    if (attr) attributions.push(attr);
  }

  const dominantCounts = attributions.reduce(
    (acc, a) => { if (a.dominantField) acc[a.dominantField]++; return acc; },
    { name: 0, description: 0, keywords: 0 }
  );

  return { attributions, counts: { positive, negative, unknown }, dominantCounts };
}

/**
 * Run the BM25 benchmark and extract Top-1 accuracy (percentage).
 */
export function runBenchmark() {
  const benchScript = resolve(ROOT, 'tests', 'run-benchmark.mjs');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [benchScript, '--mode', 'bm25'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; })
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`benchmark exited ${code}: ${stderr.trim().slice(0, 200)}`));
        return;
      }
      const match = stdout.match(/Top-1 Accuracy:\s+([\d.]+)\s+\((\d+)\/(\d+)\)/);
      if (match) {
        resolve({ top1: parseFloat(match[1]), total: parseInt(match[2], 10) });
      } else {
        reject(new Error('could not parse benchmark output'));
      }
    });
    child.on('error', reject);
  });
}

/**
 * Log a tuning decision to logs/tuning/decisions.jsonl.
 */
export function logTuningDecision(record) {
  try {
    mkdirSync(resolve(ROOT, 'logs', 'tuning'), { recursive: true });
    appendFileSync(DECISIONS_LOG, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n', 'utf-8');
  } catch { /* fail silently */ }
}

// ── Subcommand implementations ────────────────────────────────────────────────

/**
 * --apply core logic.
 */
export async function cmdApply(opts) {
  const threshold = opts.threshold ?? 20;
  const dryRun = opts.dryRun ?? false;

  const currentWeights = loadCurrentWeights();
  const { attributions, counts } = buildAttributions(130);
  const weightUpdate = computeWeights(attributions, currentWeights, { minOutcomes: threshold });

  const proposedWeights = weightUpdate.changed ? weightUpdate.newWeights : currentWeights;
  const baseline = (await import('./tune-guard.mjs')).loadBaseline();
  const guard = checkSafety(proposedWeights, baseline);

  if (dryRun) {
    console.log('');
    console.log(bold('Dry-run mode — no changes applied'));
    console.log('-'.repeat(50));
    console.log(`Current weights  : ${JSON.stringify(currentWeights)}`);
    console.log(`Proposed weights : ${JSON.stringify(proposedWeights)}`);
    console.log(`Attributions     : ${attributions.length} (pos: ${counts.positive}, neg: ${counts.negative})`);
    console.log(`Guardrail        : ${guard.action} — ${guard.reason}`);
    if (guard.action === 'refuse') {
      console.log(red('  → Changes would be blocked by guardrail in live mode.'));
    }
    console.log('');
    return;
  }

  if (guard.action === 'refuse') {
    console.error(red(`Guardrail refused: ${guard.reason}`));
    process.exit(1);
  }
  if (guard.action === 'revert') {
    console.warn(yellow(`Guardrail suggests revert: ${guard.reason}`));
    console.log('No changes applied.');
    return;
  }

  // Snapshot current weights
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
  const snapshotPath = resolve(SNAPSHOT_DIR, `weights-${ts}.json`);
  writeFileSync(snapshotPath, JSON.stringify({ ...currentWeights, snapshotAt: new Date().toISOString() }, null, 2), 'utf-8');

  // Pre-benchmark
  console.log('Running pre-benchmark...');
  let beforeResult;
  try {
    beforeResult = await runBenchmark();
    console.log(`  Before Top-1: ${beforeResult.top1}% (${beforeResult.total}/130)`);
  } catch (err) {
    console.error(red(`Pre-benchmark failed: ${err.message}`));
    try { if (existsSync(snapshotPath)) unlinkSync(snapshotPath); } catch {}
    process.exit(1);
  }

  // Write new weights
  writeFileSync(WEIGHTS_PATH, JSON.stringify(proposedWeights, null, 2), 'utf-8');
  console.log(`Wrote ${WEIGHTS_PATH}`);

  // Post-benchmark
  console.log('Running post-benchmark...');
  let afterResult;
  try {
    afterResult = await runBenchmark();
    console.log(`  After Top-1: ${afterResult.top1}% (${afterResult.total}/130)`);
  } catch (err) {
    console.error(red(`Post-benchmark failed: ${err.message}`));
    writeFileSync(WEIGHTS_PATH, JSON.stringify(currentWeights, null, 2), 'utf-8');
    console.warn(yellow('Rolled back to previous weights'));
    logTuningDecision({ before: { top1: beforeResult.top1, weights: currentWeights }, after: null, outcome: 'error', reason: err.message });
    process.exit(1);
  }

  // Evaluate
  const { outcome, reason } = evaluateOutcome(beforeResult.top1, afterResult.top1);
  if (outcome === 'reverted') {
    writeFileSync(WEIGHTS_PATH, JSON.stringify(currentWeights, null, 2), 'utf-8');
    console.error(red(`Rolling back: ${reason}`));
    logTuningDecision({
      before: { top1: beforeResult.top1, weights: currentWeights },
      after: { top1: afterResult.top1, weights: proposedWeights },
      outcome: 'reverted', reason,
    });
    process.exit(0);
  }

  console.log(green(`Applied: ${reason}`));
  logTuningDecision({
    before: { top1: beforeResult.top1, weights: currentWeights },
    after: { top1: afterResult.top1, weights: proposedWeights },
    outcome: 'accepted', reason,
  });
  console.log('');
}

/**
 * --rollback core logic.
 */
export function cmdRollback() {
  const snapshotPath = latestSnapshot();
  if (!snapshotPath) {
    console.log('No snapshots found in logs/weights/. Nothing to rollback.');
    process.exit(1);
  }
  try {
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
    const weights = { name: snapshot.name, description: snapshot.description, keywords: snapshot.keywords };
    writeFileSync(WEIGHTS_PATH, JSON.stringify(weights, null, 2), 'utf-8');
    console.log(green(`Rolled back to weights from ${snapshot.snapshotAt || snapshotPath}`));
    console.log(`  name         : ${weights.name}`);
    console.log(`  description  : ${weights.description}`);
    console.log(`  keywords     : ${weights.keywords}`);
  } catch (err) {
    console.error(red(`Failed to read snapshot: ${err.message}`));
    process.exit(1);
  }
}

/**
 * --report core logic.
 */
export function cmdReport() {
  try {
    if (!existsSync(DECISIONS_LOG)) { console.log('No tuning decisions logged yet.'); return; }
    const content = readFileSync(DECISIONS_LOG, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    if (lines.length === 0) { console.log('No tuning decisions logged yet.'); return; }

    const records = lines.map((l) => JSON.parse(l)).filter((r) => r.outcome);
    const accepted = records.filter((r) => r.outcome === 'accepted').length;
    const reverted = records.filter((r) => r.outcome === 'reverted').length;
    const errors = records.filter((r) => r.outcome === 'error').length;

    console.log('');
    console.log(bold('Tuning History Report'));
    console.log('='.repeat(50));
    console.log(`Total attempts : ${records.length}`);
    console.log(`  ${green('Accepted')}  : ${accepted}`);
    console.log(`  ${red('Reverted')}  : ${reverted}`);
    console.log(`  ${yellow('Error')}   : ${errors}`);
    console.log('');

    if (records.length > 0) {
      console.log(bold('Last 5 Attempts'));
      console.log('-'.repeat(50));
      for (const r of records.slice(-5).reverse()) {
        const ts = r.ts?.slice(0, 19) || 'unknown';
        const status = r.outcome === 'accepted' ? green(r.outcome)
          : r.outcome === 'reverted' ? red(r.outcome) : yellow(r.outcome);
        console.log(`  ${ts}  ${status.padEnd(10)}  before=${r.before?.top1 ?? '?'}%  after=${r.after?.top1 ?? '?'}%  ${r.reason || ''}`);
      }
    }
    console.log('');
  } catch (err) {
    console.error(red(`Failed to read tuning log: ${err.message}`));
  }
}
