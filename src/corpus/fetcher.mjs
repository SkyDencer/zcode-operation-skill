/**
 * Corpus fetcher — the public API for discovering `SKILL.md` files in external
 * skill sources. Sub-phase 7.2.
 *
 * Two source types are supported:
 *   - `local` — a directory on disk, scanned recursively for `SKILL.md`.
 *   - `git`   — a repository URL or local repository path, shallow-cloned
 *               into a temp directory and then scanned as a local directory.
 *
 * The fetcher never parses or judges the manifests; it only locates them and
 * returns one record per SKILL.md. Judgement lives in `src/corpus/validator.mjs`
 * and copying lives in `src/corpus/importer.mjs`. The scanning, cloning and
 * deduplication mechanics live in `scan.mjs`, `git.mjs` and `dedupe.mjs`.
 *
 * ── Clone lifetime ──────────────────────────────────────────────────────────
 * A git clone lives in a temporary directory, which creates exactly one hazard:
 * a function that removes the clone before returning hands back records whose
 * `path` and `dir` point at a directory that no longer exists, so anything that
 * reads those records afterwards fails with ENOENT. The three entry points
 * below differ *only* in who owns the clone:
 *
 *   `fetchFromGit(url, opts)`  — clone, scan, remove. Records are **metadata
 *                                only**; `path`/`dir` are dead on return. Fine
 *                                for a listing, unusable for a copy.
 *   `openSources(...)`         — clone, scan, keep. Returns `{ records,
 *                                release() }`; the caller **must** `release()`
 *                                when it has finished reading. This is what
 *                                `importSkills()` uses, so the copy happens
 *                                while the clone is still on disk.
 *   `fetchFromSources(...)`    — `openSources()` plus an immediate `release()`,
 *                                i.e. the `fetchFromGit()` contract applied to
 *                                a list of sources.
 *
 * Failures are loud: a missing directory, an unreadable entry, a failed clone
 * or a missing `git` binary all throw or are collected into `warnings` and
 * reported. Nothing is swallowed.
 */

import { SKILL_FILE, scanLocal } from './scan.mjs';
import { cloneRepo, removeTemp } from './git.mjs';
import { dedupeKeys } from './dedupe.mjs';

export { SKILL_FILE, cloneRepo, removeTemp };

/**
 * @typedef {Object} FetchedSkill
 * @property {string} name
 * @property {string} description
 * @property {string[]} keywords
 * @property {string[]} domains
 * @property {string} version
 * @property {string} path — absolute path to the SKILL.md
 * @property {string} dir — absolute path to the directory holding the SKILL.md
 * @property {string} relPath — SKILL.md path relative to the source root, `/`-separated
 * @property {string} contentHash — SHA-256 of the SKILL.md text
 * @property {'local' | 'git'} source
 * @property {string} sourceRef — the directory or URL it was fetched from
 */

/**
 * @typedef {Object} FetchOptions
 * @property {number} [maxDepth] — recursion depth limit (default 10)
 * @property {string} [tempRoot] — parent for the temporary clone directory
 * @property {number} [timeoutMs] — git clone timeout (default 120000)
 * @property {string[]} [warnings] — collected non-fatal problems
 */

/**
 * @typedef {Object} SourceDescriptor
 * @property {'local' | 'git'} type
 * @property {string} [path] — directory, when type is 'local'
 * @property {string} [url] — repository URL or path, when type is 'git'
 */

/**
 * @typedef {Object} OpenSources
 * @property {FetchedSkill[]} records
 * @property {() => Promise<void>} release — removes every temporary clone
 */

/**
 * Normalize a source descriptor. A bare string is accepted as shorthand for
 * `{ type: 'local', path }`, which is what the CLI passes for a plain argument.
 *
 * @param {SourceDescriptor|string} source
 * @returns {SourceDescriptor}
 */
export function normalizeSource(source) {
  if (typeof source === 'string') return { type: 'local', path: source };

  if (!source || typeof source !== 'object') {
    throw new Error('Source descriptor must be a string or an object');
  }
  if (source.type !== 'local' && source.type !== 'git') {
    throw new Error(
      `Unknown source type "${source.type}" — expected "local" or "git"`,
    );
  }
  if (source.type === 'local' && !source.path) {
    throw new Error('Local source descriptor requires a "path"');
  }
  if (source.type === 'git' && !source.url) {
    throw new Error('Git source descriptor requires a "url"');
  }
  return source;
}

/**
 * Fetch every SKILL.md under a local directory.
 *
 * @param {string} dir
 * @param {FetchOptions} [opts]
 * @returns {Promise<FetchedSkill[]>} sorted by name, then by path
 * @throws when `dir` does not exist
 */
export async function fetchFromLocal(dir, opts = {}) {
  return scanLocal(dir, opts);
}

/**
 * Scan a live clone directory and tag its records as git-sourced.
 *
 * @param {string} cloneDir
 * @param {string} url
 * @param {FetchOptions} opts
 * @returns {Promise<FetchedSkill[]>}
 */
async function scanClone(cloneDir, url, opts) {
  return scanLocal(cloneDir, { ...opts, source: 'git', sourceRef: url });
}

/**
 * Fetch every SKILL.md from a git repository, then delete the clone.
 *
 * Shallow-clones (`--depth 1 --single-branch`) into a fresh temp directory,
 * delegates to `fetchFromLocal()`, and removes the temp directory in a
 * `finally` block — on the success path and on every failure path.
 *
 * **Contract: the returned records are metadata only.** Their `path` and `dir`
 * point inside a directory that no longer exists once this function resolves.
 * That is fine for a listing and fatal for a copy. Anything that needs to read
 * or copy the bytes must use `openSources()` instead.
 *
 * @param {string} url — remote URL or a local repository path
 * @param {FetchOptions} [opts]
 * @returns {Promise<FetchedSkill[]>}
 * @throws when `git` is unavailable, the clone fails, or the clone yields no
 *         readable directory. The underlying git stderr is included in the error.
 */
export async function fetchFromGit(url, opts = {}) {
  const warnings = opts.warnings ?? [];
  const { parent, cloneDir } = await cloneRepo(url, opts);
  try {
    return await scanClone(cloneDir, url, { ...opts, warnings });
  } finally {
    await removeTemp(parent, warnings);
  }
}

/**
 * True when a `sources` entry is already a fetched record rather than a
 * descriptor — one read back from a fetch manifest, carrying its own files.
 *
 * @param {unknown} raw
 * @returns {boolean}
 */
function isPreFetchedRecord(raw) {
  return Boolean(
    raw && typeof raw === 'object' && !('type' in raw) && raw.files && typeof raw.files === 'object',
  );
}

/**
 * Fetch every source and keep the temporary clones alive until `release()`.
 *
 * This is the entry point for anything that reads the fetched bytes. The caller
 * owns the clones and must call `release()` when it is done — normally in a
 * `finally` block wrapped around the work, as `importSkills()` does.
 *
 * A `sources` entry is normally a descriptor (a bare string is shorthand for a
 * local directory). An entry that is already a record — an object carrying a
 * `files` map and no `type`, i.e. one read back from a fetch manifest — is
 * passed through untouched: it has no directory to open and no clone to make,
 * and its bytes travel with it.
 *
 * @param {Array<SourceDescriptor|Object|string>} sources
 * @param {FetchOptions} [opts]
 * @returns {Promise<OpenSources>}
 */
export async function openSources(sources, opts = {}) {
  if (!Array.isArray(sources)) {
    throw new Error('openSources() requires an array of source descriptors');
  }

  const warnings = opts.warnings ?? [];
  /** @type {string[]} */
  const parents = [];
  const seen = new Map();
  const all = [];

  const release = async () => {
    while (parents.length > 0) {
      await removeTemp(parents.pop(), warnings);
    }
  };

  try {
    for (const raw of sources) {
      let records;
      if (isPreFetchedRecord(raw)) {
        // A record that already carries its files (a manifest record) has
        // nothing to open and nothing to clone.
        records = [raw];
      } else {
        const source = normalizeSource(raw);
        if (source.type === 'git') {
          const { parent, cloneDir } = await cloneRepo(source.url, opts);
          parents.push(parent);
          records = await scanClone(cloneDir, source.url, { ...opts, warnings });
        } else {
          records = await fetchFromLocal(source.path, opts);
        }
      }

      for (const record of records) {
        const keys = await dedupeKeys(record);
        const duplicateOf = keys.map((k) => seen.get(k)).find((v) => v !== undefined);
        if (duplicateOf !== undefined) {
          warnings.push(
            `duplicate skill skipped: ${record.path} already fetched from ${duplicateOf}`,
          );
          continue;
        }
        for (const key of keys) seen.set(key, record.sourceRef);
        all.push(record);
      }
    }
  } catch (err) {
    // A throw halfway through must not strand the clones already made.
    await release();
    throw err;
  }

  all.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  return { records: all, release };
}

/**
 * Fetch from several sources at once, deduplicate, and delete the clones before
 * returning.
 *
 * Same contract as `fetchFromGit()`: the returned records are metadata only.
 * Two records are the same skill when they are the same file, or the same name
 * with the same bytes, so overlapping sources (a local directory listed twice,
 * a clone of a repository that contains it) collapse to one entry. The first
 * occurrence wins and keeps its `source` / `sourceRef`, so ordering is
 * meaningful, and every dropped duplicate is pushed into `opts.warnings` as
 * `duplicate skill skipped: <path> already fetched from <ref>`.
 *
 * @param {Array<SourceDescriptor|string>} sources
 * @param {FetchOptions} [opts]
 * @returns {Promise<FetchedSkill[]>}
 */
export async function fetchFromSources(sources, opts = {}) {
  const { records, release } = await openSources(sources, opts);
  try {
    return records;
  } finally {
    await release();
  }
}
