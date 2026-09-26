/**
 * Regenerate telemetry fixture files for the current default embedding provider.
 *
 * Safety policy:
 *   - The hand-crafted fixture pair
 *       tests/telemetry/fixtures/outcomes-decisions.jsonl
 *       tests/telemetry/fixtures/signals-20260924.jsonl
 *     is preserved as-is when the default provider is unchanged (fnv1a).
 *     These fixtures encode a known outcome distribution (3 negative,
 *     3 positive, 1 unknown) that downstream tests depend on; overwriting
 *     them with live-benchmark output would silently break section 6 of
 *     tests/telemetry/outcomes.test.mjs.
 *   - Date-stamped copies (routing-YYYYMMDD.jsonl, signals-YYYYMMDD.jsonl)
 *     are regenerated from the live BM25 benchmark when the default differs
 *     from the last regeneration, or when called with --force.
 *
 * Current default: fnv1a (no semantic channel). Fixture signals remain valid.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankSkills } from '../src/core/retriever/bm25.mjs';
import { getDefaults } from '../src/config/defaults.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES_DIR = resolve(ROOT, 'tests', 'telemetry', 'fixtures');
const INDEX_PATH = resolve(ROOT, 'data', 'skill-index.json');
const PROMPTS_PATH = resolve(ROOT, 'tests', 'prompts.json');
const EXPECTED_PATH = resolve(ROOT, 'tests', 'expected-routes.json');

const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

// ── Helpers ────────────────────────────────────────────────────────────────────

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeJsonl(path, records) {
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
}

/**
 * Check whether the hand-crafted fixtures have the expected shape and content.
 * Returns true when the 6-decision / 4-signal structure is intact.
 */
function fixturesIntact() {
  const decisionsFile = resolve(FIXTURES_DIR, 'outcomes-decisions.jsonl');
  const signalsFile = resolve(FIXTURES_DIR, 'signals-20260924.jsonl');
  if (!existsSync(decisionsFile) || !existsSync(signalsFile)) return false;
  const decisions = readFileSync(decisionsFile, 'utf-8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  const signals = readFileSync(signalsFile, 'utf-8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  return decisions.length === 6 && signals.length === 4;
}

// ── Main ───────────────────────────────────────────────────────────────────────

const force = process.argv.includes('--force');
const defaults = getDefaults();
const provider = defaults.embeddings.provider;

console.log(`[regenerate-fixtures] provider=${provider}  today=${today}`);

// Always verify the hand-crafted fixtures are intact.
if (!force && provider === 'fnv1a' && fixturesIntact()) {
  console.log('[regenerate-fixtures] Hand-crafted fixtures are intact for fnv1a default. Skipping overwrite.');
  console.log('  outcomes-decisions.jsonl : 6 decisions (3 neg, 3 pos, 1 unk)');
  console.log('  signals-20260924.jsonl   : 4 signals (retry, override, rephrase, stale)');
  process.exit(0);
}

// Force path or provider change: regenerate date-stamped copies from the live
// benchmark.  Hand-crafted files are NOT overwritten.
console.log('[regenerate-fixtures] Regenerating date-stamped fixtures from live benchmark ...');

const index = loadJson(INDEX_PATH);
const leaf = index.filter((s) => !s.name.startsWith('router-'));
const prompts = loadJson(PROMPTS_PATH);
const expected = loadJson(EXPECTED_PATH);
const byId = new Map(expected.map((e) => [e.id, e]));

const decisions = [];
const negatives = [];
let pos = 0, neg = 0, unk = 0;

for (let i = 0; i < prompts.length; i++) {
  const p = prompts[i];
  const exp = byId.get(p.id);
  const expName = exp?.expected === null ? null : String(exp?.expected ?? '');
  const ranking = rankSkills(p.prompt, leaf);
  const topSkill = ranking.length > 0 ? ranking[0].skill.name : null;

  let outcome = 'unknown';
  if (expName === null && topSkill === null) outcome = 'positive';
  else if (topSkill === expName) outcome = 'positive';
  else if (topSkill !== null) outcome = 'negative';

  if (outcome === 'positive') pos++;
  else if (outcome === 'negative') neg++;
  else unk++;

  if (outcome === 'negative') negatives.push(i);

  const ts = new Date(Date.now() - (prompts.length - i) * 5 * 60 * 1000).toISOString();
  decisions.push({
    ts,
    mode: 'implicit',
    router: null,
    tier: topSkill ? 'bm25' : 'none',
    selectedSkills: topSkill ? [topSkill] : [],
    latencyMs: { total: Math.max(1, Math.round(Math.log2(i + 2))), bm25: Math.max(1, Math.round(Math.log2(i + 2))) },
    confidence: topSkill ? 0.85 + Math.random() * 0.1 : 0.0,
    promptHash: `sha256:${String(p.id).padStart(64, '0')}`,
    sessionId: `sess-regen-${String(i + 1).padStart(3, '0')}`,
    version: '0.2.0',
  });
}

// Generate deterministic synthetic signals for the first 30 negative outcomes.
const signalTypes = ['retry', 'explicit_override', 'rephrase'];
const signals = negatives.slice(0, 30).map((idx, si) => {
  const d = decisions[idx];
  const type = signalTypes[si % signalTypes.length];
  const ts = new Date(Date.parse(d.ts) + (2 + (si % 3)) * 60 * 1000).toISOString();
  return {
    ts,
    decisionHash: d.promptHash,
    type,
    details: type === 'retry' ? { attemptCount: 2 }
      : type === 'explicit_override' ? { previousHash: 'sha256:prev' }
      : { similarity: 0.72, previousHash: 'sha256:orig' },
  };
});

mkdirSync(FIXTURES_DIR, { recursive: true });
writeJsonl(resolve(FIXTURES_DIR, `routing-${today}.jsonl`), decisions);
writeJsonl(resolve(FIXTURES_DIR, `signals-${today}.jsonl`), signals);

console.log(`[regenerate-fixtures] Wrote ${decisions.length} decisions, ${signals.length} signals`);
console.log(`  positive=${pos}  negative=${neg}  unknown=${unk}`);
console.log(`  routing-${today}.jsonl`);
console.log(`  signals-${today}.jsonl`);
if (!fixturesIntact()) {
  console.log('  WARNING: hand-crafted fixtures were not intact; date-stamped copies written alongside.');
}
