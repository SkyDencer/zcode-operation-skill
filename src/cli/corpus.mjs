/**
 * corpus — Fetch, validate, measure and import external skill corpora.
 *
 * Sub-phase 7.2. Four subcommands: `fetch`, `validate`, `stats`, `import`.
 *
 * A `<source>` is a local directory by default; `--git` or a `git:` prefix
 * selects the git path. A git source is cloned into a temporary directory:
 * `import` keeps that clone alive for the whole copy and removes it afterwards,
 * while `fetch` removes it before returning, so the paths it prints are
 * metadata only. `--to` writes a self-contained fetch manifest that
 * `corpus import --from-manifest` can consume later, including on another
 * machine.
 *
 * Exit codes follow the rest of the CLI (see src/cli/import.mjs:258-260 and
 * src/quality/validator.mjs:327):
 *   0  the command ran and nothing was rejected or found invalid
 *   1  usage error, missing path, or one or more skills were rejected/invalid
 *
 * `stats` and `validate` share the invalid-count rule, so a stats run over a
 * tree with even one invalid skill exits 1 and can be used as a gate.
 */

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fetchFromLocal, openSources } from '../corpus/fetcher.mjs';
import { writeFetchManifest, readFetchManifest } from '../corpus/manifest.mjs';
import { validateSkills } from '../corpus/validator.mjs';
import { importSkills, corpusStats } from '../corpus/importer.mjs';
import { RULE, usage, flagValue, toSource, displayPath } from './corpus-args.mjs';

/**
 * `corpus fetch` — list every SKILL.md a source resolves to.
 *
 * Sources are opened with `openSources()` and the clone is released in a
 * `finally` that wraps the whole command, not just the fetch. A git source is
 * only readable while its clone exists, and `--to` has to read the bytes to
 * build the manifest — releasing before that wrote an empty manifest while the
 * fetch printed "Found: 1".
 *
 * @param {string[]} argv
 * @param {string[]} warnings
 */
async function cmdFetch(argv, warnings) {
  const usageLine = 'Usage: node bin/skill-router.mjs corpus fetch <source> [--to <dir>] [--git]';
  let to = '';
  let gitFlag = false;
  let json = false;
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--to') to = flagValue(argv, i++, usageLine);
    else if (argv[i] === '--git') gitFlag = true;
    else if (argv[i] === '--json') json = true;
    else if (!argv[i].startsWith('--')) positional.push(argv[i]);
  }

  if (positional.length === 0) {
    console.error(usageLine);
    process.exit(1);
  }

  const source = toSource(positional[0], gitFlag);
  const { records: skills, release } = await openSources([source], { warnings });

  try {
    if (json) {
      console.log(JSON.stringify({ source, total: skills.length, warnings, skills }, null, 2));
    } else {
      console.log(RULE);
      console.log(`Source:  ${source.type === 'git' ? source.url : resolve(source.path)}`);
      console.log(`Found:   ${skills.length} SKILL.md file(s)`);
      console.log(RULE);
      for (const s of skills) {
        console.log(`  ${s.name || '(no name)'}  <-  ${displayPath(s)}`);
      }
    }

    if (to) {
      // The manifest carries the file contents, not the paths: a git source is
      // cloned into a temp directory, and a manifest of paths would be dead on
      // arrival even for a local source copied elsewhere.
      const written = await writeFetchManifest({ source, records: skills, warnings }, to);
      console.log(`Manifest written: ${written.file} (${written.total} skill(s))`);
      for (const w of written.warnings) {
        console.log(`  WARN ${w}`);
      }
      if (written.total < skills.length) {
        console.error(
          `corpus fetch: manifest carries ${written.total} of ${skills.length} skill(s) — see the warnings above`,
        );
        process.exit(1);
      }
    }
  } finally {
    await release();
  }
}

/**
 * `corpus validate` — apply the four corpus rules to a directory.
 *
 * @param {string[]} argv
 * @param {string[]} warnings
 */
async function cmdValidate(argv, warnings) {
  let json = false;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') json = true;
    else if (!argv[i].startsWith('--')) positional.push(argv[i]);
  }

  if (positional.length === 0) {
    console.error('Usage: node bin/skill-router.mjs corpus validate <dir> [--json]');
    process.exit(1);
  }

  const dir = resolve(positional[0]);
  if (!existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }

  const fetched = await fetchFromLocal(dir, { warnings });
  const results = await validateSkills(fetched.map((f) => f.path));
  const valid = results.filter((r) => r.result.valid).length;
  const invalid = results.length - valid;

  if (json) {
    console.log(
      JSON.stringify(
        { dir, total: results.length, valid, invalid, warnings, skills: results },
        null,
        2,
      ),
    );
  } else {
    console.log(RULE);
    console.log(`Directory: ${dir}`);
    console.log(`Total:     ${results.length}`);
    console.log(`Valid:     ${valid}`);
    console.log(`Invalid:   ${invalid}`);
    console.log(RULE);
    for (const { path, result } of results) {
      const rel = path.slice(dir.length).replace(/^[\\/]/, '').replace(/\\/g, '/');
      if (result.valid) {
        console.log(`  PASS  ${rel}  (${result.parsed.name})`);
      } else {
        console.log(`  FAIL  ${rel}  (${result.parsed.name || 'no name'})`);
        for (const issue of result.issues) {
          console.log(`          [${issue.field}] ${issue.message}`);
        }
      }
    }
  }

  if (invalid > 0) process.exit(1);
}

/**
 * `corpus stats` — count and summarise a skill tree.
 *
 * Exits 1 when any skill is invalid, the same rule `validate` uses, so a stats
 * run can gate a corpus. The module header promises that contract; the check
 * was missing here, and only went unnoticed because `corpus stats data/skills`
 * has zero invalid skills and the two accidentally agreed.
 *
 * @param {string[]} argv
 * @param {string[]} warnings
 */
async function cmdStats(argv, warnings) {
  let json = false;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') json = true;
    else if (!argv[i].startsWith('--')) positional.push(argv[i]);
  }

  if (positional.length === 0) {
    console.error('Usage: node bin/skill-router.mjs corpus stats <dir> [--json]');
    process.exit(1);
  }

  const dir = resolve(positional[0]);
  if (!existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }

  const stats = await corpusStats(dir);
  warnings.push(...stats.warnings);

  if (json) {
    console.log(JSON.stringify({ ...stats, warnings }, null, 2));
    if (stats.invalid > 0) process.exit(1);
    return;
  }

  console.log(RULE);
  console.log(`Directory:                ${stats.dir}`);
  console.log(`Total skills:             ${stats.total}`);
  console.log(`Valid skills:             ${stats.valid}`);
  console.log(`Invalid skills:           ${stats.invalid}`);
  console.log(`Avg description length:   ${stats.avgDescriptionLength} chars`);
  console.log(`Avg content tokens:       ${stats.avgContentTokens}`);
  console.log(RULE);
  console.log('Domains:');
  for (const [d, count] of Object.entries(stats.domains).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${d}: ${count}`);
  }
  const fields = Object.entries(stats.issuesByField);
  console.log(RULE);
  if (fields.length === 0) {
    console.log('Issues: none');
  } else {
    console.log('Issues by field:');
    for (const [field, count] of fields.sort((a, b) => b[1] - a[1])) {
      console.log(`  ${field}: ${count}`);
    }
  }
  for (const w of warnings) {
    console.log(`  WARN ${w}`);
  }

  if (stats.invalid > 0) process.exit(1);
}

/**
 * `corpus import` — fetch, validate and copy skills into a target tree.
 *
 * @param {string[]} argv
 * @param {string[]} warnings
 */
async function cmdImport(argv, warnings) {
  const usageLine =
    'Usage: node bin/skill-router.mjs corpus import <source> --target <dir> [--force]';
  let target = 'data/skills';
  let force = false;
  let gitFlag = false;
  let json = false;
  let manifestFile = '';
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target') target = flagValue(argv, i++, usageLine);
    else if (argv[i] === '--from-manifest') manifestFile = flagValue(argv, i++, usageLine);
    else if (argv[i] === '--force') force = true;
    else if (argv[i] === '--git') gitFlag = true;
    else if (argv[i] === '--json') json = true;
    else if (!argv[i].startsWith('--')) positional.push(argv[i]);
  }

  if (manifestFile && positional.length > 0) {
    console.error('--from-manifest and a <source> argument are mutually exclusive.');
    console.error(usageLine);
    process.exit(1);
  }

  if (!manifestFile && positional.length === 0) {
    console.error(usageLine);
    process.exit(1);
  }

  // A manifest carries the skill bodies with it, so this path needs no live
  // source directory — which is the point: a git fetch result outlives neither
  // the clone nor the machine.
  const sources = manifestFile
    ? (await readFetchManifest(manifestFile)).records
    : [toSource(positional[0], gitFlag)];

  const report = await importSkills(sources, target, { force, warnings });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(RULE);
    console.log(`Target:  ${report.targetDir}`);
    console.log(`Force:   ${report.force}`);
    console.log(`Total:   ${report.total}`);
    console.log(`Imported:        ${report.imported}`);
    console.log(`Overwritten:     ${report.overwritten}`);
    console.log(`Skipped (exists):${report.skipped}`);
    console.log(`Rejected:        ${report.rejected}`);
    console.log(RULE);
    for (const item of report.items) {
      const rel = item.sourcePath.replace(/\\/g, '/');
      console.log(`  ${item.status.toUpperCase().padEnd(10)} ${item.name || '(no name)'}  <-  ${rel}`);
      for (const issue of item.issues ?? []) {
        console.log(`             [${issue.field}] ${issue.message}`);
      }
    }
    console.log(RULE);
    console.log(`Report: logs/corpus-import-${report.date}.json`);
  }

  for (const w of warnings) {
    console.error(`  WARN ${w}`);
  }

  if (report.rejected > 0) process.exit(1);
}

/**
 * Entry point called by `bin/skill-router.mjs`.
 *
 * @param {string[]} argv
 */
export async function main(argv) {
  const sub = argv[0];
  const rest = argv.slice(1);
  const warnings = [];

  if (!sub || sub === '--help' || sub === '-h' || sub === 'help') {
    usage();
    return;
  }

  if (rest.includes('--help') || rest.includes('-h')) {
    usage();
    return;
  }

  try {
    switch (sub) {
      case 'fetch':
        return await cmdFetch(rest, warnings);
      case 'validate':
        return await cmdValidate(rest, warnings);
      case 'stats':
        return await cmdStats(rest, warnings);
      case 'import':
        return await cmdImport(rest, warnings);
      default:
        console.error(`Unknown corpus subcommand: ${sub}`);
        usage(console.error);
        process.exit(1);
    }
  } catch (err) {
    // No silent failures: a fetch or write error is reported with its cause and
    // the command fails rather than reporting a clean run.
    console.error(`corpus ${sub} failed: ${err.message}`);
    process.exit(1);
  }
}
