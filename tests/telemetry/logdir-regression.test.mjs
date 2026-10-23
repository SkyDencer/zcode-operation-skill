/**
 * Regression tests for the Sub-Phase 6.1 `feedback --outcomes` logDir fix and
 * the per-file error classification of the signals readers.
 *
 * Background (docs/reports/phase-6-test-audit.md section 5):
 *   - Item 7  FIXED: correlateFromLogs() was called with no logDir, so
 *          readdir(undefined) failed, no signals were read, and every decision
 *          was reported "positive". tests/telemetry/outcomes.test.mjs covers the
 *          library default; this file covers the CLI call site itself
 *          (src/cli/feedback.mjs), which no test exercised.
 *   - Item 10 FIXED (P6-H-016 completion, EISDIR classification): the per-file
 *          readers (readSignalFiles in outcomes.mjs, readSignals in signals.mjs)
 *          skip no-data entries — ENOENT, and a directory masquerading as a
 *          signals-*.jsonl file (EISDIR) — and surface real errors
 *          (EACCES/EPERM/EIO) as named errors. The section-2 tests below pin the
 *          FIXED behaviour: a poisoned directory sibling neither crashes the
 *          read nor misclassifies the corpus.
 *   - Item 11 OPEN: tune --analyze derives attributions from tests/prompts.json
 *          and never reads the live signal logs.
 *   - Item 12 OPEN: tune --analyze prints attributions.length while tune --status
 *          prints positive+negative, and the two disagree.
 *   - Item 13 PARTIAL: the post-benchmark auto-rollback decision function is
 *          tested; the write-back in cmdApply is not.
 *
 * Item 10 is now fixed and its tests pin the FIXED behaviour. Items 11-13
 * remain OPEN and are not exercised by this file (they live in the tune-core
 * tests); they are documented here only for provenance.
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

// ─── 2. Item 10 (FIXED, P6-H-016 EISDIR classification) ───────────────────
// A signals-*.jsonl entry that is actually a DIRECTORY (created via mkdir) now
// throws EISDIR on readFile(); both per-file readers skip it (we never read or
// recurse into directories, so it holds no data) and still read the valid
// sibling that sorts after it. The old whole-loop try/catch that swallowed the
// valid file is gone.

const swallowDir = fixture('p6-h-016', {
  'signals-20260201.jsonl': [{ ts: minsAgo(1), decisionHash: 'sha256:ccc', type: 'retry', details: {} }],
});
mkdirSync(join(swallowDir, 'logs', 'signals-20260101.jsonl'));

const swallowOutcomes = await correlateFromLogs([decision('sha256:ccc', 3)], { logDir: join(swallowDir, 'logs') });
assert(
  swallowOutcomes[0].outcome === 'negative',
  `FIXED (P6-H-016, EISDIR skip): the EISDIR sibling is skipped, so the valid retry signal is read and the decision is "negative" (got "${swallowOutcomes[0].outcome}")`
);
// readSignals (src/telemetry/signals.mjs) skips the EISDIR entry too — both
// per-file readers are now symmetric for the no-data case — so it returns the
// good signal from the valid sibling.
const swallowSignals = await readSignals({ logDir: join(swallowDir, 'logs') });
assert(
  swallowSignals.length === 1,
  `readSignals skips the EISDIR sibling and still returns the good signal (got ${swallowSignals.length})`
);

// CONTRAST (post-fix): the EISDIR skip must NOT be a blanket "swallow every
// error". A real read error (EACCES/EIO) still throws a named error in BOTH
// readers. The injectable reader seam makes this portable across platforms
// instead of relying on chmod semantics.
function eaccessReader() {
  return {
    readdir: async () => ['signals-20260101.jsonl'],
    readFile: async () => {
      const e = new Error('EACCES: permission denied (seam injection)');
      e.code = 'EACCES';
      throw e;
    },
  };
}
let outcomesThrew = false;
try {
  await correlateFromLogs([decision('sha256:eee', 3)], { logDir: join(swallowDir, 'logs'), reader: eaccessReader() });
} catch (err) {
  outcomesThrew = err && err.code === 'EACCES';
}
assert(
  outcomesThrew,
  'CONTRAST: readSignalFiles still throws a named EACCES error (seam injection) — the EISDIR skip is specific to no-data directories, not a blanket swallow'
);
let signalsThrew = false;
try {
  await readSignals({ logDir: join(swallowDir, 'logs'), reader: eaccessReader() });
} catch (err) {
  signalsThrew = err && err.code === 'EACCES';
}
assert(
  signalsThrew,
  'CONTRAST: readSignals still throws a named EACCES error (seam injection) — symmetric with readSignalFiles'
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
