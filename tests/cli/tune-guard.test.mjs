/**
 * Tune guard tests.
 *
 * Verifies:
 * 1. loadBaseline returns null when baseline.json is missing
 * 2. loadBaseline returns correct data when baseline.json exists
 * 3. checkSafety accepts weights within bounds and small deltas
 * 4. checkSafety refuses weights outside [0.5, 5.0]
 * 5. checkSafety refuses weights exceeding MAX_DELTA per field
 * 6. checkSafety refuses weights causing massive predicted drop
 * 7. evaluateOutcome returns 'accepted' when accuracy improves
 * 8. evaluateOutcome returns 'reverted' when accuracy drops > 1pp
 * 9. evaluateOutcome returns 'accepted' when accuracy drops <= 1pp
 * 10. loadBaseline handles malformed JSON
 */
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBaseline, checkSafety, evaluateOutcome } from '../../src/cli/tune-guard.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const BASELINE_PATH = resolve(ROOT, 'data', 'baseline.json');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

// Track original baseline state
let originalExists = existsSync(BASELINE_PATH);
let originalContent = null;
try { originalContent = readFileSync(BASELINE_PATH, 'utf-8'); } catch { originalContent = null; }

function restoreOriginal() {
  if (originalContent !== null) {
    writeFileSync(BASELINE_PATH, originalContent, 'utf-8');
  } else if (existsSync(BASELINE_PATH)) {
    rmSync(BASELINE_PATH, { force: true });
  }
}

console.log('\n=== Tune Guard Tests ===\n');

// ─── 1. loadBaseline returns null when baseline.json is missing ───────────────
console.log('1. loadBaseline returns null when baseline.json is missing');

rmSync(BASELINE_PATH, { force: true });
const r1 = loadBaseline();
assert(r1 === null, 'returns null when file is absent');
restoreOriginal();

// ─── 2. loadBaseline returns correct data when baseline.json exists ───────────
console.log('\n2. loadBaseline returns correct data when baseline.json exists');

writeFileSync(BASELINE_PATH, JSON.stringify({
  benchmark: { top1: 0.95, recallAt3: 0.90 },
  weights: { name: 3.5, description: 2.0, keywords: 0.8 },
  baselineAt: '2026-01-01T00:00:00.000Z',
}), 'utf-8');
const r2 = loadBaseline();
assert(r2 !== null, 'returns object when file exists');
assert(r2.top1 === 0.95, `top1 is 0.95, got ${r2?.top1}`);
assert(r2.weights.name === 3.5, `name weight is 3.5, got ${r2?.weights?.name}`);
assert(r2.weights.description === 2.0, 'description weight is 2.0');
assert(r2.weights.keywords === 0.8, 'keywords weight is 0.8');
assert(r2.baselineAt === '2026-01-01T00:00:00.000Z', 'baselineAt preserved');
restoreOriginal();

// ─── 3. checkSafety accepts weights within bounds and small deltas ─────────────
console.log('\n3. checkSafety accepts valid weights');

writeFileSync(BASELINE_PATH, JSON.stringify({
  benchmark: { top1: 0.92 },
  weights: { name: 3.0, description: 2.0, keywords: 1.0 },
  baselineAt: '2026-01-01T00:00:00.000Z',
}), 'utf-8');
const r3 = checkSafety({ name: 3.1, description: 2.0, keywords: 1.0 }, loadBaseline());
assert(r3.action === 'accept', 'accepts small positive delta on one field');
assert(r3.baselineTop1 === 0.92, 'baselineTop1 preserved');
restoreOriginal();

// ─── 4. checkSafety refuses weights outside [0.5, 5.0] ────────────────────────
console.log('\n4. checkSafety refuses weights outside [0.5, 5.0]');

writeFileSync(BASELINE_PATH, JSON.stringify({
  benchmark: { top1: 0.92 },
  weights: { name: 3.0, description: 2.0, keywords: 1.0 },
  baselineAt: '2026-01-01T00:00:00.000Z',
}), 'utf-8');
const r4a = checkSafety({ name: 0.4, description: 2.0, keywords: 1.0 }, loadBaseline());
assert(r4a.action === 'refuse', 'refuses name < 0.5');
const r4b = checkSafety({ name: 3.0, description: 2.0, keywords: 5.1 }, loadBaseline());
assert(r4b.action === 'refuse', 'refuses keywords > 5.0');
restoreOriginal();

// ─── 5. checkSafety refuses weights exceeding MAX_DELTA per field ─────────────
console.log('\n5. checkSafety refuses weights exceeding MAX_DELTA');

writeFileSync(BASELINE_PATH, JSON.stringify({
  benchmark: { top1: 0.92 },
  weights: { name: 3.0, description: 2.0, keywords: 1.0 },
  baselineAt: '2026-01-01T00:00:00.000Z',
}), 'utf-8');
const r5 = checkSafety({ name: 3.0, description: 2.6, keywords: 1.0 }, loadBaseline());
assert(r5.action === 'refuse', `refuses description delta > 0.5, got ${r5.action}: ${r5.reason}`);
restoreOriginal();

// ─── 6. checkSafety refuses weights causing massive predicted drop ────────────
console.log('\n6. checkSafety refuses weights causing massive predicted drop');

writeFileSync(BASELINE_PATH, JSON.stringify({
  benchmark: { top1: 0.92 },
  weights: { name: 3.0, description: 2.0, keywords: 1.0 },
  baselineAt: '2026-01-01T00:00:00.000Z',
}), 'utf-8');
const r6 = checkSafety({ name: 0.5, description: 0.5, keywords: 0.5 }, loadBaseline());
assert(r6.action === 'refuse' || r6.action === 'revert',
  `expected refuse or revert for huge decrease, got ${r6.action}`);
restoreOriginal();

// ─── 7. evaluateOutcome returns 'accepted' when accuracy improves ─────────────
console.log('\n7. evaluateOutcome accepts accuracy improvement');

const r7 = evaluateOutcome(92.0, 93.5);
assert(r7.outcome === 'accepted', 'accepted when accuracy improves by 1.5pp');
assert(r7.reason.includes('+'), 'reason indicates improvement');

// ─── 8. evaluateOutcome returns 'reverted' when accuracy drops > 1pp ──────────
console.log('\n8. evaluateOutcome reverts on >1pp accuracy drop');

const r8 = evaluateOutcome(92.0, 90.5);
assert(r8.outcome === 'reverted', 'reverted when accuracy drops 1.5pp');
assert(r8.reason.includes('drop'), 'reason mentions drop');

// ─── 9. evaluateOutcome returns 'accepted' when accuracy drops <= 1pp ─────────
console.log('\n9. evaluateOutcome accepts <=1pp accuracy drop');

const r9 = evaluateOutcome(92.0, 91.2);
assert(r9.outcome === 'accepted', 'accepted when accuracy drops only 0.8pp');

// ─── 10. loadBaseline handles malformed JSON ──────────────────────────────────
console.log('\n10. loadBaseline handles malformed JSON');

writeFileSync(BASELINE_PATH, '{invalid json', 'utf-8');
const r10 = loadBaseline();
assert(r10 === null, 'returns null for malformed JSON');
restoreOriginal();

// ─── Summary ───────────────────────────────────────────────────────────────────
console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
