/**
 * Rollback validation for deploy snapshots (P6-H-014).
 *
 * The rollback path in src/deploy/writer.mjs deletes every mirror directory
 * that is not named in the snapshot and then re-creates tracked files. When
 * the snapshot is corrupt, empty, or stale, that delete loop becomes a mass
 * delete of the operator's live skill mirror. This module gives rollback a
 * pre-flight gate: a snapshot is only safe to apply when it is present,
 * parseable, non-empty relative to a non-empty mirror, and not drifted from
 * the files it tracks.
 *
 * The checks are deliberately self-contained (no import from writer.mjs) so
 * the module has a one-way dependency and stays easy to reason about. The
 * stricter field/age checks that live in writer.mjs' verifySnapshotIntegrity
 * cover a different concern (restore metadata); here we only gate the
 * destructive delete.
 *
 * @module src/deploy/rollback
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * SHA-256 of a file's content, or null when it cannot be read.
 *
 * @param {string} filePath
 * @returns {string|null}
 */
function fileHash(filePath) {
  try {
    return createHash('sha256').update(readFileSync(filePath, 'utf-8'), 'utf-8').digest('hex');
  } catch {
    return null;
  }
}

/**
 * Count the non-hidden subdirectories in a mirror root.
 *
 * These are the directories a rollback delete loop would touch; a mirror that
 * holds any of them makes an empty snapshot's files[] list dangerous.
 *
 * @param {string} mirrorRoot
 * @returns {number}
 */
function countMirrorDirs(mirrorRoot) {
  if (!mirrorRoot || !existsSync(mirrorRoot)) return 0;
  let n = 0;
  for (const entry of readdirSync(mirrorRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) n += 1;
  }
  return n;
}

/**
 * @typedef {object} RollbackValidation
 * @property {boolean} ok — true when the snapshot is safe to roll back to
 * @property {string[]} reasons — human-readable refusal reasons (empty when ok)
 * @property {object|null} snapshot — the parsed snapshot, null when unreadable
 */

/**
 * Validate a deploy snapshot before a rollback is allowed to run.
 *
 * A snapshot is rejected (ok === false) when any of:
 *   - the file does not exist, is not valid JSON, or lacks a files[] array;
 *   - files[] is empty while the mirror still holds directories (the delete
 *     loop would wipe the whole mirror — a mass delete);
 *   - a tracked file that still exists no longer matches its recorded hash
 *     (the mirror drifted since the snapshot, so rolling back would clobber
 *     newer state).
 *
 * @param {string} snapshotPath — path to the snapshot JSON
 * @param {string} mirrorRoot — the mirror the rollback would be applied to
 * @returns {RollbackValidation}
 */
export function validateForRollback(snapshotPath, mirrorRoot) {
  if (!snapshotPath || !existsSync(snapshotPath)) {
    return { ok: false, reasons: [`snapshot file does not exist: ${snapshotPath}`], snapshot: null };
  }

  /** @type {object|null} */
  let snapshot = null;
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
  } catch (err) {
    return { ok: false, reasons: [`snapshot is not valid JSON: ${err.message}`], snapshot: null };
  }

  if (!snapshot || !Array.isArray(snapshot.files)) {
    return { ok: false, reasons: ['snapshot is missing the files[] array'], snapshot };
  }

  const reasons = [];

  // Mass-delete guard: an empty files[] against a live mirror.
  const mirrorDirs = countMirrorDirs(mirrorRoot);
  if (snapshot.files.length === 0 && mirrorDirs > 0) {
    reasons.push(
      `snapshot records 0 files but the mirror holds ${mirrorDirs} director${mirrorDirs === 1 ? 'y' : 'ies'}; ` +
        'refusing a mass delete'
    );
  }

  // Drift guard: tracked files that still exist must match their recorded hash.
  let drift = 0;
  for (const f of snapshot.files) {
    if (!f || typeof f.path !== 'string' || !f.path) continue;
    if (f.hash === null || f.hash === undefined) continue; // nothing recorded to verify
    const full = join(mirrorRoot, f.path);
    if (!existsSync(full)) continue; // expected to be re-created, not a drift
    const current = fileHash(full);
    if (current === null) continue; // unreadable file is not a verified mismatch
    if (current !== f.hash) drift += 1;
  }
  if (drift > 0) {
    reasons.push(
      `${drift} tracked file(s) differ from the recorded snapshot hash ` +
        '(the mirror drifted since the snapshot was taken)'
    );
  }

  return { ok: reasons.length === 0, reasons, snapshot };
}
