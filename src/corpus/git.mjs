/**
 * Corpus git clone — the only module in `src/corpus/` that shells out.
 *
 * Part of `src/corpus/fetcher.mjs` (Sub-Phase 7.2), split out so the clone
 * lifetime is stated in exactly one place. `cloneRepo()` **hands ownership of
 * the temporary directory to its caller**: it removes that directory only when
 * the clone itself fails, never on the success path. Deciding who owns a clone
 * is the whole difficulty here — `fetchFromGit()` releases it immediately,
 * `openSources()` hands the release function to the importer — and a helper
 * that quietly cleaned up after a successful clone is exactly what made every
 * git-sourced import fail with ENOENT.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);

/** Default git clone timeout in milliseconds. */
export const DEFAULT_CLONE_TIMEOUT_MS = 120000;

/**
 * Remove a temporary clone directory.
 *
 * Cleanup failures are reported through `warnings`, never swallowed: a leftover
 * clone under the OS temp directory is a real disk leak, and an operator who
 * does not hear about it cannot act on it.
 *
 * @param {string} parent
 * @param {string[]} warnings
 * @returns {Promise<void>}
 */
export async function removeTemp(parent, warnings) {
  try {
    await rm(parent, { recursive: true, force: true });
  } catch (err) {
    warnings.push(`could not remove temporary clone ${parent}: ${err.message}`);
  }
}

/**
 * Shallow-clone a repository into a fresh temp directory.
 *
 * On success the caller owns `parent` and must remove it (see `removeTemp()`).
 * On failure the temp directory this function created is removed before the
 * error propagates, so a failed clone never leaks either.
 *
 * @param {string} url — remote URL or a local repository path
 * @param {Object} [opts]
 * @param {string} [opts.tempRoot] — parent for the temp directory (default os.tmpdir())
 * @param {number} [opts.timeoutMs] — clone timeout (default 120000)
 * @param {string[]} [opts.warnings] — collected in place
 * @returns {Promise<{parent: string, cloneDir: string}>}
 * @throws when `git` is unavailable or the clone fails. The underlying git
 *         stderr is included in the error message.
 */
export async function cloneRepo(url, opts = {}) {
  const warnings = opts.warnings ?? [];
  const tempRoot = opts.tempRoot ?? tmpdir();
  const timeout = opts.timeoutMs ?? DEFAULT_CLONE_TIMEOUT_MS;

  // `git clone` refuses to write into an existing directory, so reserve the
  // name first and pass the bare child path to the clone.
  const parent = await mkdtemp(join(resolve(tempRoot), 'skill-router-corpus-'));
  const cloneDir = join(parent, 'repo');

  try {
    await execFileAsync(
      'git',
      [
        'clone',
        // Reproduce the committed bytes, not this machine's checkout
        // convention. With the Windows default `core.autocrlf=true` a clone
        // rewrites LF as CRLF in the working tree, so a git-sourced import
        // would write different bytes than the repository holds — and a
        // `--force` re-import on a second machine would rewrite the same skill
        // again. A corpus import has to be reproducible to be re-runnable.
        '-c', 'core.autocrlf=false',
        '-c', 'core.eol=lf',
        '--depth', '1', '--single-branch', '--quiet', url, cloneDir,
      ],
      { timeout, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
    );
  } catch (err) {
    await removeTemp(parent, warnings);
    const detail = (err.stderr || err.message || '').toString().trim();
    throw new Error(`git clone failed for ${url}: ${detail || 'unknown error'}`);
  }

  if (!existsSync(cloneDir)) {
    await removeTemp(parent, warnings);
    throw new Error(`git clone reported success but ${cloneDir} does not exist`);
  }

  return { parent, cloneDir };
}
