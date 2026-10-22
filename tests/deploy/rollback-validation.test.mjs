/**
 * P6-H-014 (Sub-Phase A.3) — rollback validation for deploy snapshots.
 *
 * The rollback delete loop removes every mirror directory that is not named
 * in the snapshot. A corrupt, empty, or stale snapshot therefore becomes a
 * mass delete of the operator's live skill mirror. This test verifies the
 * pre-flight gate added by src/deploy/rollback.mjs:
 *
 *   - a valid snapshot (files match the live mirror) → rollback proceeds
 *   - a missing snapshot file                        → refused, nothing touched
 *   - a drifted snapshot (a tracked file changed)     → refused, nothing touched
 *   - an empty snapshot against a live mirror         → refused (mass-delete guard)
 *   - --force-rollback semantics (force: true)       → the gate is bypassed
 *
 * It exercises both validateForRollback directly and the gated rollbackMirror
 * / restoreFromSnapshot entry points in src/deploy/writer.mjs.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { validateForRollback } from '../../src/deploy/rollback.mjs';
import { rollbackMirror, restoreFromSnapshot } from '../../src/deploy/writer.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'sr-rollback-validation-'));
const MIRROR = join(TMP, 'mirror');
const SNAP_DIR = join(TMP, 'snapshots');

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

const hash = (s) => createHash('sha256').update(s, 'utf-8').digest('hex');

function makeMirror() {
  rmSync(MIRROR, { recursive: true, force: true });
  mkdirSync(join(MIRROR, 'router-a'), { recursive: true });
  mkdirSync(join(MIRROR, 'router-b'), { recursive: true });
  writeFileSync(join(MIRROR, 'router-a', 'SKILL.md'), 'CONTENT-A', 'utf-8');
  writeFileSync(join(MIRROR, 'router-b', 'SKILL.md'), 'CONTENT-B', 'utf-8');
  writeFileSync(join(MIRROR, 'router-a', '.skill-router-meta.json'), '{}', 'utf-8');
  writeFileSync(join(MIRROR, 'router-b', '.skill-router-meta.json'), '{}', 'utf-8');
}

/** Write a snapshot file with the given files[] and return its path. */
function writeSnapshot(name, files) {
  mkdirSync(SNAP_DIR, { recursive: true });
  const snap = {
    timestamp: new Date().toISOString(),
    mirrorRoot: MIRROR,
    operations: files.map((f) => ({ action: 'keep', path: f.path.split('/')[0] })),
    files,
  };
  const p = join(SNAP_DIR, name);
  writeFileSync(p, JSON.stringify(snap, null, 2), 'utf-8');
  return p;
}

const validFiles = [
  { path: 'router-a/SKILL.md', hash: hash('CONTENT-A') },
  { path: 'router-b/SKILL.md', hash: hash('CONTENT-B') },
];

makeMirror();
const validSnap = writeSnapshot('valid.json', validFiles);

console.log('\n=== Rollback validation (P6-H-014) ===\n');

// 1. Valid snapshot → rollback proceeds.
console.log('1. Valid snapshot proceeds');
const okValid = validateForRollback(validSnap, MIRROR);
assert(okValid.ok === true, `valid snapshot passes the gate (reasons: ${JSON.stringify(okValid.reasons)})`);
const rbValid = rollbackMirror(MIRROR, validSnap, {});
assert(rbValid.ok === true, 'rollbackMirror proceeds on a valid snapshot');

// 2. Missing snapshot file → refused, mirror untouched.
console.log('\n2. Missing snapshot is refused');
const missing = validateForRollback(join(SNAP_DIR, 'nope.json'), MIRROR);
assert(missing.ok === false, 'missing file fails the gate');
assert(missing.reasons.join(' ').includes('does not exist'), 'reason names the missing file');
const rbMissing = rollbackMirror(MIRROR, join(SNAP_DIR, 'nope.json'), {});
assert(rbMissing.ok === false && rbMissing.deleted === 0, 'rollbackMirror refuses and deletes nothing');
assert(existsSync(join(MIRROR, 'router-a')) && existsSync(join(MIRROR, 'router-b')),
  'mirror is untouched after a missing-file refusal');

// 3. Drifted snapshot (a tracked file changed) → refused, mirror untouched.
console.log('\n3. Drifted snapshot is refused');
writeFileSync(join(MIRROR, 'router-a', 'SKILL.md'), 'CHANGED-A', 'utf-8');
const drift = validateForRollback(validSnap, MIRROR);
assert(drift.ok === false, 'hash drift fails the gate');
assert(drift.reasons.join(' ').includes('differ from the recorded snapshot hash'),
  'reason names the drifted files');
const rbDrift = rollbackMirror(MIRROR, validSnap, {});
assert(rbDrift.ok === false, 'rollbackMirror refuses a drifted snapshot');
assert(readFileSync(join(MIRROR, 'router-a', 'SKILL.md'), 'utf-8') === 'CHANGED-A',
  'the drifted file was NOT clobbered by a refused rollback');
const rsDrift = restoreFromSnapshot(validSnap, MIRROR);
assert(rsDrift.success === false, 'restoreFromSnapshot also refuses the drifted snapshot');

// 4. Empty snapshot against a live mirror → refused (mass-delete guard).
console.log('\n4. Empty snapshot against a live mirror is refused');
writeFileSync(join(MIRROR, 'router-a', 'SKILL.md'), 'CONTENT-A', 'utf-8'); // undo the drift
const emptySnap = writeSnapshot('empty.json', []);
const emptyCheck = validateForRollback(emptySnap, MIRROR);
assert(emptyCheck.ok === false, 'empty files[] against a live mirror fails the gate');
assert(emptyCheck.reasons.join(' ').includes('mass delete'), 'reason names the mass-delete guard');
const rbEmpty = rollbackMirror(MIRROR, emptySnap, {});
assert(rbEmpty.ok === false && rbEmpty.deleted === 0, 'rollbackMirror refuses and deletes nothing');
assert(existsSync(join(MIRROR, 'router-a')) && existsSync(join(MIRROR, 'router-b')),
  'both mirror dirs survived the empty-snapshot refusal');

// 5. --force-rollback semantics: the gate is bypassed and the rollback runs.
console.log('\n5. force bypasses the gate');
writeFileSync(join(MIRROR, 'router-a', 'SKILL.md'), 'CHANGED-A', 'utf-8'); // re-introduce drift
const forced = rollbackMirror(MIRROR, validSnap, { force: true });
assert(forced.ok === true && forced.forced === true, 'force=true proceeds past a drifted snapshot');
assert(forced.deleted === 0, 'no dirs were deleted (all dirs are in the snapshot)');
assert(existsSync(join(MIRROR, 'router-a')), 'the tracked dir was re-created by the forced rollback');

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

// Clean up
rmSync(TMP, { recursive: true, force: true });
if (failed > 0) process.exit(1);
