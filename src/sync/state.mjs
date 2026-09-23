/**
 * Sync state — read/write .skill-router-sync-state.json in the project root.
 *
 * Tracks the last sync timestamp, which skills were synced, and the hash
 * of each synced skill at the time of the last sync.
 *
 * Format:
 *   {
 *     "lastSyncAt": "2026-09-22T12:00:00.000Z",
 *     "mirrorPath": "/path/to/zcode/skills",
 *     "skills": {
 *       "backend-eloquent": { "hash": "abc123...", "syncedAt": "..." },
 *       ...
 *     }
 *   }
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SkillStateEntry
 * @property {string} hash      — SHA-256 hash of the synced SKILL.md
 * @property {string} syncedAt  — ISO timestamp of when the skill was last synced
 */

/**
 * @typedef {Object} SyncState
 * @property {string}                            lastSyncAt — ISO timestamp of last full sync
 * @property {string | null}                     mirrorPath — absolute path to the ZCode mirror
 * @property {Record<string, SkillStateEntry>}   skills     — per-skill hash + timestamp
 */

// ── Constants ──────────────────────────────────────────────────────────────────

const STATE_FILENAME = '.skill-router-sync-state.json';
const DEFAULT_PROJECT_ROOT = process.cwd();

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Read the current sync state, or return an empty state if none exists.
 *
 * @param {string} [projectRoot] — absolute path to the project root
 * @returns {SyncState}
 */
export function readSyncState(projectRoot = DEFAULT_PROJECT_ROOT) {
  const statePath = join(resolve(projectRoot), STATE_FILENAME);
  if (!existsSync(statePath)) {
    return { lastSyncAt: null, mirrorPath: null, skills: {} };
  }
  try {
    return JSON.parse(readFileSync(statePath, 'utf-8'));
  } catch {
    // Malformed JSON — return empty state
    return { lastSyncAt: null, mirrorPath: null, skills: {} };
  }
}

/**
 * Write (overwrite) the sync state file.
 *
 * @param {SyncState} state
 * @param {string}    [projectRoot] — absolute path to the project root
 */
export function writeSyncState(state, projectRoot = DEFAULT_PROJECT_ROOT) {
  const statePath = join(resolve(projectRoot), STATE_FILENAME);
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

/**
 * Merge a sync result into the state file.
 *
 * This updates lastSyncAt, mirrorPath, and each skill's hash + timestamp.
 * Removed skills are deleted from the state.
 *
 * @param {SyncState}  state        — current state (will not be mutated; returns new object)
 * @param {Object}     syncResult   — object with { add, update, remove, unchanged, mirrorPath }
 *                                    each value is an array of { name, hash } entries
 * @param {string}     [projectRoot]
 * @returns {SyncState} the updated state
 */
export function mergeSyncResult(state, syncResult, projectRoot = DEFAULT_PROJECT_ROOT) {
  const now = new Date().toISOString();
  const merged = {
    ...state,
    lastSyncAt: now,
    mirrorPath: syncResult.mirrorPath ?? state.mirrorPath,
    skills: { ...state.skills },
  };

  // Remove entries for skills that were removed
  if (syncResult.remove) {
    for (const entry of syncResult.remove) {
      delete merged.skills[entry.name];
    }
  }

  // Update / add entries for all non-removed skills
  const allEntries = [
    ...(syncResult.add ?? []),
    ...(syncResult.update ?? []),
    ...(syncResult.unchanged ?? []),
  ];

  for (const entry of allEntries) {
    merged.skills[entry.name] = {
      hash: entry.hash,
      syncedAt: now,
    };
  }

  writeSyncState(merged, projectRoot);
  return merged;
}

// ── CLI entry point ────────────────────────────────────────────────────────────

const _cliArgv1 = process.argv[1]?.replace(/\\/g, '/') ?? '';
if (_cliArgv1 && import.meta.url.endsWith(_cliArgv1)) {
  console.log('This module is not meant to be run directly. Use: node bin/skill-router.mjs sync');
  process.exit(1);
}
