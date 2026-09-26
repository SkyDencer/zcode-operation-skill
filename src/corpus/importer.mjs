/**
 * Corpus importer — copies validated external skills into a target skills tree.
 *
 * Sub-phase 7.2. The write half of the corpus pipeline:
 *
 *   fetch (src/corpus/fetcher.mjs) -> validate (src/corpus/validator.mjs)
 *     -> importSkills() (here)
 *
 * Behaviour:
 *   - Every fetched skill is validated first. An invalid skill is `rejected`
 *     and nothing is written for it.
 *   - A skill whose target already exists is `skipped`, never overwritten,
 *     unless `opts.force` is true. This is the guard that makes a 200-skill
 *     import safe to re-run.
 *   - The target directory is derived from the skill `name`, exactly as
 *     `src/import/importer.mjs` does: `backend-eloquent` lands in
 *     `<target>/backend/eloquent/SKILL.md`.
 *   - The whole skill directory is copied, not just SKILL.md, so a skill that
 *     ships `references/` or `scripts/` keeps them.
 *   - A JSON report is written to `logs/corpus-import-YYYY-MM-DD.json`.
 *
 * Sources are opened with `openSources()` rather than `fetchFromSources()`.
 * The difference is the clone lifetime: a git source is only readable while its
 * temporary clone exists, and the copy happens *here*, after the fetch
 * resolves. Fetching through the metadata-only entry point and copying
 * afterwards read files out of a directory that had already been deleted, so
 * every git-sourced skill was rejected with ENOENT. The clone is released in a
 * `finally` that wraps the whole copy, so it is removed on every path.
 *
 * A record may instead come from a fetch manifest
 * (`src/corpus/manifest.mjs`), in which case it carries `files`/`content` and no
 * live directory. Those are written out directly, with each relative path
 * re-checked for containment.
 *
 * The skill `name` is untrusted frontmatter that becomes a directory path, so
 * it is checked with `isSafeName()` and the resolved target is checked with
 * `isWithinRoot()` before anything is written. This is the same containment
 * rule the Phase 6 audit applied to `src/import/importer.mjs`.
 */

import { mkdir, readdir, copyFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openSources, fetchFromLocal } from './fetcher.mjs';
import { SKILL_FILE } from './scan.mjs';
import { validateSkill, validateSkillContent, validateSkills } from './validator.mjs';
import { isSafeName, isWithinRoot } from '../utils/fs.mjs';

/** Default target skills directory. */
export const DEFAULT_TARGET_DIR = 'data/skills';

/** Directory the import report is written to. */
export const REPORT_DIR = 'logs';

/**
 * @typedef {Object} ImportOptions
 * @property {boolean} [force] — overwrite an existing skill (default false)
 * @property {string} [reportDir] — where the JSON report goes (default logs/)
 * @property {string} [date] — report date stamp, YYYY-MM-DD (default today)
 * @property {number} [maxDepth] — fetch recursion depth
 * @property {string} [tempRoot] — parent for temporary git clones
 * @property {boolean} [writeReport] — set false to skip the report file
 */

/**
 * @typedef {Object} Issue
 * @property {string} field
 * @property {string} message
 */

/**
 * @typedef {Object} ImportItem
 * @property {string} name
 * @property {'imported' | 'overwritten' | 'rejected' | 'skipped'} status
 * @property {string} sourcePath
 * @property {string} [targetPath]
 * @property {Issue[]} [issues]
 */

/**
 * @typedef {Object} ImportReport
 * @property {string} date
 * @property {string} targetDir
 * @property {boolean} force
 * @property {number} total
 * @property {number} imported
 * @property {number} overwritten
 * @property {number} rejected
 * @property {number} skipped
 * @property {string[]} warnings
 * @property {ImportItem[]} items
 */

/**
 * YYYY-MM-DD stamp for a date, in local time so the report name matches the
 * operator's own calendar day.
 *
 * @param {Date} [date]
 * @returns {string}
 */
export function dateStamp(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Resolve the directory a skill name maps to inside the target tree.
 * `backend-eloquent` -> `<target>/backend/eloquent`.
 *
 * @param {string} name
 * @param {string} targetRoot — absolute, already resolved
 * @returns {string | null} null when the name is unsafe or escapes the root
 */
export function resolveTargetDir(name, targetRoot) {
  if (!isSafeName(name)) return null;
  const parts = name.split('-');
  const domainPart = parts[0];
  const slugPart = parts.slice(1).join('-');
  const targetDir = slugPart
    ? join(targetRoot, domainPart, slugPart)
    : join(targetRoot, domainPart || name);
  return isWithinRoot(targetRoot, targetDir) ? targetDir : null;
}

/**
 * Recursively copy a directory tree. Used so a skill keeps its reference
 * material, not just its SKILL.md.
 *
 * @param {string} from
 * @param {string} to
 * @returns {Promise<number>} number of files copied
 */
async function copyTree(from, to) {
  const entries = await readdir(from, { withFileTypes: true });
  await mkdir(to, { recursive: true });
  let copied = 0;
  for (const entry of entries) {
    const src = join(from, entry.name);
    const dest = join(to, entry.name);
    if (entry.isDirectory()) {
      copied += await copyTree(src, dest);
    } else if (entry.isFile()) {
      await copyFile(src, dest);
      copied += 1;
    }
    // Symlinks and other special entries are not imported; a skill directory
    // that needs them is reported by the fetcher's warnings, not silently
    // half-copied here.
  }
  return copied;
}

/**
 * Write a manifest record's file map into a target directory.
 *
 * Relative paths come from a JSON file the operator may not have written, so
 * every one is re-checked against the destination root before it is used — the
 * same containment rule the name itself gets. A path that escapes throws and
 * the whole skill is reported as `rejected`; it is never written.
 *
 * @param {Record<string, string>} files — relative path -> UTF-8 contents
 * @param {string} destDir — absolute, already resolved
 * @returns {Promise<number>} number of files written
 */
async function writeFileMap(files, destDir) {
  let written = 0;
  for (const [rel, contents] of Object.entries(files)) {
    const dest = join(destDir, ...rel.split('/'));
    if (!isWithinRoot(destDir, dest)) {
      throw new Error(`manifest file path escapes the target directory: ${rel}`);
    }
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, contents, 'utf-8');
    written += 1;
  }
  return written;
}

/**
 * Fetch, validate and import a set of sources into `targetDir`.
 *
 * `sources` entries are `{type:'local'|'git', path?, url?}` descriptors, a bare
 * string (shorthand for a local directory), or a record read back from a fetch
 * manifest — see `recordsFromManifest()` in `src/corpus/manifest.mjs`.
 *
 * Nothing is written for a skill that fails validation. An existing skill is
 * left untouched unless `opts.force` is set. Any temporary git clone is removed
 * before this function returns, on the success path and on the failure path.
 * The returned report is also written to `<reportDir>/corpus-import-<date>.json`
 * unless `opts.writeReport` is false.
 *
 * @param {Array<Object|string>} sources
 * @param {string} [targetDir]
 * @param {ImportOptions} [opts]
 * @returns {Promise<ImportReport>}
 */
export async function importSkills(sources, targetDir = DEFAULT_TARGET_DIR, opts = {}) {
  const force = opts.force ?? false;
  const warnings = opts.warnings ?? [];
  const date = opts.date ?? dateStamp();
  const reportDir = resolve(opts.reportDir ?? REPORT_DIR);
  const targetRoot = resolve(targetDir);

  if (!existsSync(targetRoot)) {
    await mkdir(targetRoot, { recursive: true });
    warnings.push(`target directory did not exist and was created: ${targetRoot}`);
  }

  // The fetcher writes into the same `warnings` array so a clone failure or a
  // duplicate it already recorded reaches the import report. The clone itself
  // outlives this call to fetchFromSources-equivalent: `release()` runs after
  // every copy below, not before.
  const { records: fetched, release } = await openSources(sources, { ...opts, warnings });

  /** @type {ImportItem[]} */
  const items = [];

  try {
    for (const record of fetched) {
      const item = {
        name: record.name,
        status: /** @type {'imported'|'overwritten'|'rejected'|'skipped'} */ ('skipped'),
        sourcePath: record.path,
      };

      // ── Validate ───────────────────────────────────────────────────────────
      // A manifest record carries its bytes; a live record is read from disk.
      const fromManifest = typeof record.content === 'string' && record.files;
      let validation;
      try {
        validation = fromManifest
          ? validateSkillContent(record.content)
          : await validateSkill(record.path);
      } catch (err) {
        validation = {
          valid: false,
          issues: [{ field: 'file', message: `Cannot read file: ${err.message}` }],
        };
      }

      if (!validation.valid) {
        item.status = 'rejected';
        item.issues = validation.issues;
        items.push(item);
        continue;
      }

      // The validator's trimmed name is authoritative for the target path.
      const name = validation.parsed.name;
      item.name = name;

      // ── Containment ────────────────────────────────────────────────────────
      const destDir = resolveTargetDir(name, targetRoot);
      if (!destDir) {
        item.status = 'rejected';
        item.issues = [
          {
            field: 'path',
            message: `Skill name is not a safe single path segment: ${name}`,
          },
        ];
        items.push(item);
        continue;
      }

      const targetPath = join(destDir, SKILL_FILE);
      const existed = existsSync(targetPath);

      // ── Refuse to overwrite without force ──────────────────────────────────
      if (existed && !force) {
        item.status = 'skipped';
        item.targetPath = targetPath;
        items.push(item);
        continue;
      }

      // ── Write ──────────────────────────────────────────────────────────────
      try {
        await mkdir(destDir, { recursive: true });
        if (fromManifest) {
          await writeFileMap(record.files, destDir);
        } else {
          await copyTree(record.dir, destDir);
        }
        item.status = existed ? 'overwritten' : 'imported';
        item.targetPath = targetPath;
      } catch (err) {
        item.status = 'rejected';
        item.issues = [{ field: 'write', message: err.message }];
      }

      items.push(item);
    }
  } finally {
    // Runs on the success path and on any throw out of the loop above, so a
    // failed import does not strand a clone in the OS temp directory.
    await release();
  }

  const report = {
    date,
    targetDir: targetRoot,
    force,
    total: items.length,
    imported: items.filter((i) => i.status === 'imported').length,
    overwritten: items.filter((i) => i.status === 'overwritten').length,
    rejected: items.filter((i) => i.status === 'rejected').length,
    skipped: items.filter((i) => i.status === 'skipped').length,
    warnings,
    items,
  };

  if (opts.writeReport !== false) {
    try {
      await mkdir(reportDir, { recursive: true });
      await writeFile(
        join(reportDir, `corpus-import-${date}.json`),
        `${JSON.stringify(report, null, 2)}\n`,
        'utf-8',
      );
    } catch (err) {
      // A failed report write is reported, not swallowed: the caller must know
      // the run left no audit trail.
      warnings.push(`could not write import report to ${reportDir}: ${err.message}`);
    }
  }

  return report;
}

/**
 * Directory statistics for a skill tree — the numbers `corpus stats` prints.
 *
 * @param {string} dir
 * @returns {Promise<{dir: string, total: number, valid: number, invalid: number,
 *   issuesByField: Record<string, number>, domains: Record<string, number>,
 *   avgDescriptionLength: number, avgContentTokens: number}>}
 */
export async function corpusStats(dir) {
  const root = resolve(dir);
  const warnings = [];
  const fetched = await fetchFromLocal(root, { warnings });

  const results = await validateSkills(fetched.map((f) => f.path));
  const byPath = new Map(results.map((r) => [r.path, r.result]));

  const issuesByField = {};
  const domains = {};
  let totalDesc = 0;
  let totalTokens = 0;
  let valid = 0;

  for (const record of fetched) {
    const result = byPath.get(record.path);
    if (result?.valid) valid += 1;
    for (const issue of result?.issues ?? []) {
      issuesByField[issue.field] = (issuesByField[issue.field] ?? 0) + 1;
    }
    for (const d of record.domains) {
      domains[d] = (domains[d] ?? 0) + 1;
    }
    totalDesc += result?.parsed.descriptionLength ?? 0;
    totalTokens += result?.parsed.contentTokens ?? 0;
  }

  return {
    dir: root,
    total: fetched.length,
    valid,
    invalid: fetched.length - valid,
    issuesByField,
    domains,
    avgDescriptionLength: fetched.length ? Math.round(totalDesc / fetched.length) : 0,
    avgContentTokens: fetched.length ? Math.round(totalTokens / fetched.length) : 0,
    warnings,
  };
}
