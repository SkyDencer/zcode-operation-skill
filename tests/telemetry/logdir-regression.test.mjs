/**
 * Regression tests for the Sub-Phase 6.1 `feedback --outcomes` logDir fix and
 * characterisation tests for the still-open Phase 4-5 adaptation defects.
 *
 * Background (docs/reports/phase-6-test-audit.md section 5):
 *   - Item 7  FIXED: correlateFromLogs() was called with no logDir, so
 *          readdir(undefined) failed, no signals were read, and every decision
 *          was reported "positive". tests/telemetry/outcomes.test.mjs covers the
 *          library default; this file covers the CLI call site itself
 *          (src/cli/feedback.mjs), which no test exercised.
 *   - Item 10 OPEN (P6-H-016): readSignalFiles() wraps the whole readdir/read
 *          loop in one try/catch, so ONE unreadable signals file discards every
 *          other file and the whole corpus is misclassified "positive".
 *   - Item 11 OPEN: tune --analyze derives attributions from tests/prompts.json
 *          and never reads the live signal logs.
 *   - Item 12 OPEN: tune --analyze prints attributions.length while tune --status
 *          prints positive+negative, and the two disagree.
 *   - Item 13 PARTIAL: the post-benchmark auto-rollback decision function is
 *          tested; the write-back in cmdApply is not.
 *
 * Items 10-13 are OPEN DEFECTS. Their tests below therefore pin the CURRENT
 * behaviour and are named as such — they are not assertions of desired
 * behaviour, and they are expected to be inverted when the defects are fixed.
 * A test that asserted the desired behaviour would fail the suite today.
 */
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { correlateFromLogs } from '../../src/telemetry/outcomes.mjs';
import { readSignals } from '../../src/telemetry/signals.mjs';
import { buildAttributions } from '../../src/cli/tune-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const CLI = resolve(PROJECT_ROOT, 'bin', 'skill-router.mjs');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log(`  \u2713 ${message}`); }
  else { failed++; console.error(`  \u2717 ${message}`); }
}

const minsAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();

/** Build an isolated cwd containing a logs/ dir with the given files. */
function fixture(name, files) {
  const dir = mkdtempSync(join(tmpdir(), `skill-router-${name}-`));
  mkdirSync(join(dir, 'logs'), { recursive: true });
  for (const [file, lines] of Object.entries(files)) {
    writeFileSync(join(dir, 'logs', file), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  }
  return dir;
}

function decision(hash, minutes) {
  return {
    ts: minsAgo(minutes), mode: 'implicit', router: null, tier: 'bm25',
    selectedSkills: ['backend-laravel'], latencyMs: { total: 5, bm25: 5 },
    confidence: 0.8, promptHash: hash, sessionId: null, version: null,
  };
}

console.log('\n=== feedback --outcomes logDir regression ===\n');

// ─── 1. Item 7 (FIXED in 6.1): the CLI call site passes logDir ───────────────
// Before the fix, running this CLI in an isolated cwd reported 1 positive / 0
// negative. The fixture timestamps are inside the 5-minute retry window, so a
// correct run must report 1 negative.

const retryDir = fixture('logdir-fix', {
  'routing-20260101.jsonl': [decision('sha256:aaa', 3)],
  'signals-20260101.jsonl': [{ ts: minsAgo(1), decisionHash: 'sha256:aaa', type: 'retry', details: {} }],
});

const fixedRun = spawnSync('node', [CLI, 'feedback', '--outcomes', '--json'], {
  cwd: retryDir, encoding: 'utf-8',
});
const fixedJson = JSON.parse(fixedRun.stdout);

assert(fixedRun.status === 0, `feedback --outcomes --json exits 0 (got ${fixedRun.status})`);
assert(fixedJson.total === 1, `the isolated fixture decision is the only one analysed (got ${fixedJson.total})`);
assert(
  fixedJson.negative === 1 && fixedJson.positive === 0,
  `REGRESSION (6.1 fix): the retry signal is read, so the decision is negative, not positive (got ${fixedJson.positive} positive / ${fixedJson.negative} negative)`
);
assert(
  /retry within 5 minutes/.test(fixedJson.negatives?.[0]?.reason ?? ''),
  `the reason names the retry signal (got "${fixedJson.negatives?.[0]?.reason}")`
);

// A cwd with decisions but NO logs at all must degrade, not crash.
const noSignalsDir = fixture('logdir-none', {
  'routing-20260101.jsonl': [decision('sha256:bbb', 3)],
});
const noSignalsRun = spawnSync('node', [CLI, 'feedback', '--outcomes', '--json'], {
  cwd: noSignalsDir, encoding: 'utf-8',
});
const noSignalsJson = JSON.parse(noSignalsRun.stdout);
assert(noSignalsRun.status === 0, 'a cwd with no signals log still exits 0 (fail-safe)');
assert(noSignalsJson.positive === 1 && noSignalsJson.negative === 0,
  'with no signals on disk the decision is "positive" (no corrective action seen)');

// ─── 2. Item 10 (OPEN, P6-H-016): one unreadable file discards the rest ───────
// CHARACTERISATION: this is the defect. signals-20260101.jsonl is created as a
// DIRECTORY so readFile() throws; the whole loop is inside a single try/catch,
// so the valid signals-20260201.jsonl that sorts after it is never read.

const swallowDir = fixture('p6-h-016', {
  'signals-20260201.jsonl': [{ ts: minsAgo(1), decisionHash: 'sha256:ccc', type: 'retry', details: {} }],
});
mkdirSync(join(swallowDir, 'logs', 'signals-20260101.jsonl'));

const swallowOutcomes = await correlateFromLogs([decision('sha256:ccc', 3)], { logDir: join(swallowDir, 'logs') });
assert(
  swallowOutcomes[0].outcome === 'positive',
  `CHARACTERISATION (P6-H-016, OPEN): one unreadable signals file makes the whole corpus "positive" (got "${swallowOutcomes[0].outcome}"). Invert this assertion when the defect is fixed.`
);
// readSignals (src/telemetry/signals.mjs) catches per FILE, so it survives the
// poisoned sibling and still returns the good signal. Only readSignalFiles in
// src/telemetry/outcomes.mjs wraps the whole loop in one try/catch.
const swallowSignals = await readSignals({ logDir: join(swallowDir, 'logs') });
assert(
  swallowSignals.length === 1,
  `CONTRAST: readSignals catches per file and survives the unreadable sibling (got ${swallowSignals.length} signals) — the defect is specific to readSignalFiles`
);

// The healthy path is unaffected: without the poisoned file, the same layout
// yields the signal.
const healthyDir = fixture('p6-h-016-healthy', {
  'signals-20260201.jsonl': [{ ts: minsAgo(1), decisionHash: 'sha256:ddd', type: 'retry', details: {} }],
});
const healthySignals = await readSignals({ logDir: join(healthyDir, 'logs') });
assert(healthySignals.length === 1, 'without an unreadable sibling, the signal file is read');

for (const d of [retryDir, noSignalsDir, swallowDir, healthyDir]) {
  rmSync(d, { recursive: true, force: true });
}

console.log(`\n  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
if (failed > 0) process.exit(1);
