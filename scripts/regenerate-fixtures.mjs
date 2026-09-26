/**
 * Regenerate the adaptation-loop telemetry fixtures for the CURRENT default
 * retrieval configuration.
 *
 * Phase 5 built the adaptive feedback loop (decision -> signal -> outcome ->
 * attribution -> weight update) against FNV-1a embeddings. Sub-phase 6
 * replaced the embedding backend behind `embeddings.provider` and re-froze the
 * shipped RRF weights. This script re-derives the fixtures the loop is
 * exercised against, so a provider or weight change cannot silently leave the
 * loop validated against a stale corpus.
 *
 * What it does
 *   1. Resolves the provider exactly as the hook does (resolveProvider() +
 *      getConfig(), so SKILL_ROUTER_* overrides are honoured).
 *   2. Replays the 130-prompt real corpus through the hook's default implicit
 *      path: leaf-only index (hooks/route.mjs:139) and
 *      hybridRetrieve({ provider, rerank: false, minBm25Score }) with the
 *      relevance floor from slm.bm25MinThreshold, degrading to floored
 *      rankSkills() when no provider is usable.
 *   3. Emits log-shaped decision + signal records plus a manifest recording
 *      the configuration they were produced under.
 *
 * Determinism
 *   Timestamps are anchored to a fixed epoch and every field is derived from
 *   the retrieval result -- there is no Math.random(). Re-running with the
 *   same index, weights and provider reproduces byte-identical fixtures, so
 *   `--check` can gate on it.
 *
 * Privacy
 *   Records carry no raw prompt text (the hook never logs it). The corpus id
 *   is stored instead so tests can recover the prompt from tests/prompts.json,
 *   which is what attribution.mjs needs.
 *
 * The hand-crafted fixture pair asserted by tests/telemetry/outcomes.test.mjs
 * (outcomes-decisions.jsonl, signals-20260924.jsonl) encodes a fixed
 * positive/negative/unknown distribution and is never overwritten.
 *
 * Usage
 *   node scripts/regenerate-fixtures.mjs           regenerate the fixtures
 *   node scripts/regenerate-fixtures.mjs --check   fail if they are stale
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../src/config/env.mjs';
import { resolveProvider } from '../src/core/embeddings/resolve.mjs';
import { hybridRetrieve } from '../src/core/retriever/hybrid.mjs';
import { rankSkills } from '../src/core/retriever/bm25.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = resolve(ROOT, 'data', 'skill-index.json');
const PROMPTS_PATH = resolve(ROOT, 'tests', 'prompts.json');
const EXPECTED_PATH = resolve(ROOT, 'tests', 'expected-routes.json');
const OUT_DIR = resolve(ROOT, 'tests', 'telemetry', 'fixtures', 'regen');

/** Fixed anchor so regenerating under one config is byte-stable. */
const FIXTURE_EPOCH = Date.parse('2026-09-26T00:00:00.000Z');
/** Spacing between consecutive decisions, in ms. */
const DECISION_STRIDE_MS = 30_000;

const HAND_CRAFTED = ['outcomes-decisions.jsonl', 'signals-20260924.jsonl'];

/**
 * @param {string} path
 * @returns {any}
 */
function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * @param {string} path
 * @param {object[]} records
 */
function writeJsonl(path, records) {
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
}

/**
 * Run one prompt through the hook's default implicit retrieval path.
 *
 * @param {string} prompt
 * @param {object[]} leaf
 * @param {object|null} provider
 * @param {number} minBm25Score
 * @returns {Promise<{selected: object[], topSkill: string|null, confidence: number}>}
 */
async function retrieve(prompt, leaf, provider, minBm25Score) {
  let ranked;
  if (provider) {
    ranked = await hybridRetrieve(prompt, leaf, { provider, rerank: false, minBm25Score });
  } else {
    ranked = rankSkills(prompt, leaf).filter((r) => r.score >= minBm25Score);
  }
  return {
    selected: ranked.map((r) => r.skill.name),
    topSkill: ranked.length > 0 ? ranked[0].skill.name : null,
    confidence: ranked.length > 0 ? (ranked[0].bm25Score ?? ranked[0].score ?? 0) : 0,
  };
}

/**
 * Deterministic corrective-signal type for the nth miss.
 * @param {number} n
 * @returns {{type: string, offsetMs: number, details: object}}
 */
function correctiveSignal(n) {
  const table = [
    { type: 'retry', offsetMs: 90_000, details: { attemptCount: 2 } },
    { type: 'rephrase', offsetMs: 120_000, details: { similarity: 0.72 } },
    { type: 'explicit_override', offsetMs: 150_000, details: { previousHash: 'sha256:regen-override' } },
  ];
  return table[n % table.length];
}

// ── Main ──────────────────────────────────────────────────────────────────────

const config = getConfig();
const resolution = resolveProvider(config, { onWarn: () => {} });
const provider = resolution.provider;
const minBm25Score = config.slm?.bm25MinThreshold ?? 0.35;
const weights = config.embeddings?.weights ?? { bm25: 1, semantic: 0 };

const index = loadJson(INDEX_PATH);
const leaf = index.filter((s) => !s.name.startsWith('router-'));
const prompts = loadJson(PROMPTS_PATH);
const expectedById = new Map(loadJson(EXPECTED_PATH).map((e) => [e.id, e.expected]));

console.log(`[regenerate-fixtures] provider requested=${resolution.requested} used=${resolution.used}` +
  (resolution.fellBack ? ' (fell back)' : ''));
console.log(`[regenerate-fixtures] rrf weights bm25=${weights.bm25} semantic=${weights.semantic}` +
  `  floor=${minBm25Score}  index=${index.length} (leaf ${leaf.length})  prompts=${prompts.length}`);

const decisions = [];
const signals = [];
let positive = 0;
let negative = 0;
let correct = 0;
let miss = 0;
const started = Date.now();

for (let i = 0; i < prompts.length; i++) {
  const p = prompts[i];
  const ts = new Date(FIXTURE_EPOCH + i * DECISION_STRIDE_MS).toISOString();
  const result = await retrieve(p.prompt, leaf, provider, minBm25Score);
  const expected = expectedById.get(p.id) ?? null;
  const isCorrect = expected === null ? result.topSkill === null : result.topSkill === expected;

  const promptHash = `sha256:regen${String(p.id).padStart(58, '0')}`;
  decisions.push({
    ts,
    mode: 'implicit',
    router: null,
    tier: result.topSkill === null ? 'none' : 'bm25',
    selectedSkills: result.selected,
    latencyMs: { total: 1, bm25: 1 },
    confidence: Number(result.confidence.toFixed(6)),
    promptHash,
    sessionId: `sess-regen-${String(i + 1).padStart(3, '0')}`,
    version: '0.2.0',
    corpusId: p.id,
  });

  if (isCorrect) {
    correct++;
    positive++;
  } else {
    miss++;
    negative++;
    const sig = correctiveSignal(negative - 1);
    signals.push({
      ts: new Date(Date.parse(ts) + sig.offsetMs).toISOString(),
      decisionHash: promptHash,
      type: sig.type,
      details: sig.details,
    });
  }
}

const manifest = {
  generatedBy: 'scripts/regenerate-fixtures.mjs',
  fixtureEpoch: new Date(FIXTURE_EPOCH).toISOString(),
  provider: { requested: resolution.requested, used: resolution.used, fellBack: resolution.fellBack },
  rrfWeights: { bm25: weights.bm25, semantic: weights.semantic },
  minBm25Score,
  indexSize: index.length,
  leafIndexSize: leaf.length,
  promptCount: prompts.length,
  top1: Number((correct / prompts.length).toFixed(4)),
  counts: { correct, miss, positive, negative, signals: signals.length },
  replay: 'per-decision fixed clock: now = first corrective signal ts, else decision ts + 60s',
  handCrafted: HAND_CRAFTED,
};

const check = process.argv.includes('--check');
mkdirSync(OUT_DIR, { recursive: true });
const decisionsPath = resolve(OUT_DIR, 'routing.jsonl');
const signalsPath = resolve(OUT_DIR, 'signals.jsonl');
const manifestPath = resolve(OUT_DIR, 'manifest.json');

if (check) {
  let stale_ = false;
  for (const [label, path, expectedContent] of [
    ['routing.jsonl', decisionsPath, decisions.map((r) => JSON.stringify(r)).join('\n') + '\n'],
    ['signals.jsonl', signalsPath, signals.map((r) => JSON.stringify(r)).join('\n') + '\n'],
    ['manifest.json', manifestPath, JSON.stringify(manifest, null, 2) + '\n'],
  ]) {
    if (!existsSync(path)) {
      console.error(`[regenerate-fixtures] STALE: ${label} is missing`);
      stale_ = true;
      continue;
    }
    const actual = readFileSync(path, 'utf-8');
    if (actual !== expectedContent) {
      console.error(`[regenerate-fixtures] STALE: ${label} does not match the current default configuration`);
      stale_ = true;
    }
  }
  if (stale_) {
    console.error('[regenerate-fixtures] Run: node scripts/regenerate-fixtures.mjs');
    process.exit(1);
  }
  console.log('[regenerate-fixtures] Fixtures are current for this configuration.');
  process.exit(0);
}

writeJsonl(decisionsPath, decisions);
writeJsonl(signalsPath, signals);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

console.log(`[regenerate-fixtures] wrote ${decisions.length} decisions, ${signals.length} signals in ${Date.now() - started} ms`);
console.log(`  correct=${correct}  miss=${miss}  top1=${manifest.top1}`);
console.log(`  ${decisionsPath}`);
console.log(`  ${signalsPath}`);
console.log(`  ${manifestPath}`);
console.log('  hand-crafted fixtures preserved: ' + HAND_CRAFTED.join(', '));
