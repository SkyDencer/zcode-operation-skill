/**
 * Adaptation-loop fixture revalidation (Sub-Phase 6.11).
 *
 * The adaptive feedback loop was built in Phase 5 against FNV-1a embeddings.
 * Sub-Phase 6 swapped the backend behind `embeddings.provider` and re-froze
 * the RRF weights, so the loop has to be re-proven against the corpus the
 * *current* default actually produces.
 *
 * Verifies:
 *   1. The hand-crafted fixture pair asserted by tests/telemetry/outcomes.test.mjs
 *      is still intact (6 decisions / 4 signals).
 *   2. The regenerated fixture manifest still describes the live default
 *      (provider, RRF weights, relevance floor, index sizes, prompt count) --
 *      this is the drift gate. Changing the default provider or the shipped
 *      weights without regenerating makes this fail.
 *   3. `scripts/regenerate-fixtures.mjs --check` exits 0, i.e. the committed
 *      fixtures are byte-reproducible from the current configuration.
 *   4. The full loop runs end to end over the regenerated fixtures with a
 *      fixed clock: correlate -> attributeOutcome -> computeWeights ->
 *      checkSafety, and still lands on the same proposal and the same
 *      MAX_DELTA guardrail refusal that `tune --analyze` reports.
 *
 * The `unknown` outcome class is deliberately absent from the regenerated
 * fixture: it needs a live clock (a stale signal) and is covered by the
 * hand-crafted pair and tests/telemetry/outcomes.test.mjs section 5.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getConfig } from '../../src/config/env.mjs';
import { correlate } from '../../src/telemetry/outcomes.mjs';
import { attributeOutcome } from '../../src/core/retriever/attribution.mjs';
import { computeWeights } from '../../src/core/retriever/weights.mjs';
import { loadBaseline, checkSafety } from '../../src/cli/tune-guard.mjs';
import { buildAttributions } from '../../src/cli/tune-core.mjs';

const BASE = resolve('.');
const FIXTURES = resolve(BASE, 'tests/telemetry/fixtures');
const REGEN = resolve(FIXTURES, 'regen');
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log('  ✓', message);
  } else {
    failed++;
    console.error('  ✗', message);
  }
}

function readJsonl(path) {
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

console.log('\n=== Adaptation Fixture Revalidation Tests ===\n');

// ─── 1. Hand-crafted fixtures preserved ──────────────────────────────────────
console.log('1. Hand-crafted fixtures preserved');
const handDecisions = readJsonl(resolve(FIXTURES, 'outcomes-decisions.jsonl'));
const handSignals = readJsonl(resolve(FIXTURES, 'signals-20260924.jsonl'));
assert(handDecisions.length === 6, `outcomes-decisions.jsonl still has 6 decisions, got ${handDecisions.length}`);
assert(handSignals.length === 4, `signals-20260924.jsonl still has 4 signals, got ${handSignals.length}`);
assert(
  handDecisions.every((d) => d.prompt === undefined),
  'hand-crafted decisions carry no raw prompt text'
);

// ─── 2. Manifest describes the live default ──────────────────────────────────
console.log('\n2. Regenerated manifest matches the live default configuration');
assert(existsSync(resolve(REGEN, 'manifest.json')), 'tests/telemetry/fixtures/regen/manifest.json exists');
const manifest = JSON.parse(readFileSync(resolve(REGEN, 'manifest.json'), 'utf-8'));
const config = getConfig();
const liveWeights = config.embeddings.weights;

assert(
  manifest.provider.used === config.embeddings.provider,
  `manifest provider "${manifest.provider.used}" matches default "${config.embeddings.provider}"`
);
assert(
  manifest.rrfWeights.bm25 === liveWeights.bm25 && manifest.rrfWeights.semantic === liveWeights.semantic,
  `manifest RRF weights ${JSON.stringify(manifest.rrfWeights)} match live ${JSON.stringify(liveWeights)}`
);
assert(
  manifest.minBm25Score === (config.slm.bm25MinThreshold ?? 0.35),
  `manifest relevance floor ${manifest.minBm25Score} matches slm.bm25MinThreshold`
);

const index = JSON.parse(readFileSync(resolve(BASE, 'data/skill-index.json'), 'utf-8'));
const leaf = index.filter((s) => !s.name.startsWith('router-'));
assert(manifest.indexSize === index.length, `manifest indexSize ${manifest.indexSize} matches index ${index.length}`);
assert(manifest.leafIndexSize === leaf.length, `manifest leafIndexSize ${manifest.leafIndexSize} matches leaf corpus ${leaf.length}`);
const prompts = JSON.parse(readFileSync(resolve(BASE, 'tests/prompts.json'), 'utf-8'));
assert(manifest.promptCount === prompts.length, `manifest promptCount ${manifest.promptCount} matches corpus ${prompts.length}`);

const decisions = readJsonl(resolve(REGEN, 'routing.jsonl'));
const signals = readJsonl(resolve(REGEN, 'signals.jsonl'));
assert(decisions.length === manifest.promptCount, `routing.jsonl has one decision per prompt (${decisions.length})`);
assert(decisions.every((d) => d.prompt === undefined), 'regenerated decisions carry no raw prompt text');
assert(decisions.every((d) => typeof d.corpusId === 'number'), 'regenerated decisions reference the corpus by id');

// ─── 3. Fixtures are reproducible ────────────────────────────────────────────
console.log('\n3. `regenerate-fixtures.mjs --check` reports the fixtures are current');
const check = spawnSync(process.execPath, [resolve(BASE, 'scripts/regenerate-fixtures.mjs'), '--check'], {
  cwd: BASE,
  encoding: 'utf-8',
});
assert(check.status === 0, `--check exits 0 (got ${check.status}): ${(check.stderr || check.stdout || '').trim().slice(0, 200)}`);

// ─── 4. Full adaptation loop over the regenerated fixtures ────────────────────
console.log('\n4. Full adaptation loop over the regenerated fixtures (fixed clock)');
const firstSignalByHash = new Map();
for (const s of signals) {
  if (!firstSignalByHash.has(s.decisionHash)) firstSignalByHash.set(s.decisionHash, s);
}
const promptById = new Map(prompts.map((p) => [p.id, p]));

const counts = { positive: 0, negative: 0, unknown: 0 };
const attributions = [];
for (const d of decisions) {
  const sig = firstSignalByHash.get(d.promptHash);
  // Fixed clock: pin `now` to the decision's own corrective signal, or 60s
  // after the decision when the user never acted. Mirrors the replay pattern
  // in tests/telemetry/outcomes.test.mjs section 8.
  const now = sig ? Date.parse(sig.ts) : Date.parse(d.ts) + 60_000;
  const [outcome] = correlate([d], signals, { now });
  counts[outcome.outcome]++;
  const prompt = promptById.get(d.corpusId);
  const attr = attributeOutcome(
    { prompt: prompt.prompt, promptHash: d.promptHash, selectedSkills: d.selectedSkills.slice(0, 1) },
    outcome.outcome,
    leaf
  );
  if (attr) attributions.push(attr);
}

assert(counts.positive === manifest.counts.positive, `positive outcomes ${counts.positive} match manifest ${manifest.counts.positive}`);
assert(counts.negative === manifest.counts.negative, `negative outcomes ${counts.negative} match manifest ${manifest.counts.negative}`);
assert(counts.negative > 0, `at least one negative outcome is available, got ${counts.negative}`);
assert(attributions.length >= 20, `attributions clear the minOutcomes floor, got ${attributions.length}`);

const update = computeWeights(attributions, { name: 3, description: 2, keywords: 1 }, { minOutcomes: 20 });
assert(update.changed === true, `computeWeights proposes a change (reason: ${update.reason})`);
assert(
  ['name', 'description', 'keywords'].every((f) => update.newWeights[f] >= 0.5 && update.newWeights[f] <= 5.0),
  `proposed weights stay within [0.5, 5.0]: ${JSON.stringify(update.newWeights)}`
);

const guard = checkSafety(update.newWeights, loadBaseline());
assert(guard.action === 'refuse', `guardrail refuses the proposal (got ${guard.action}: ${guard.reason})`);
assert(
  /exceeds MAX_DELTA/.test(guard.reason),
  `refusal reason names MAX_DELTA: ${guard.reason}`
);

// The point of this sub-phase: the loop over the *floor-aware* regenerated
// fixtures must reach the same proposal `tune --analyze` reaches, because the
// shipped semantic weight of 0 means the provider is never constructed and the
// ranking the CLI proposes from is the same pure-BM25 ranking.
assert(
  liveWeights.semantic === 0,
  `shipped semantic weight is 0 so the loop runs on pure BM25 (got ${liveWeights.semantic})`
);
const cliCorpus = buildAttributions(130);
const cliUpdate = computeWeights(cliCorpus.attributions, { name: 3, description: 2, keywords: 1 }, { minOutcomes: 20 });
assert(
  Math.abs(cliUpdate.newWeights.name - update.newWeights.name) < 1e-9 &&
    Math.abs(cliUpdate.newWeights.description - update.newWeights.description) < 1e-9 &&
    Math.abs(cliUpdate.newWeights.keywords - update.newWeights.keywords) < 1e-9,
  `proposal from the regenerated fixtures matches tune --analyze: ` +
    `${JSON.stringify(update.newWeights)} vs ${JSON.stringify(cliUpdate.newWeights)}`
);

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
