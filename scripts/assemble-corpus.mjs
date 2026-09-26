#!/usr/bin/env node
/**
 * assemble-corpus.mjs — turn the manifests written by
 * `corpus fetch --to` into a staging tree that `corpus import` can copy.
 *
 * Sub-phase 7.3. It exists because the 7.2 fetcher keeps a fetched skill's
 * *whole* directory (scripts, references, fonts, PDFs), and the assembled
 * corpus has to be one `SKILL.md` per skill so the file count under the
 * corpus directory equals the index entry count. So this script reads each
 * manifest, keeps only `SKILL.md`, applies the one repair the sub-phase brief
 * allows, and writes the result under `--out`.
 *
 * THE REPAIR POLICY — this is the honest core of the file, so it is stated
 * here and in docs/reports/phase-7.3-corpus-build.md rather than buried in
 * code:
 *
 *   - ALLOWED: a mechanical rename to the router's `{domain}-{specific}`
 *     shape. Lowercase, every run of non `[a-z0-9]` becomes a single hyphen,
 *     leading/trailing hyphens trimmed. The brief says "fix invalid skills by
 *     renaming to the naming convention", and a mechanical rename changes no
 *     meaning: `Code Review` -> `code-review`, `0day-scanner` -> unchanged.
 *     A skill whose name is empty cannot be renamed and is dropped.
 *   - FORBIDDEN: writing a description, truncating an over-long one, or
 *     touching the body. The brief says "do not edit a fetched skill's content
 *     to make it pass validation" and the "adding descriptions" clause is
 *     scoped to the generated extension, whose descriptions this project
 *     authors. A fetched skill that has no description, or a description
 *     outside 40-400 characters, is therefore DROPPED, not fixed.
 *
 * Nothing is edited for a skill that already validates: it is staged byte for
 * byte as it was fetched.
 *
 * Every count this script writes into data/corpus-sources.json is measured
 * here, not declared, so the file cannot drift from what the pipeline did.
 *
 * Usage:
 *   node scripts/assemble-corpus.mjs --sources data/corpus-sources.json \
 *     --manifests tmp --out tmp/corpus-staging
 *
 * Flags:
 *   --sources <file>    source registry to read and update (default data/corpus-sources.json)
 *   --manifests <dir>   directory holding <source-slug>/corpus-fetch.json (default tmp)
 *   --out <dir>         staging tree to write (default tmp/corpus-staging)
 *   --limit <n>         stop after n staged skills (0 = no limit, the default)
 *   --dry-run           report only, write nothing
 *   --check             verify the registry's recorded counts still match a fresh run
 */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { readFetchManifest } from '../src/corpus/manifest.mjs';
import { validateSkillContent } from '../src/corpus/validator.mjs';
import { MANIFEST_FILE } from '../src/corpus/manifest.mjs';

/**
 * Mechanical `{domain}-{specific}` normalisation.
 *
 * Idempotent: normalising an already-normalised name returns it unchanged, so
 * a name the validator already accepts is never rewritten.
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeName(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Rewrite the `name:` line of a SKILL.md frontmatter block.
 *
 * Only a line that is exactly the old name as its value is touched, and only
 * inside the leading frontmatter block, so a body line that happens to contain
 * the same text cannot be edited by accident. Returns the content unchanged
 * when no such line exists — the caller then drops the skill rather than
 * guessing.
 *
 * @param {string} content
 * @param {string} from — the name the parser read
 * @param {string} to — the normalised name
 * @returns {string}
 */
export function renameInFrontmatter(content, from, to) {
  const match = content.match(/^---\s*\n[\s\S]*?\n---/);
  if (!match) return content;
  const block = match[0];
  const lines = block.split('\n');
  const value = escapeRegExp(from.trim());
  let changed = false;
  const next = lines.map((line) => {
    if (changed) return line;
    const kv = line.match(/^(\s*name\s*:\s*)(.*?)(\s*)$/);
    if (!kv) return line;
    if (kv[2] !== from.trim()) return line;
    changed = true;
    return `${kv[1]}${to}${kv[3]}`;
  });
  if (!changed) return content;
  return content.replace(block, next.join('\n'));
  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

/**
 * Decide what to do with one fetched record.
 *
 * @param {Object} record — a manifest record
 * @returns {{action: 'keep'|'rename'|'drop', content: string, name: string,
 *   reason: string}}
 */
export function classifyRecord(record) {
  const original = typeof record.content === 'string' ? record.content : '';
  const first = validateSkillContent(original);
  if (first.valid) {
    return { action: 'keep', content: original, name: first.parsed.name, reason: '' };
  }

  const nameIssue = first.issues.find((i) => i.field === 'name');
  if (nameIssue && first.parsed.name) {
    const normalized = normalizeName(first.parsed.name);
    if (normalized && normalized !== first.parsed.name) {
      const renamed = renameInFrontmatter(original, first.parsed.name, normalized);
      const second = validateSkillContent(renamed);
      if (second.valid) {
        return { action: 'rename', content: renamed, name: second.parsed.name, reason: '' };
      }
      return {
        action: 'drop',
        content: original,
        name: first.parsed.name,
        reason: `renamed to "${normalized}" and still invalid: ${second.issues
          .map((i) => `${i.field}: ${i.message}`)
          .join('; ')}`,
      };
    }
  }

  return {
    action: 'drop',
    content: original,
    name: first.parsed.name,
    reason: first.issues.map((i) => `${i.field}: ${i.message}`).join('; '),
  };
}

/**
 * Group a drop reason into a countable bucket, so the report can say how many
 * skills were lost to each rule rather than one undifferentiated number.
 *
 * @param {string} reason
 * @returns {string}
 */
export function dropBucket(reason) {
  if (/frontmatter:/.test(reason) && /name: Missing or empty/.test(reason)) return 'no frontmatter';
  if (/description: Missing or empty/.test(reason)) return 'no description';
  if (/description: Description too short/.test(reason)) return 'description under 40 chars';
  if (/description: Description too long/.test(reason)) return 'description over 400 chars';
  if (/name: ".*" does not match/.test(reason)) return 'name not {domain}-{specific} and not renameable';
  return 'other';
}

/**
 * Parse argv.
 *
 * @param {string[]} argv
 * @returns {object}
 */
function parseArgs(argv) {
  const opts = {
    sources: 'data/corpus-sources.json',
    manifests: 'tmp',
    out: 'tmp/corpus-staging',
    limit: 0,
    dryRun: false,
    check: false,
  };
  const usage = 'Usage: node scripts/assemble-corpus.mjs [--sources f] [--manifests d] [--out d] [--limit n] [--dry-run] [--check]';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sources') opts.sources = requireValue(argv, ++i, usage);
    else if (a === '--manifests') opts.manifests = requireValue(argv, ++i, usage);
    else if (a === '--out') opts.out = requireValue(argv, ++i, usage);
    else if (a === '--limit') opts.limit = Number(requireValue(argv, ++i, usage)) || 0;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--check') opts.check = true;
    else if (a === '--help' || a === '-h') {
      console.log(usage);
      process.exit(0);
    } else {
      console.error(`Unknown flag: ${a}`);
      console.error(usage);
      process.exit(1);
    }
  }
  return opts;
}

/**
 * @param {string[]} argv
 * @param {number} i
 * @param {string} usage
 * @returns {string}
 */
function requireValue(argv, i, usage) {
  if (i >= argv.length) {
    console.error(usage);
    process.exit(1);
  }
  return argv[i];
}

/**
 * Assemble one source: read its manifest, classify every record, and stage
 * the keepers.
 *
 * @param {Object} source — a data/corpus-sources.json entry
 * @param {string} manifestDir
 * @param {string} outDir
 * @param {boolean} dryRun
 * @returns {Promise<Object>} the measured per-source counts
 */
function findManifest(manifestDir, slug) {
  for (const candidate of [join(manifestDir, slug), join(manifestDir, `src-${slug}`)]) {
    const file = join(candidate, MANIFEST_FILE);
    if (existsSync(file)) return file;
  }
  return join(manifestDir, slug, MANIFEST_FILE);
}

/**
 * Classify one source's records.
 *
 * Nothing is written here. Every record is validated, the allowed mechanical
 * rename is applied, and the survivors are returned in fetch order so the
 * caller can take them round-robin. Writing happens after selection, which is
 * what makes `--limit` mean what it says: an earlier version wrote first and
 * capped the *count* afterwards, leaving a full 592-skill staging tree on disk
 * while reporting 200, so the import copied all 592 and the cap was a lie.
 *
 * @param {Object} source — a data/corpus-sources.json entry
 * @param {string} manifestDir
 * @returns {Promise<Object>} counts plus `taken`: [{index, verdict}]
 */
async function assembleSource(source, manifestDir) {
  const slug = source.slug;
  const manifestPath = findManifest(manifestDir, slug);
  const result = {
    slug,
    type: 'fetched',
    url: source.url,
    license: source.license,
    manifest: manifestPath.replace(/\\/g, '/'),
    manifestPresent: existsSync(manifestPath),
    fetched: 0,
    valid: 0,
    renamed: 0,
    kept: 0,
    dropped: 0,
    droppedBy: {},
    taken: [],
  };

  if (!result.manifestPresent) {
    result.note = 'manifest not found — nothing fetched for this source';
    return result;
  }

  const { records } = await readFetchManifest(manifestPath);
  result.fetched = records.length;

  for (let i = 0; i < records.length; i++) {
    const verdict = classifyRecord(records[i]);
    if (verdict.action === 'drop') {
      result.dropped += 1;
      const bucket = dropBucket(verdict.reason);
      result.droppedBy[bucket] = (result.droppedBy[bucket] || 0) + 1;
      continue;
    }
    result.valid += 1;
    result.taken.push({ index: i, verdict });
  }
  return result;
}

/**
 * Run the assembly.
 *
 * The order in which valid skills are taken is ROUND ROBIN over the fetched
 * sources, one skill per source per pass, in the order `data/corpus-sources.json`
 * lists them. Filling the cap source-by-source instead would hand 162 of 200
 * slots to the first repository and leave eight sources contributing nothing,
 * which is the opposite of what a real-world validation corpus is for. The
 * rule is fixed before any retrieval is run and never looks at a ranking.
 *
 * @param {object} opts
 * @returns {Promise<{report: Object, registry: Object, registryPath: string}>}
 */
async function run(opts) {
  const registryPath = resolve(opts.sources);
  const registry = JSON.parse(await readFile(registryPath, 'utf-8'));
  const manifestDir = resolve(opts.manifests);
  const outDir = resolve(opts.out);

  if (!opts.dryRun && !opts.check) {
    await rm(outDir, { recursive: true, force: true });
  }
  await mkdir(outDir, { recursive: true });

  /** @type {Array<Object>} */
  const results = [];
  /** @type {Array<{source: Object, measured: Object, taken: Array<{index: number, verdict: Object}>}>} */
  const perSource = [];

  for (const source of registry.sources) {
    if (source.type !== 'fetched') {
      results.push({
        slug: source.slug,
        url: source.url,
        type: source.type,
        note: source.reason,
        fetched: 0,
        kept: 0,
        dropped: 0,
        renamed: 0,
        valid: 0,
        droppedBy: {},
      });
      continue;
    }
    const measured = await assembleSource(source, manifestDir, outDir, opts.dryRun);
    results.push(measured);
    perSource.push({ source, measured, taken: measured.taken });
  }

  // ── Round-robin selection ────────────────────────────────────────────────
  let staged = 0;
  for (let pass = 0; staged < (opts.limit > 0 ? opts.limit : Infinity); pass++) {
    let progressed = false;
    for (const entry of perSource) {
      if (staged >= (opts.limit > 0 ? opts.limit : Infinity)) break;
      const next = entry.taken[pass];
      if (!next) continue;
      progressed = true;
      entry.measured.kept += 1;
      if (next.verdict.action === 'rename') entry.measured.renamed += 1;
      staged += 1;
      if (!opts.dryRun) {
        const dir = join(outDir, entry.source.slug, `p${String(pass).padStart(3, '0')}`);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'SKILL.md'), next.verdict.content, 'utf-8');
      }
    }
    if (!progressed) break;
  }

  for (const entry of perSource) {
    const total = entry.measured.valid;
    if (entry.measured.kept < total) {
      entry.measured.note =
        `${total - entry.measured.kept} of ${total} valid skill(s) in this source were not staged — ` +
        `the --limit of ${opts.limit} was reached`;
    }
  }

  // Write the measured counts back into the registry, preserving the authored
  // fields (url, license, attribution, reason) and the file's own shape.
  const byslug = new Map(results.map((r) => [r.slug, r]));
  for (const source of registry.sources) {
    const measured = byslug.get(source.slug);
    if (!measured) continue;
    if (source.type === 'fetched') {
      source.skills_fetched = measured.fetched;
      source.skills_valid = measured.valid;
      source.skills_renamed = measured.renamed;
      source.skills_dropped = measured.dropped;
      source.skills_dropped_by = measured.droppedBy;
      source.skills_imported = measured.kept;
      source.manifest = measured.manifest;
      if (measured.note) source.note = measured.note;
    } else {
      source.skills_imported = 0;
    }
  }
  registry.corpus = {
    staged,
    limit: opts.limit,
    selection: opts.limit > 0
      ? 'round robin over the fetched sources in the order listed above, one skill per source per pass, until --limit is reached'
      : 'every valid skill from every fetched source, no cap',
    by_source: results
      .filter((r) => r.type === 'fetched')
      .map((r) => ({
        slug: r.slug,
        fetched: r.fetched,
        valid: r.valid,
        renamed: r.renamed,
        dropped: r.dropped,
        imported: r.kept,
      })),
  };

  return { report: registry.corpus, registry, registryPath };
}

/**
 * Entry point.
 */
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { report, registry, registryPath } = await run(opts);

  console.log('Source'.padEnd(50) + 'Fetched  Valid  Renamed  Imported  Dropped');
  console.log('-'.repeat(100));
  for (const r of report.by_source) {
    console.log(
      r.slug.padEnd(50) +
        String(r.fetched).padStart(7) +
        String(r.valid).padStart(7) +
        String(r.renamed).padStart(9) +
        String(r.imported).padStart(10) +
        String(r.dropped).padStart(9),
    );
  }
  console.log('-'.repeat(100));
  console.log(`Staged ${report.staged} skill(s) into ${resolve(opts.out)}`);

  if (opts.check) {
    const disk = JSON.parse(await readFile(registryPath, 'utf-8'));
    const same = JSON.stringify(disk.corpus) === JSON.stringify(report);
    console.log(same ? 'CHECK OK — recorded counts match a fresh run' : 'CHECK FAILED — counts differ');
    process.exit(same ? 0 : 1);
  }

  if (!opts.dryRun) {
    await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf-8');
    console.log(`Updated ${registryPath}`);
  }
}

main().catch((err) => {
  console.error('assemble-corpus failed:', err);
  process.exit(1);
});
