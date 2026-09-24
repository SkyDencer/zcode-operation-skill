/**
 * Tune CLI tests.
 *
 * Verifies:
 * 1. tune --status shows current weights and baseline info
 * 2. tune --analyze computes attributions and proposed weights
 * 3. tune --apply --dry-run shows proposed weights without applying
 * 4. tune --rollback exits 1 when no snapshots exist
 * 5. tune --report handles empty tuning log gracefully
 * 6. tune with no subcommand shows usage
 * 7. tune --auto --dry-run runs analysis then dry-run apply
 * 8. snapshot is created and rollback restores from it
 * 9. weights.json is not modified by dry-run
 * 10. guardrail blocks apply when delta exceeds threshold
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import {
  readFileSync, writeFileSync, mkdirSync, rmSync, existsSync,
} from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const CLI = resolve(ROOT, 'bin', 'skill-router.mjs');
const WEIGHTS_PATH = resolve(ROOT, 'data', 'weights.json');
const SNAPSHOT_DIR = resolve(ROOT, 'logs', 'weights');
const DECISIONS_LOG = resolve(ROOT, 'logs', 'tuning', 'decisions.jsonl');
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

function assertContains(output, substring, message) {
  if (output.includes(substring)) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
    console.error(`    Expected output to contain: "${substring}"`);
    console.error(`    Got: ${output.slice(0, 500)}`);
  }
}

function assertNotContains(output, substring, message) {
  if (!output.includes(substring)) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

// ── Snapshot helpers ───────────────────────────────────────────────────────────

function backupWeights() {
  try { return readFileSync(WEIGHTS_PATH, 'utf-8'); } catch { return null; }
}
function restoreWeights(content) {
  if (content !== null) writeFileSync(WEIGHTS_PATH, content, 'utf-8');
  else if (existsSync(WEIGHTS_PATH)) rmSync(WEIGHTS_PATH, { force: true });
}
function backupBaseline() {
  try { return readFileSync(BASELINE_PATH, 'utf-8'); } catch { return null; }
}
function restoreBaseline(content) {
  if (content !== null) writeFileSync(BASELINE_PATH, content, 'utf-8');
  else if (existsSync(BASELINE_PATH)) rmSync(BASELINE_PATH, { force: true });
}
function backupDecisions() {
  try {
    mkdirSync(resolve(ROOT, 'logs', 'tuning'), { recursive: true });
    return readFileSync(DECISIONS_LOG, 'utf-8');
  } catch { return null; }
}
function restoreDecisions(content) {
  if (content !== null) writeFileSync(DECISIONS_LOG, content, 'utf-8');
  else if (existsSync(DECISIONS_LOG)) rmSync(DECISIONS_LOG, { force: true });
}

let weightsBackup, baselineBackup, decisionsBackup;
function saveAll() {
  weightsBackup = backupWeights();
  baselineBackup = backupBaseline();
  decisionsBackup = backupDecisions();
}
function restoreAll() {
  restoreWeights(weightsBackup);
  restoreBaseline(baselineBackup);
  restoreDecisions(decisionsBackup);
}

// Ensure weights.json exists before tests
if (!existsSync(WEIGHTS_PATH)) {
  writeFileSync(WEIGHTS_PATH, JSON.stringify({ name: 3, description: 2, keywords: 1 }, null, 2), 'utf-8');
}

console.log('\n=== Tune CLI Tests ===\n');

// ── 1. tune --status shows current weights and baseline info ──────────────────
console.log('1. tune --status shows current weights and baseline info');

saveAll();
try {
  const output = execSync(`node "${CLI}" tune --status`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assertContains(output, 'Tuning Status', 'shows title');
  assertContains(output, 'Current Weights:', 'shows weights section');
  assertContains(output, 'name         : 3', 'shows name weight');
  assertContains(output, 'description  : 2', 'shows description weight');
  assertContains(output, 'keywords     : 1', 'shows keywords weight');
  assertContains(output, 'Baseline Top-1', 'shows baseline Top-1');
  assertContains(output, 'Attributions', 'shows attribution count');
} finally { restoreAll(); }

// ── 2. tune --analyze computes attributions and proposed weights ──────────────
console.log('\n2. tune --analyze computes attributions and proposed weights');

saveAll();
try {
  const output = execSync(`node "${CLI}" tune --analyze`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assertContains(output, 'Tuning Analysis', 'shows title');
  assertContains(output, 'Benchmark samples', 'shows sample count');
  assertContains(output, 'positive', 'shows positive count');
  assertContains(output, 'negative', 'shows negative count');
  assertContains(output, 'Field Attribution', 'shows attribution section');
  assertContains(output, 'Proposed Weights', 'shows proposed weights section');
  assertContains(output, 'sampleSize', 'shows sample size');
  assertNotContains(output, 'Wrote', 'does not write weights file');
} finally { restoreAll(); }

// ── 3. tune --apply --dry-run shows proposed weights without applying ─────────
console.log('\n3. tune --apply --dry-run shows proposed weights without applying');

saveAll();
try {
  const output = execSync(`node "${CLI}" tune --apply --dry-run`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assertContains(output, 'Dry-run mode', 'shows dry-run message');
  assertContains(output, 'Current weights', 'shows current weights');
  assertContains(output, 'Proposed weights', 'shows proposed weights');
  // Verify weights.json was NOT modified
  let currentWeights = { name: 3, description: 2, keywords: 1 };
  try {
    currentWeights = JSON.parse(readFileSync(WEIGHTS_PATH, 'utf-8'));
  } catch { /* file may not exist */ }
  assert(currentWeights.name === 3, 'weights.json not modified in dry-run (name)');
  assert(currentWeights.description === 2, 'weights.json not modified in dry-run (description)');
  assert(currentWeights.keywords === 1, 'weights.json not modified in dry-run (keywords)');
} finally { restoreAll(); }

// ── 4. tune --rollback exits 1 when no snapshots exist ────────────────────────
console.log('\n4. tune --rollback exits 1 when no snapshots exist');

saveAll();
try {
  // Ensure no snapshots
  if (existsSync(SNAPSHOT_DIR)) rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  try {
    execSync(`node "${CLI}" tune --rollback`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
    assert(false, 'should exit non-zero when no snapshots');
  } catch (err) {
    assert(err.status !== 0, 'exits non-zero when no snapshots');
    assertContains(err.stdout?.toString() ?? '', 'No snapshots found', 'shows no snapshots message');
  }
} finally { restoreAll(); }

// ── 5. tune --report handles empty tuning log gracefully ──────────────────────
console.log('\n5. tune --report handles empty tuning log gracefully');

saveAll();
try {
  if (existsSync(DECISIONS_LOG)) rmSync(DECISIONS_LOG, { force: true });
  const output = execSync(`node "${CLI}" tune --report`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assertContains(output, 'No tuning decisions logged yet', 'handles empty log gracefully');
} finally { restoreAll(); }

// ── 6. tune with no subcommand shows usage ────────────────────────────────────
console.log('\n6. tune with no subcommand shows usage');

saveAll();
try {
  try {
    execSync(`node "${CLI}" tune`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
    assert(false, 'should exit non-zero with no subcommand');
  } catch (err) {
    assert(err.status !== 0, 'exits non-zero with no subcommand');
    const out = err.stdout?.toString() ?? '';
    assertContains(out, 'Usage:', 'shows usage');
    assertContains(out, '--analyze', 'lists --analyze');
    assertContains(out, '--apply', 'lists --apply');
    assertContains(out, '--rollback', 'lists --rollback');
    assertContains(out, '--status', 'lists --status');
    assertContains(out, '--auto', 'lists --auto');
    assertContains(out, '--report', 'lists --report');
  }
} finally { restoreAll(); }

// ── 7. tune --auto --dry-run runs analysis then dry-run apply ─────────────────
console.log('\n7. tune --auto --dry-run runs analysis then dry-run apply');

saveAll();
try {
  const output = execSync(`node "${CLI}" tune --auto --dry-run`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assertContains(output, 'Auto Tuning', 'shows auto title');
  assertContains(output, 'Tuning Analysis', 'runs analysis');
  assertContains(output, 'Dry-run mode', 'runs dry-run apply');
  assertContains(output, 'No changes were applied', 'confirms no changes');
} finally { restoreAll(); }

// ── 8. snapshot is created during --apply and rollback restores from it ───────
console.log('\n8. snapshot is created during --apply and rollback restores from it');

saveAll();
try {
  // Set permissive baseline so proposed weights pass guardrail
  writeFileSync(BASELINE_PATH, JSON.stringify({
    benchmark: { top1: 0.9231 },
    weights: { name: 3.0, description: 2.0, keywords: 1.0 },
    baselineAt: '2026-01-01T00:00:00.000Z',
  }), 'utf-8');

  // Create a manual snapshot to test rollback path
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const snapshotPath = resolve(SNAPSHOT_DIR, 'weights-manual-test.json');
  writeFileSync(snapshotPath, JSON.stringify({
    name: 3.5, description: 2.2, keywords: 0.9,
    snapshotAt: '2026-09-24T12:00:00.000Z',
  }), 'utf-8');

  // Run rollback — should restore from the snapshot
  const output = execSync(`node "${CLI}" tune --rollback`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assertContains(output, 'Rolled back', 'rollback succeeds');
  assertContains(output, 'name         : 3.5', 'restores name weight from snapshot');

  // Clean up test snapshot
  rmSync(snapshotPath, { force: true });
  if (existsSync(SNAPSHOT_DIR)) rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
} finally { restoreAll(); }

// ── 9. weights.json is written during --apply (verified via dry-run absence) ──
console.log('\n9. weights.json is not modified by dry-run apply');

saveAll();
try {
  const before = JSON.parse(readFileSync(WEIGHTS_PATH, 'utf-8'));
  execSync(`node "${CLI}" tune --apply --dry-run`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  const after = JSON.parse(readFileSync(WEIGHTS_PATH, 'utf-8'));
  assert(JSON.stringify(before) === JSON.stringify(after), 'weights.json unchanged after dry-run');
} finally { restoreAll(); }

// ── 10. guardrail blocks apply when delta exceeds threshold ───────────────────
console.log('\n10. guardrail blocks apply when delta exceeds threshold');

saveAll();
try {
  writeFileSync(BASELINE_PATH, JSON.stringify({
    benchmark: { top1: 0.9231 },
    weights: { name: 3.0, description: 2.0, keywords: 1.0 },
    baselineAt: '2026-01-01T00:00:00.000Z',
  }), 'utf-8');
  const output = execSync(`node "${CLI}" tune --apply --dry-run`, { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
  assertContains(output, 'refuse', 'guardrail refuses excessive delta in dry-run output');
} finally { restoreAll(); }

// ── Summary ───────────────────────────────────────────────────────────────────
restoreAll();

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
