/**
 * Corpus fetch manifest — a portable, self-contained snapshot of a fetch result.
 *
 * Sub-phase 7.2. `corpus fetch --to <dir>` writes one of these, and
 * `corpus import --from-manifest <file>` reads one back. The point is to break
 * the dependency on a directory that is still on disk: a fetch from a git
 * source is only readable while the temporary clone exists, so a manifest that
 * recorded `path` instead of the bytes was a dead file the moment it was
 * written. This one carries the whole skill directory with it.
 *
 * Shape:
 *
 *   {
 *     kind: 'skill-router-corpus-fetch',
 *     version: 1,
 *     generatedAt: '2026-09-26T...Z',
 *     source: { type: 'local' | 'git', path? , url? },
 *     total: 8,
 *     warnings: [...],
 *     skills: [
 *       { name, description, keywords, domains, version, relPath,
 *         source, sourceRef, contentHash, files: { 'SKILL.md': '...' } }
 *     ]
 *   }
 *
 * `files` maps each path inside the skill directory to its contents as UTF-8
 * text, so importing from a manifest reproduces the tree, `references/` and all
 * — not just the manifest. A file that is not valid UTF-8 (a binary asset) is
 * **not** silently mangled: it is left out and named in the manifest warnings,
 * because a round trip that quietly corrupts a file is worse than one that says
 * it could not carry it.
 *
 * Reading is strict: a file that is not a manifest, or whose `kind` / `version`
 * is not recognised, throws. Silently importing half a corpus from a
 * mis-identified JSON file is not a failure mode worth having.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { SKILL_FILE } from './scan.mjs';

/** Marker written into every manifest, checked on read. */
export const MANIFEST_KIND = 'skill-router-corpus-fetch';

/** Manifest schema version. A reader that does not know this version refuses. */
export const MANIFEST_VERSION = 1;

/** Default file name inside the `--to` directory. */
export const MANIFEST_FILE = 'corpus-fetch.json';

/**
 * Read one file as UTF-8 text, or return null when it is not representable.
 *
 * A buffer is decoded and re-encoded; if the bytes do not survive the round
 * trip the file is binary and this module refuses to pretend otherwise.
 *
 * @param {string} filePath
 * @returns {Promise<string|null>}
 */
async function readTextOrNull(filePath) {
  const buf = await readFile(filePath);
  const text = buf.toString('utf-8');
  if (!Buffer.from(text, 'utf-8').equals(buf)) return null;
  return text;
}

/**
 * Walk one skill directory and collect every regular file as UTF-8 text.
 *
 * P6-H-016: an unreadable directory (EACCES, EPERM, EIO, ...) throws a named
 * error — files silently missing from the manifest would later be dropped by
 * `import --from-manifest`. ENOENT (a file or directory that vanished
 * mid-walk) stays a warning.
 *
 * @param {string} dir — the directory holding the SKILL.md
 * @param {string[]} warnings — collected in place
 * @param {string} [base]
 * @returns {Promise<Record<string, string>>} relative path -> contents
 */
async function collectSkillFiles(dir, warnings, base = dir) {
  /** @type {Record<string, string>} */
  const files = {};
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      const named = new Error(`cannot read skill directory ${dir}: ${err.code ?? err.message}`);
      named.code = err.code;
      named.cause = err;
      throw named;
    }
    warnings.push(`cannot read skill directory ${dir}: ${err.message}`);
    return files;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(files, await collectSkillFiles(full, warnings, base));
    } else if (entry.isFile()) {
      const text = await readTextOrNull(full);
      if (text === null) {
        warnings.push(
          `manifest cannot carry the non-UTF-8 file ${full} — it is omitted from the manifest`,
        );
        continue;
      }
      files[relative(base, full).split(sep).join('/')] = text;
    }
    // Symlinks and other special entries are not carried, matching the
    // importer's copy, which also skips them.
  }
  return files;
}

/**
 * Write a self-contained manifest of a fetch result into `dir`.
 *
 * @param {{source: Object, records: Object[], warnings?: string[]}} fetchResult
 * @param {string} dir — destination directory, created if missing
 * @param {Object} [opts]
 * @param {string} [opts.fileName] — default `corpus-fetch.json`
 * @returns {Promise<{file: string, total: number, warnings: string[]}>}
 */
export async function writeFetchManifest(fetchResult, dir, opts = {}) {
  const target = resolve(dir);
  await mkdir(target, { recursive: true });

  const warnings = [...(fetchResult.warnings ?? [])];
  const skills = [];

  for (const record of fetchResult.records) {
    if (typeof record.content === 'string') {
      // A manifest record is being re-manifested; its files are already in hand.
      const files = { ...record.files };
      if (typeof files[SKILL_FILE] !== 'string') files[SKILL_FILE] = record.content;
      skills.push({
        name: record.name,
        description: record.description,
        keywords: record.keywords,
        domains: record.domains,
        version: record.version,
        relPath: record.relPath,
        source: record.source,
        sourceRef: record.sourceRef,
        contentHash: record.contentHash,
        files,
      });
      continue;
    }

    const files = await collectSkillFiles(record.dir, warnings);
    if (typeof files[SKILL_FILE] !== 'string') {
      warnings.push(
        `manifest cannot read the SKILL.md for ${record.name || record.path} — it is omitted from the manifest`,
      );
      continue;
    }
    skills.push({
      name: record.name,
      description: record.description,
      keywords: record.keywords,
      domains: record.domains,
      version: record.version,
      relPath: record.relPath,
      source: record.source,
      sourceRef: record.sourceRef,
      contentHash: record.contentHash,
      files,
    });
  }

  const file = join(target, opts.fileName ?? MANIFEST_FILE);
  await writeFile(
    file,
    `${JSON.stringify(
      {
        kind: MANIFEST_KIND,
        version: MANIFEST_VERSION,
        generatedAt: new Date().toISOString(),
        source: fetchResult.source,
        total: skills.length,
        warnings,
        skills,
      },
      null,
      2,
    )}\n`,
    'utf-8',
  );

  return { file, total: skills.length, warnings };
}

/**
 * Read a manifest back into records the importer can consume.
 *
 * The returned records carry `files` and `content` rather than a live `path` /
 * `dir`, which is the whole reason this module exists: there is no directory
 * left to point at.
 *
 * @param {string} file — path to `corpus-fetch.json`
 * @returns {Promise<{source: Object, total: number, warnings: string[],
 *   records: Object[]}>}
 * @throws when the file is missing, unparseable, not a manifest, or carries an
 *         unknown version
 */
export async function readFetchManifest(file) {
  const path = resolve(file);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, 'utf-8'));
  } catch (err) {
    throw new Error(`Cannot read fetch manifest ${path}: ${err.message}`);
  }

  if (parsed?.kind !== MANIFEST_KIND) {
    throw new Error(
      `${path} is not a corpus fetch manifest (kind: ${JSON.stringify(parsed?.kind)}, expected "${MANIFEST_KIND}")`,
    );
  }
  if (parsed.version !== MANIFEST_VERSION) {
    throw new Error(
      `${path} has manifest version ${JSON.stringify(parsed.version)}; this build reads version ${MANIFEST_VERSION}`,
    );
  }
  if (!Array.isArray(parsed.skills)) {
    throw new Error(`${path} has no "skills" array`);
  }

  const records = parsed.skills.map((skill) => {
    const files = skill?.files && typeof skill.files === 'object' ? skill.files : {};
    const content = typeof files[SKILL_FILE] === 'string' ? files[SKILL_FILE] : '';
    return {
      name: typeof skill.name === 'string' ? skill.name : '',
      description: typeof skill.description === 'string' ? skill.description : '',
      keywords: Array.isArray(skill.keywords) ? skill.keywords : [],
      domains: Array.isArray(skill.domains) ? skill.domains : [],
      version: typeof skill.version === 'string' ? skill.version : '',
      relPath: typeof skill.relPath === 'string' ? skill.relPath : SKILL_FILE,
      source: 'manifest',
      sourceRef: typeof skill.sourceRef === 'string' ? skill.sourceRef : path,
      contentHash:
        typeof skill.contentHash === 'string'
          ? skill.contentHash
          : createHash('sha256').update(content, 'utf-8').digest('hex'),
      content,
      files,
      // The manifest file itself is the provenance, in place of a dead path.
      path: `${path}#${typeof skill.relPath === 'string' ? skill.relPath : SKILL_FILE}`,
    };
  });

  return {
    source: parsed.source ?? { type: 'manifest', path },
    total: typeof parsed.total === 'number' ? parsed.total : records.length,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    records,
  };
}
