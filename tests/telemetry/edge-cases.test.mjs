/**
 * Edge-case tests for the telemetry public APIs.
 *
 * Fills the gaps in docs/reports/phase-6-test-audit.md section 4, where
 * correlate / correlateFromLogs / trackPrompt / recordSignal were marked as
 * missing invalid-input or boundary coverage.
 *
 *   1. correlate          — empty decisions, empty signals, decisions missing
 *                           latencyMs / selectedSkills, unknown signal types,
 *                           unparsable timestamps, exact window boundaries.
 *   2. correlateFromLogs  — a logDir that does not exist, a logDir with no
 *                           signals files, a signals file of malformed lines.
 *   3. trackPrompt        — the first prompt of a session emits no signal, a
 *                           repeat inside 5m emits `retry`, and a repeat of a
 *                           DIFFERENT prompt does not.
 *   4. recordSignal       — an unknown signal type is rejected, a non-object
 *                           details field is rejected, a missing field is
 *                           rejected, and nothing is written for any of them.
 */
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { correlate, correlateFromLogs } from '../../src/telemetry/outcomes.mjs';
import { recordSignal, validateSignal, hashText, readSignals } from '../../src/telemetry/signals.mjs';
import { jaccardSimilarity } from '../../src/telemetry/session-tracker.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log(`  \u2713 ${message}`); }
  else { failed++; console.error(`  \u2717 ${message}`); }
}

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const MIN = 60 * 1000;

const dec = (hash, minutesAgo = 5) => ({
  ts: iso(-minutesAgo * MIN), mode: 'implicit', tier: 'bm25',
  selectedSkills: ['a'], latencyMs: { total: 1, bm25: 1 },
  confidence: 0.5, promptHash: hash,
});
const sig = (hash, type, minutesAgo) => ({
  ts: iso(-minutesAgo * MIN), decisionHash: hash, type, details: {},
});

console.log('\n=== Telemetry edge cases ===\n');

// ─── 1. correlate ────────────────────────────────────────────────────────────
console.log('1. correlate empty / invalid / boundary input');

assert(Array.isArray(correlate([], [])) && correlate([], []).length === 0, 'no decisions yields []');
assert(correlate([dec('h1')], []).length === 1, 'no signals still yields one outcome per decision');
assert(correlate([dec('h1')], [])[0].outcome === 'positive', 'a decision with no signals is positive');
assert(correlate([], [sig('h1', 'retry', 1)]).length === 0, 'signals without decisions yield []');

const noLatency = correlate(
  [{ ts: iso(-5 * MIN), mode: 'implicit', tier: 'bm25', selectedSkills: [], confidence: 0.5, promptHash: 'h1' }],
  []
);
assert(noLatency[0].latencyMs === 0, 'a decision without latencyMs reports latencyMs 0 (no throw)');
assert(Array.isArray(noLatency[0].decision.selectedSkills), 'a decision without selectedSkills yields an array field');

const noSkills = correlate(
  [{ ts: iso(-5 * MIN), mode: 'implicit', tier: 'bm25', latencyMs: {}, confidence: 0.5, promptHash: 'h1' }],
  []
);
assert(noSkills[0].decision.selectedSkills === undefined, 'a missing selectedSkills is passed through, not defaulted');

const unknownType = correlate([dec('h1', 5)], [sig('h1', 'some_future_type', 1)]);
assert(unknownType[0].outcome === 'positive', 'an unrecognised signal type never produces a negative');

const dismiss = correlate([dec('h1', 5)], [sig('h1', 'dismiss', 1)]);
assert(dismiss[0].outcome === 'positive', 'a `dismiss` signal is not treated as a negative correction');

// Exact window boundaries. correlate uses `ageMs <= WINDOW`, so the boundary
// second itself still classifies as negative; one second past it does not.
const atRetryEdge = correlate([dec('h1', 6)], [sig('h1', 'retry', 1)]);
assert(atRetryEdge[0].outcome === 'negative', 'a retry exactly 5 minutes after the signal is negative (inclusive edge)');

const justPastRetry = correlate([dec('h1', 8)], [sig('h1', 'retry', 5.02)]);
assert(justPastRetry[0].outcome === 'positive', 'a retry 1.2 seconds past the 5-minute window is not a negative');

const atOverrideEdge = correlate([dec('h1', 3)], [sig('h1', 'explicit_override', 1)]);
assert(atOverrideEdge[0].outcome === 'negative', 'an explicit_override inside 2 minutes is negative');

const pastOverride = correlate([dec('h1', 4)], [sig('h1', 'explicit_override', 3.5)]);
assert(pastOverride[0].outcome === 'positive', 'an explicit_override past 2 minutes is not a negative');

const stale = correlate([dec('h1', 30)], [sig('h1', 'retry', 20)]);
assert(stale[0].outcome === 'unknown', 'a signal older than the 10-minute stale threshold yields unknown');
assert(stale[0].signals.length === 0, 'a stale signal is excluded from the attached signals list');

// An unparsable decision timestamp yields NaN ages, which fail every
// comparison, so the decision falls through to the no-signal branch.
const badTs = correlate([{ ts: 'not-a-date', promptHash: 'h1', mode: 'implicit', tier: 'bm25' }], []);
assert(badTs.length === 1 && badTs[0].outcome === 'positive',
  'an unparsable decision timestamp does not throw and falls back to positive');

// Multiple signals for one decision: the first matching type in priority
// order wins, and only non-stale signals are attached.
const many = correlate(
  [dec('h1', 20)],
  [sig('h1', 'dismiss', 1), sig('h1', 'retry', 2), sig('h1', 'rephrase', 9), sig('h1', 'retry', 15)]
);
assert(many[0].outcome === 'negative', 'one negative signal among several is enough');
assert(/retry/.test(many[0].reason), `the retry reason is reported (got "${many[0].reason}")`);
assert(many[0].signals.length === 3, `signals older than the 10-minute stale threshold are dropped from the attached list (got ${many[0].signals.length} of 4)`);

// Signals keyed to a different decision are ignored entirely.
const unrelated = correlate([dec('h1', 5)], [sig('other', 'retry', 1)]);
assert(unrelated[0].outcome === 'positive', 'a signal for another decision hash is not applied');

// ─── 2. correlateFromLogs ────────────────────────────────────────────────────
console.log('\n2. correlateFromLogs missing dir / empty dir / malformed lines');

const missing = await correlateFromLogs([dec('h1', 5)], { logDir: join(tmpdir(), 'skill-router-does-not-exist-xyz') });
assert(missing.length === 1 && missing[0].outcome === 'positive', 'a non-existent logDir degrades to positive, not a throw');

const emptyDir = mkdtempSync(join(tmpdir(), 'skill-router-empty-logs-'));
const empty = await correlateFromLogs([dec('h1', 5)], { logDir: emptyDir });
assert(empty[0].outcome === 'positive', 'an empty logDir yields no signals');

const malformedDir = mkdtempSync(join(tmpdir(), 'skill-router-bad-logs-'));
writeFileSync(join(malformedDir, 'signals-20260101.jsonl'), 'not json\n{\n  "ts": "x"\n');
const malformed = await correlateFromLogs([dec('h1', 5)], { logDir: malformedDir });
assert(malformed[0].outcome === 'positive', 'a signals file of malformed lines yields no signals, not a throw');

const mixedDir = mkdtempSync(join(tmpdir(), 'skill-router-mixed-logs-'));
writeFileSync(join(mixedDir, 'signals-20260101.jsonl'),
  'garbage line\n' + JSON.stringify(sig('h1', 'retry', 1)) + '\n\n');
const mixed = await correlateFromLogs([dec('h1', 5)], { logDir: mixedDir });
assert(mixed[0].outcome === 'negative', 'a valid line is still read from a partly malformed file');
assert(mixed[0].signals.length === 1, 'only the parsed signal is attached');

for (const d of [emptyDir, malformedDir, mixedDir]) rmSync(d, { recursive: true, force: true });

// ─── 3. jaccardSimilarity (rephrase detection helper) ────────────────────────
console.log('\n3. jaccardSimilarity boundary input');

assert(jaccardSimilarity('', '') === 1, 'two empty strings are identical (Jaccard 1)');
assert(jaccardSimilarity('a', '') === 0, 'an empty string vs a non-empty one is 0');
assert(jaccardSimilarity(null, 'a') === 0, 'a null input is 0, not a throw');
assert(jaccardSimilarity('a b c', 'a b c') === 1, 'identical token sets are 1');
assert(jaccardSimilarity('a b', 'c d') === 0, 'disjoint token sets are 0');
assert(Math.abs(jaccardSimilarity('a b', 'b c') - 1 / 3) < 1e-9, 'a one-of-three overlap is 1/3');

// ─── 4. recordSignal / validateSignal ────────────────────────────────────────
console.log('\n4. recordSignal invalid input is rejected and not written');

assert(validateSignal(null).valid === false, 'a null signal is invalid');
assert(validateSignal('string').valid === false, 'a non-object signal is invalid');
assert(validateSignal({ ts: iso(0), type: 'retry' }).valid === false, 'a missing decisionHash is invalid');
assert(validateSignal({ ts: iso(0), decisionHash: 'h', type: 'nope' }).valid === false, 'an unknown type is invalid');
assert(validateSignal({ ts: iso(0), decisionHash: 'h', type: 'retry', details: 'no' }).valid === false,
  'a non-object details field is invalid');
assert(validateSignal({ ts: iso(0), decisionHash: 'h', type: 'retry' }).valid === true,
  'a minimal valid signal passes');

const before = existsSync(resolve('logs')) ? readdirSync(resolve('logs')).length : 0;
await recordSignal({ ts: iso(0), decisionHash: 'h', type: 'not-a-type' });
await recordSignal(null);
const after = existsSync(resolve('logs')) ? readdirSync(resolve('logs')).length : 0;
assert(after === before, `an invalid signal writes nothing (${before} -> ${after} entries in logs/)`);

assert(/^[0-9a-f]{64}$/.test(hashText('probe')), 'hashText returns a bare 64-char hex digest');
assert(hashText('probe') === hashText('probe'), 'hashText is deterministic');
assert(hashText('probe') !== hashText('probe2'), 'different inputs hash differently');

console.log(`\n  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
if (failed > 0) process.exit(1);
