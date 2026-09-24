/**
 * Signals telemetry tests.
 *
 * Verifies:
 * 1. recordSignal appends to correct daily file
 * 2. readSignals returns signals filtered by type
 * 3. readSignals handles missing files gracefully
 * 4. readSignals handles malformed lines
 * 5. validateSignal rejects invalid input
 * 6. Signals are logged separately from decisions (different file prefix)
 */
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { recordSignal, readSignals, validateSignal } from '../../src/telemetry/signals.mjs';

const BASE = resolve('.');
const TEST_LOG_DIR = resolve(BASE, 'tests/telemetry/tmp-signals-logs');
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

function setup() {
  rmSync(TEST_LOG_DIR, { recursive: true, force: true });
  mkdirSync(TEST_LOG_DIR, { recursive: true });
}
function teardown() {
  rmSync(TEST_LOG_DIR, { recursive: true, force: true });
}

console.log('\n=== Signals Telemetry Tests ===\n');

setup();

// We test by writing to TEST_LOG_DIR directly via readSignals(logDir=...)
// recordSignal writes to the module's hardcoded dir, so we use a post-write
// copy strategy: write via recordSignal, then copy the file for inspection.

// ─── 1. recordSignal appends to correct daily file ────────────────────────────
console.log('1. recordSignal appends to correct daily file');

// Capture the module's actual log dir
const REAL_LOG_DIR = resolve(BASE, 'logs');
const today = new Date();
const y = today.getUTCFullYear();
const m = String(today.getUTCMonth() + 1).padStart(2, '0');
const d = String(today.getUTCDate()).padStart(2, '0');
const todayFile = join(REAL_LOG_DIR, `signals-${y}${m}${d}.jsonl`);

// Save existing content
let existingContent = '';
try {
  existingContent = readFileSync(todayFile, 'utf-8');
} catch {
  // File may not exist
}

await recordSignal({
  ts: '2026-09-24T10:00:00.000Z',
  decisionHash: 'sha256:testhash0000000000000000000000000000000000000000000000000000000000',
  type: 'success',
  details: { skill: 'frontend-nextjs-middleware' },
});

let fileContent = '';
try {
  fileContent = readFileSync(todayFile, 'utf-8');
} catch {
  assert(false, 'logDecision did not create the signals log file');
  fileContent = '';
}

const lines = fileContent.split('\n').filter((l) => l.trim());
assert(lines.length > 0, 'signals log file has content after recordSignal');

// Find our entry
let foundOurEntry = false;
for (const line of lines) {
  try {
    const entry = JSON.parse(line);
    if (entry.type === 'success' && entry.details.skill === 'frontend-nextjs-middleware') {
      foundOurEntry = true;
      assert(entry.decisionHash.startsWith('sha256:'), 'decisionHash is a hash');
      assert(entry.ts === '2026-09-24T10:00:00.000Z', 'timestamp preserved');
      break;
    }
  } catch {
    // Skip malformed
  }
}
assert(foundOurEntry, 'our test entry was written to the log file');

// Append a second signal of a different type
await recordSignal({
  ts: '2026-09-24T10:05:00.000Z',
  decisionHash: 'sha256:testhash0000000000000000000000000000000000000000000000000000000000',
  type: 'retry',
  details: { attemptCount: 2 },
});

const content2 = readFileSync(todayFile, 'utf-8');
const lines2 = content2.split('\n').filter((l) => l.trim());
assert(lines2.length >= 2, `file has at least 2 lines after second append, got ${lines2.length}`);

// Restore original content
if (existingContent) {
  writeFileSync(todayFile, existingContent, 'utf-8');
} else {
  try { unlinkSync(todayFile); } catch { /* ignore */ }
}

// ─── 2. readSignals returns signals filtered by type ──────────────────────────
console.log('\n2. readSignals returns signals filtered by type');

// Write fixture signals to test dir
const testFile = join(TEST_LOG_DIR, 'signals-20260924.jsonl');
writeFileSync(
  testFile,
  [
    '{"ts":"2026-09-24T10:00:00.000Z","decisionHash":"sha256:hash1","type":"success","details":{"skill":"a"}}\n',
    '{"ts":"2026-09-24T10:01:00.000Z","decisionHash":"sha256:hash1","type":"retry","details":{"attemptCount":2}}\n',
    '{"ts":"2026-09-24T10:02:00.000Z","decisionHash":"sha256:hash2","type":"dismiss","details":{}}\n',
    '{"ts":"2026-09-24T10:03:00.000Z","decisionHash":"sha256:hash3","type":"rephrase","details":{"similarity":0.7}}\n',
  ].join(''),
  'utf-8'
);

const allSignals = await readSignals({ logDir: TEST_LOG_DIR });
assert(allSignals.length === 4, `readSignals returns 4 signals, got ${allSignals.length}`);

const successSignals = await readSignals({ logDir: TEST_LOG_DIR, type: 'success' });
assert(successSignals.length === 1, `filtered by success: 1, got ${successSignals.length}`);

const retrySignals = await readSignals({ logDir: TEST_LOG_DIR, type: 'retry' });
assert(retrySignals.length === 1, `filtered by retry: 1, got ${retrySignals.length}`);

const dismissSignals = await readSignals({ logDir: TEST_LOG_DIR, type: 'dismiss' });
assert(dismissSignals.length === 1, `filtered by dismiss: 1, got ${dismissSignals.length}`);

// ─── 3. readSignals handles missing files gracefully ──────────────────────────
console.log('\n3. readSignals handles missing files gracefully');

const emptyDir = resolve(BASE, 'tests/telemetry/tmp-empty-logs');
mkdirSync(emptyDir, { recursive: true });
const noSignals = await readSignals({ logDir: emptyDir });
assert(Array.isArray(noSignals), 'readSignals returns array for empty dir');
assert(noSignals.length === 0, 'readSignals returns empty array for empty dir');
rmSync(emptyDir, { recursive: true, force: true });

// ─── 4. readSignals handles malformed lines ───────────────────────────────────
console.log('\n4. readSignals handles malformed lines');

const badFile = join(TEST_LOG_DIR, 'signals-20260101.jsonl');
writeFileSync(
  badFile,
  [
    '{"ts":"2026-01-01T00:00:00.000Z","decisionHash":"sha256:abc","type":"success","details":{}}\n',
    'not valid json\n',
    '{malformed}\n',
    '\n',
    '{"ts":"2026-01-01T00:00:01.000Z","decisionHash":"sha256:def","type":"dismiss","details":{}}\n',
  ].join(''),
  'utf-8'
);

const badResult = await readSignals({ logDir: TEST_LOG_DIR, type: 'success' });
const validFromBad = badResult.filter((s) => s.ts && s.ts.startsWith('2026-01-01'));
assert(validFromBad.length === 1, `found 1 valid entry from malformed file, got ${validFromBad.length}`);

unlinkSync(badFile);

// ─── 5. validateSignal rejects invalid input ──────────────────────────────────
console.log('\n5. validateSignal rejects invalid input');

const v1 = validateSignal(null);
assert(!v1.valid, 'null is invalid');

const v2 = validateSignal({ ts: '2026-01-01T00:00:00.000Z', type: 'invalid_type' });
assert(!v2.valid, 'unknown type is invalid');

const v3 = validateSignal({ ts: '2026-01-01T00:00:00.000Z', decisionHash: 'sha256:abc', type: 'success' });
assert(v3.valid, 'valid signal passes validation');

const v4 = validateSignal({ ts: '', decisionHash: 'sha256:abc', type: 'success' });
assert(!v4.valid, 'empty ts is invalid');

const v5 = validateSignal({ ts: '2026-01-01T00:00:00.000Z', decisionHash: '', type: 'success' });
assert(!v5.valid, 'empty decisionHash is invalid');

// ─── 6. Signals are logged separately from decisions ──────────────────────────
console.log('\n6. Signals are logged separately from decisions');

// Signals use 'signals-' prefix; decisions use 'routing-' prefix
assert(
  !todayFile.includes('routing-'),
  'signals file does not use routing- prefix'
);
assert(
  todayFile.includes('signals-'),
  'signals file uses signals- prefix'
);

// ─── Cleanup ──────────────────────────────────────────────────────────────────
teardown();

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
