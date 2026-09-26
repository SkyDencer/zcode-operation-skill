/**
 * Corpus local scanner — walks a directory tree and turns every `SKILL.md` it
 * finds into one record.
 *
 * Part of `src/corpus/fetcher.mjs` (Sub-Phase 7.2), split out so that module
 * stays a thin public API over the three source strategies rather than a
 * 470-line file. This half knows nothing about git, about deduplication, or
 * about the importer: given a root directory it returns records, and that is
 * all.
 *
 * A record is:
 *   { name, description, keywords, domains, version, path, dir, relPath,
 *     contentHash, source, sourceRef }
 *
 * The walk is deliberately forgiving about *content* and strict about *shape*:
 * an unreadable subtree is a warning and the walk continues, but a missing
 * root throws, because a typo'd path must not look like an empty corpus.
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { parseFrontmatter } from '../loader.mjs';

/** Manifest file name that marks a skill directory. */
export const SKILL_FILE = 'SKILL.md';

/** Default recursion depth, matching `loadSkills()` in `src/loader.mjs`. */
const DEFAULT_MAX_DEPTH = 10;

/**
 * Recursively collect SKILL.md paths under a directory.
 *
 * Unreadable subdirectories are recorded in `warnings` rather than aborting the
 * walk: one broken subtree should not hide the rest of a 200-skill corpus.
 *
 * @param {string} root — absolute directory to walk
 * @param {number} maxDepth
 * @param {string[]} warnings — collected in place
 * @param {number} [depth]
 * @returns {Promise<string[]>}
 */
export async function collectSkillFiles(root, maxDepth, warnings, depth = 0) {
  const found = [];
  if (depth > maxDepth) {
    warnings.push(`depth limit ${maxDepth} reached at ${root} — subtree not scanned`);
    return found;
  }

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    warnings.push(`cannot read directory ${root}: ${err.message}`);
    return found;
  }

  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await collectSkillFiles(full, maxDepth, warnings, depth + 1)));
    } else if (entry.isFile() && entry.name === SKILL_FILE) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Read one SKILL.md and turn it into a record.
 *
 * A file that cannot be read, or whose frontmatter cannot be parsed, still
 * produces a record — with an empty name — so the validator can report it as an
 * invalid skill instead of the fetcher silently dropping it.
 *
 * @param {string} filePath
 * @param {'local' | 'git'} source
 * @param {string} sourceRef
 * @param {string} root — the directory the scan started from
 * @param {string[]} warnings
 * @returns {Promise<Object>}
 */
export async function readSkillRecord(filePath, source, sourceRef, root, warnings) {
  let content = '';
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    warnings.push(`cannot read ${filePath}: ${err.message}`);
  }

  const fm = content ? parseFrontmatter(content) : {};
  const dir = filePath.slice(0, filePath.length - (SKILL_FILE.length + 1));

  return {
    name: typeof fm.name === 'string' ? fm.name : '',
    description: typeof fm.description === 'string' ? fm.description : '',
    keywords: Array.isArray(fm.keywords) ? fm.keywords : [],
    domains: Array.isArray(fm.domains) ? fm.domains : [],
    version: typeof fm.version === 'string' ? fm.version : '',
    path: filePath,
    dir,
    relPath: relative(root, filePath).split('\\').join('/'),
    contentHash: createHash('sha256').update(content, 'utf-8').digest('hex'),
    source,
    sourceRef,
  };
}

/**
 * Scan a directory tree for `SKILL.md` files and return one record per file,
 * sorted by name then by path so two runs produce the same order.
 *
 * @param {string} dir
 * @param {Object} [opts]
 * @param {number} [opts.maxDepth] — recursion limit (default 10)
 * @param {string} [opts.source] — tag to stamp on each record (default 'local')
 * @param {string} [opts.sourceRef] — tag to stamp on each record (default the
 *   resolved root)
 * @param {string[]} [opts.warnings] — collected in place
 * @returns {Promise<Object[]>}
 * @throws when `dir` does not exist
 */
export async function scanLocal(dir, opts = {}) {
  const warnings = opts.warnings ?? [];
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const root = resolve(dir);

  if (!existsSync(root)) {
    throw new Error(`Local source not found: ${root}`);
  }

  const source = opts.source ?? 'local';
  const sourceRef = opts.sourceRef ?? root;

  const files = await collectSkillFiles(root, maxDepth, warnings);
  const records = [];
  for (const filePath of files) {
    records.push(await readSkillRecord(filePath, source, sourceRef, root, warnings));
  }

  records.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  return records;
}
