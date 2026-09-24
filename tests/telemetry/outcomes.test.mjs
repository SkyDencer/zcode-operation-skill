/**
 * Outcomes correlation tests.
 *
 * Verifies:
 * 1. retry within 5m → negative
 * 2. explicit_override within 2m → negative
 * 3. rephrase within 5m → negative
 * 4. no signals within 10m → positive
 * 5. stale signals → unknown
 * 6. correlateFromLogs reads from fixture files
 * 7. correlateFromLogs defaults logDir to the signals log directory (regression:
 *    an undefined logDir made readdir() fail, silently classifying every
 *    decision as "positive")
 */
import { readFileSync, mkdirSync, writeFileSync, rmSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { correlate, correlateFromLogs } from '../../src/telemetry/outcomes.mjs';

const BASE = resolve('.');
const FIXTURES = resolve(BASE, 'tests/telemetry/fixtures');
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

console.log('\n=== Outcomes Correlation Tests ===\n');

// ─── 1. retry within 5m → negative ────────────────────────────────────────────
console.log('1. retry within 5m → negative');

const retryDecision = {
  ts: '2026-09-24T08:00:00.000Z',
  promptHash: 'sha256:retryhash',
  mode: 'implicit',
  tier: 'bm25',
  selectedSkills: ['skill-a'],
  confidence: 0.8,
  latencyMs: { total: 3 },
};
const retrySignal = {
  ts: '2026-09-24T08:03:00.000Z',
  decisionHash: 'sha256:retryhash',
  type: 'retry',
  details: { attemptCount: 2 },
};
// NOW is 3 min after signal → within 5m retry window
const r1 = correlate([retryDecision], [retrySignal], {
  now: new Date('2026-09-24T08:04:00.000Z').getTime(),
});
assert(r1.length === 1, `correlate returns 1 outcome, got ${r1.length}`);
assert(r1[0].outcome === 'negative', `outcome is negative for retry, got ${r1[0].outcome}`);
assert(r1[0].reason.includes('retry'), `reason mentions retry, got: ${r1[0].reason}`);
assert(r1[0].signals.length === 1, `1 signal attached, got ${r1[0].signals.length}`);

// ─── 2. explicit_override within 2m → negative ────────────────────────────────
console.log('\n2. explicit_override within 2m → negative');

const overrideDecision = {
  ts: '2026-09-24T08:05:00.000Z',
  promptHash: 'sha256:overridehash',
  mode: 'implicit',
  tier: 'bm25',
  selectedSkills: ['skill-b'],
  confidence: 0.7,
  latencyMs: { total: 4 },
};
const overrideSignal = {
  ts: '2026-09-24T08:06:00.000Z',
  decisionHash: 'sha256:overridehash',
  type: 'explicit_override',
  details: { previousHash: 'sha256:prev' },
};
const r2 = correlate([overrideDecision], [overrideSignal], {
  now: new Date('2026-09-24T08:07:00.000Z').getTime(),
});
assert(r2.length === 1, `correlate returns 1 outcome, got ${r2.length}`);
assert(r2[0].outcome === 'negative', `outcome is negative for override, got ${r2[0].outcome}`);
assert(r2[0].reason.includes('override'), `reason mentions override, got: ${r2[0].reason}`);

// ─── 3. rephrase within 5m → negative ─────────────────────────────────────────
console.log('\n3. rephrase within 5m → negative');

const rephraseDecision = {
  ts: '2026-09-24T08:10:00.000Z',
  promptHash: 'sha256:rephrasehash',
  mode: 'implicit',
  tier: 'bm25',
  selectedSkills: ['skill-c'],
  confidence: 0.6,
  latencyMs: { total: 2 },
};
const rephraseSignal = {
  ts: '2026-09-24T08:12:00.000Z',
  decisionHash: 'sha256:rephrasehash',
  type: 'rephrase',
  details: { similarity: 0.72 },
};
const r3 = correlate([rephraseDecision], [rephraseSignal], {
  now: new Date('2026-09-24T08:13:00.000Z').getTime(),
});
assert(r3.length === 1, `correlate returns 1 outcome, got ${r3.length}`);
assert(r3[0].outcome === 'negative', `outcome is negative for rephrase, got ${r3[0].outcome}`);
assert(r3[0].reason.includes('rephrase'), `reason mentions rephrase, got: ${r3[0].reason}`);

// ─── 4. no signals within 10m → positive ──────────────────────────────────────
console.log('\n4. no signals within 10m → positive');

const posDecision = {
  ts: '2026-09-24T08:00:00.000Z',
  promptHash: 'sha256:poshash',
  mode: 'implicit',
  tier: 'bm25',
  selectedSkills: ['skill-d'],
  confidence: 0.9,
  latencyMs: { total: 2 },
};

const r4 = correlate([posDecision], [], {
  now: new Date('2026-09-24T08:20:00.000Z').getTime(),
});
assert(r4.length === 1, `correlate returns 1 outcome, got ${r4.length}`);
assert(r4[0].outcome === 'positive', `outcome is positive when no signals, got ${r4[0].outcome}`);
assert(r4[0].reason.includes('no signals'), `reason mentions no signals, got: ${r4[0].reason}`);
assert(r4[0].signals.length === 0, `0 signals attached for positive, got ${r4[0].signals.length}`);

// ─── 5. stale signals → unknown ───────────────────────────────────────────────
console.log('\n5. stale signals → unknown');

const staleDecision = {
  ts: '2026-09-24T06:00:00.000Z',
  promptHash: 'sha256:stalehash',
  mode: 'implicit',
  tier: 'bm25',
  selectedSkills: ['skill-e'],
  confidence: 0.85,
  latencyMs: { total: 3 },
};
const staleSignal = {
  ts: '2026-09-24T06:01:00.000Z',
  decisionHash: 'sha256:stalehash',
  type: 'retry',
  details: { attemptCount: 2 },
};
// Signal is ~2h old relative to NOW → well beyond 10min stale threshold
const r5 = correlate([staleDecision], [staleSignal], {
  now: new Date('2026-09-24T08:20:00.000Z').getTime(),
});
assert(r5.length === 1, `correlate returns 1 outcome, got ${r5.length}`);
assert(r5[0].outcome === 'unknown', `outcome is unknown for stale signal, got ${r5[0].outcome}`);
// Stale signal should not be attached (beyond STALE_THRESHOLD_MS)
assert(r5[0].signals.length === 0, `0 stale signals attached, got ${r5[0].signals.length}`);

// ─── 6. correlateFromLogs reads from fixture files ────────────────────────────
console.log('\n6. correlateFromLogs reads from fixture files');

const TEST_LOGS = resolve(BASE, 'tests/telemetry/tmp-outcomes-logs');
mkdirSync(TEST_LOGS, { recursive: true });

// Write fixture signals to test dir
const signalsRaw = readFileSync(join(FIXTURES, 'signals-20260924.jsonl'), 'utf-8');
writeFileSync(join(TEST_LOGS, 'signals-20260924.jsonl'), signalsRaw, 'utf-8');

// Write fixture decisions to test dir
const decisionsRaw = readFileSync(join(FIXTURES, 'outcomes-decisions.jsonl'), 'utf-8');
const fixtureDecisions = decisionsRaw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

// Use a fixed NOW that makes fixture signals fall within relevant windows
// NOW=08:07: retry(08:06,1min), override(08:11,-4min future), rephrase(08:16,-9min future)
const FIXED_NOW = new Date('2026-09-24T08:07:00.000Z').getTime();
const outcomes = await correlateFromLogs(fixtureDecisions, { logDir: TEST_LOGS, now: FIXED_NOW });
assert(outcomes.length === fixtureDecisions.length, `correlateFromLogs returns ${fixtureDecisions.length} outcomes, got ${outcomes.length}`);

const negativeOutcomes = outcomes.filter((o) => o.outcome === 'negative');
const positiveOutcomes = outcomes.filter((o) => o.outcome === 'positive');
const unknownOutcomes = outcomes.filter((o) => o.outcome === 'unknown');

assert(negativeOutcomes.length >= 3, `at least 3 negative outcomes, got ${negativeOutcomes.length}`);
assert(positiveOutcomes.length >= 1, `at least 1 positive outcome, got ${positiveOutcomes.length}`);

// Verify each negative has signals attached
for (const o of negativeOutcomes) {
  assert(Array.isArray(o.signals), `negative outcome has signals array, got ${typeof o.signals}`);
  assert(o.signals.length > 0, `negative outcome has >0 signals, got ${o.signals.length}`);
}

// Verify latencyMs is present
for (const o of outcomes) {
  assert(typeof o.latencyMs === 'number', `outcome has numeric latencyMs, got ${typeof o.latencyMs}`);
}

rmSync(TEST_LOGS, { recursive: true, force: true });

// ─── 7. correlateFromLogs defaults logDir (regression) ────────────────────────
// Before the fix, correlateFromLogs passed `opts.logDir` straight to
// readSignalFiles(). With no opts, that was `undefined`, so `readdir(undefined)`
// threw and was swallowed, returning zero signals — every decision was then
// classified "positive" ("no signals within 10 minutes"). The default must
// resolve to the real signals log directory so a caller that omits logDir
// (e.g. `feedback --outcomes`) still sees live signals.
console.log('\n7. correlateFromLogs defaults logDir to the signals log directory');

const SIGNALS_DIR = resolve(BASE, 'logs');
const probeHash = 'sha256:logdir-default-probe';

// Back up every signals file so the probe leaves the real logs untouched.
const signalsFiles = readdirSync(SIGNALS_DIR).filter((f) => f.startsWith('signals-') && f.endsWith('.jsonl'));
const backups = signalsFiles.map((f) => [f, readFileSync(join(SIGNALS_DIR, f), 'utf-8')]);
const probeFile = join(SIGNALS_DIR, 'signals-logdir-default-probe.jsonl');

try {
  // A single explicit_override signal, deliberately referenced by a decision
  // whose promptHash has no other signals. If the default logDir resolves,
  // this decision is negative; if logDir is undefined, it reads no signals and
  // comes back positive.
  writeFileSync(probeFile, JSON.stringify({
    ts: new Date().toISOString(),
    decisionHash: probeHash,
    type: 'explicit_override',
    details: { previousHash: 'sha256:none' },
  }) + '\n', 'utf-8');

  const probeDecision = {
    ts: new Date().toISOString(),
    promptHash: probeHash,
    mode: 'implicit',
    tier: 'bm25',
    selectedSkills: ['skill-probe'],
    confidence: 0.8,
    latencyMs: { total: 3 },
  };

  // No `logDir` in opts — this is exactly how src/cli/feedback.mjs used to call it.
  const defaulted = await correlateFromLogs([probeDecision]);
  const probed = defaulted.find((o) => o.decisionHash === probeHash);
  assert(probed !== undefined, 'default logDir call returns an outcome for the probe decision');
  assert(probed.outcome === 'negative', `default logDir classifies probe as negative, got ${probed?.outcome}`);
  assert(probed.reason.includes('override'), `default logDir reason mentions override, got: ${probed?.reason}`);
  assert(probed.signals.length === 1, `default logDir attaches the probe signal, got ${probed?.signals.length}`);

  // An explicit logDir pointing at a directory with no signals must still read
  // that directory (proving the default did not clobber an override).
  const EMPTY_DIR = resolve(BASE, 'tests/telemetry/tmp-empty-logs');
  mkdirSync(EMPTY_DIR, { recursive: true });
  const empty = await correlateFromLogs([probeDecision], { logDir: EMPTY_DIR });
  assert(empty[0].outcome === 'positive', `explicit empty logDir yields positive, got ${empty[0].outcome}`);
  rmSync(EMPTY_DIR, { recursive: true, force: true });
} finally {
  try { unlinkSync(probeFile); } catch { /* ignore */ }
  for (const [name, content] of backups) {
    writeFileSync(join(SIGNALS_DIR, name), content, 'utf-8');
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
