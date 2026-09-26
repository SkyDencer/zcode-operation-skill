/**
 * Corpus source deduplication — decides when two fetched records are the same
 * skill.
 *
 * Part of `src/corpus/fetcher.mjs` (Sub-Phase 7.2), split out because the rule
 * is subtle and was previously wrong in a way no test caught.
 *
 * The first version keyed every record by the real path of its `SKILL.md`. That
 * works for two local directories pointing at the same place, and fails for
 * everything else: each git descriptor gets its own `mkdtemp` parent, so two
 * clones of the same repository produced two different real paths and the same
 * skill was fetched — and imported — twice, with no warning at all. A local
 * directory and a clone of a repository containing it had the same problem.
 *
 * Two keys are therefore used:
 *
 *   identity — "the same file". For a local source, the real path. For a git
 *              source, the normalized repository reference plus the SKILL.md's
 *              path *within* the clone, which is stable across clones.
 *   content  — "the same skill by another route". Name plus SHA-256 of the
 *              bytes. This is what makes a local directory and a clone that
 *              contains it collapse to one record.
 *
 * The first occurrence wins and keeps its `source` / `sourceRef`, so ordering
 * is meaningful.
 */

import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Resolve a real path for deduplication, falling back to the literal path when
 * the real path cannot be read (a file removed mid-scan, a broken link).
 *
 * @param {string} p
 * @returns {Promise<string>}
 */
async function realpathOrResolve(p) {
  try {
    return await realpath(p);
  } catch {
    return resolve(p);
  }
}

/**
 * Normalize a source reference so two spellings of the same repository produce
 * one key: a local path is resolved, a remote URL is lower-cased and stripped of
 * a trailing slash and `.git`.
 *
 * @param {string} ref
 * @returns {string}
 */
export function normalizeSourceRef(ref) {
  const looksRemote = /^[a-z][a-z0-9+.-]*:\/\//i.test(ref) || ref.startsWith('git@');
  if (!looksRemote) return resolve(ref);
  return ref.trim().replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
}

/**
 * The deduplication keys for one record: always an identity key, plus a
 * content key when the record has both a name and a readable body.
 *
 * A record with no name is excluded from content matching on purpose — several
 * broken `SKILL.md` files with identical (empty) bodies are still two distinct
 * problems, and collapsing them would hide one.
 *
 * @param {{source: string, sourceRef: string, relPath: string, path: string,
 *          name: string, contentHash: string}} record
 * @returns {Promise<string[]>} one or two keys; never empty
 */
export async function dedupeKeys(record) {
  const keys = [
    record.source === 'git'
      ? `git:${normalizeSourceRef(record.sourceRef)}:${record.relPath}`
      : `local:${await realpathOrResolve(record.path)}`,
  ];
  if (record.name && record.contentHash) {
    keys.push(`content:${record.name}:${record.contentHash}`);
  }
  return keys;
}
