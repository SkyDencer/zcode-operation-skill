/**
 * Corpus CLI tests (Sub-Phase 7.2).
 *
 * Drives the four `skill-router corpus` subcommands through the real CLI
 * entry point (bin/skill-router.mjs) rather than importing the module, so the
 * subcommand wiring, argument parsing, help text and exit codes are all under
 * test. `corpus stats` is also asserted directly against corpusStats() so the
 * counts are pinned independently of the console formatting.
 *
 * Under test: src/cli/corpus.mjs, bin/skill-router.mjs, src/corpus/importer.mjs
 */
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { corpusStats } from '../../src/corpus/importer.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const CLI = resolve(ROOT, 'bin', 'skill-router.mjs');
const FIXTURES = resolve(__dirname, 'fixtures');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  + ${message}`);
  } else {
    failed++;
    console.error(`  x ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

/**
 * Run the real CLI. Returns { status, stdout, stderr, all }.
 */
function runCli(args) {
  const r = spawnSync('node', [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
  });
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  return { status: r.status, stdout, stderr, all: stdout + stderr };
}

const tmp = mkdtempSync(join(tmpdir(), 'corpus-cli-'));

try {
  // ── Section 1: help and unknown subcommand ─────────────────────────────────

  console.log('\n=== Section 1: help and dispatch ===');

  const noArgs = runCli(['corpus']);
  assertEqual(noArgs.status, 0, '`corpus` with no subcommand prints usage and exits 0');
  assert(noArgs.all.includes('corpus <subcommand>'), 'the usage block names the subcommand group');
  for (const sub of ['fetch', 'validate', 'stats', 'import']) {
    assert(noArgs.all.includes(sub), `the usage block documents the ${sub} subcommand`);
  }

  const help = runCli(['corpus', '--help']);
  assertEqual(help.status, 0, '`corpus --help` exits 0');
  assert(help.all.includes('corpus fetch'), '`corpus --help` prints the same usage block');

  const unknown = runCli(['corpus', 'frobnicate']);
  assertEqual(unknown.status, 1, 'an unknown corpus subcommand exits 1');
  assert(unknown.all.includes('Unknown corpus subcommand: frobnicate'), 'the unknown subcommand is named on stderr');

  // The bin resolves src/cli/<name>.mjs, so `corpus` must be registered there.
  const helpIndex = runCli(['help']);
  assert(helpIndex.all.includes('corpus'), '`help` lists the corpus subcommand');

  // ── Section 2: corpus stats ────────────────────────────────────────────────

  console.log('\n=== Section 2: corpus stats ===');

  const stats = await corpusStats(FIXTURES);
  assertEqual(stats.total, 8, 'corpusStats() counts all 8 fixture skills');
  assertEqual(stats.valid, 5, 'corpusStats() counts 5 valid fixture skills');
  assertEqual(stats.invalid, 3, 'corpusStats() counts 3 invalid fixture skills');
  assertEqual(stats.valid + stats.invalid, stats.total, 'valid + invalid equals total');
  assertEqual(stats.warnings.length, 0, 'a clean fixture tree produces no warnings');
  assertEqual(stats.issuesByField.name, 2, 'the name field has 2 issues (missing name, bad shape)');
  assertEqual(stats.issuesByField.frontmatter, 1, 'the frontmatter field has 1 issue');
  assertEqual(stats.issuesByField.description, 2, 'the description field has 2 issues');
  assertEqual(
    Object.values(stats.issuesByField).reduce((a, b) => a + b, 0),
    5,
    'the 3 invalid fixtures produce 5 issues in total',
  );
  // A skill may declare several domains, so the domain histogram counts
  // declarations, not skills: backend is declared by cache-priming,
  // queue-backoff, router-python and the two broken fixtures that still parse.
  assertEqual(stats.domains.backend, 5, 'the backend domain is declared 5 times');
  assertEqual(stats.domains.frontend, 1, 'the frontend domain appears once');
  assertEqual(stats.domains.testing, 1, 'the testing domain appears once');
  assertEqual(stats.domains.meta, 1, 'the meta domain appears once');
  assertEqual(stats.domains.diagnostics, 1, 'the diagnostics domain appears once');
  assert(stats.avgDescriptionLength > 0, 'the average description length is computed');
  assert(stats.avgContentTokens > 0, 'the average content token count is computed');

  // The shipped corpus is all-valid under these four rules.
  const shipped = await corpusStats(resolve(ROOT, 'data', 'skills'));
  assertEqual(shipped.total, 54, 'data/skills holds 54 skills');
  assertEqual(shipped.invalid, 0, 'every shipped skill passes the four corpus rules');
  assertEqual(shipped.valid, 54, 'corpusStats() agrees: 54 valid');

  // A tree with 3 invalid skills exits 1: `stats` and `validate` share the
  // invalid-count rule, so a stats run can gate a corpus. This assertion used
  // to expect 0, which is the bug the module header promised against.
  const statsCli = runCli(['corpus', 'stats', FIXTURES]);
  assertEqual(statsCli.status, 1, '`corpus stats` exits 1 when any skill is invalid');
  assert(statsCli.stdout.includes('Total skills:             8'), '`corpus stats` prints the total');
  assert(statsCli.stdout.includes('Valid skills:             5'), '`corpus stats` prints the valid count');
  assert(statsCli.stdout.includes('Invalid skills:           3'), '`corpus stats` prints the invalid count');
  assert(statsCli.stdout.includes('name: 2'), '`corpus stats` breaks issues down by field');

  const statsJson = runCli(['corpus', 'stats', FIXTURES, '--json']);
  assertEqual(statsJson.status, 1, '`corpus stats --json` exits 1 when any skill is invalid');
  const parsedStats = JSON.parse(statsJson.stdout);
  assertEqual(parsedStats.total, 8, '`corpus stats --json` reports total=8');
  assertEqual(parsedStats.valid, 5, '`corpus stats --json` reports valid=5');
  assertEqual(parsedStats.invalid, 3, '`corpus stats --json` reports invalid=3');

  // A clean tree still exits 0 — the exit code tracks the invalid count, not
  // merely "stats ran".
  const statsClean = runCli(['corpus', 'stats', resolve(ROOT, 'data', 'skills')]);
  assertEqual(statsClean.status, 0, '`corpus stats` on the all-valid shipped corpus exits 0');
  assert(statsClean.stdout.includes('Invalid skills:           0'), 'the shipped corpus reports 0 invalid');

  const statsMissing = runCli(['corpus', 'stats']);
  assertEqual(statsMissing.status, 1, '`corpus stats` with no directory exits 1');
  const statsNoDir = runCli(['corpus', 'stats', join(tmp, 'nope')]);
  assertEqual(statsNoDir.status, 1, '`corpus stats` on a missing directory exits 1');
  assert(statsNoDir.all.includes('Directory not found'), 'the missing directory is named');

  // ── Section 3: corpus validate ─────────────────────────────────────────────

  console.log('\n=== Section 3: corpus validate ===');

  const validateCli = runCli(['corpus', 'validate', FIXTURES]);
  assertEqual(validateCli.status, 1, '`corpus validate` exits 1 when any skill is invalid');
  assert(validateCli.stdout.includes('Total:     8'), '`corpus validate` prints the total');
  assert(validateCli.stdout.includes('Valid:     5'), '`corpus validate` prints the valid count');
  assert(validateCli.stdout.includes('Invalid:   3'), '`corpus validate` prints the invalid count');
  assert(validateCli.stdout.includes('PASS  backend/cache-priming/SKILL.md'), 'a valid fixture is listed as PASS');
  assert(validateCli.stdout.includes('FAIL  broken/bad-name-shape/SKILL.md'), 'an invalid fixture is listed as FAIL');
  assert(validateCli.stdout.includes('[name] Name "Observability" does not match'), 'the name-shape issue is printed');
  assert(validateCli.stdout.includes('[frontmatter]'), 'the frontmatter issue is printed');

  const validateJson = runCli(['corpus', 'validate', FIXTURES, '--json']);
  const parsedValidate = JSON.parse(validateJson.stdout);
  assertEqual(parsedValidate.total, 8, '`corpus validate --json` reports total=8');
  assertEqual(parsedValidate.valid, 5, '`corpus validate --json` reports valid=5');
  assertEqual(parsedValidate.invalid, 3, '`corpus validate --json` reports invalid=3');
  assertEqual(parsedValidate.skills.length, 8, '`corpus validate --json` lists all 8 skills');

  // A tree with no invalid skills exits 0.
  const cleanDir = join(tmp, 'clean');
  const validateClean = runCli(['corpus', 'validate', resolve(ROOT, 'data', 'skills')]);
  assertEqual(validateClean.status, 0, '`corpus validate` on the shipped corpus exits 0');
  assert(validateClean.stdout.includes('Invalid:   0'), 'the shipped corpus reports 0 invalid');
  assertEqual(existsSync(cleanDir), false, 'the unused cleanDir path was never created');

  // ── Section 4: corpus fetch ────────────────────────────────────────────────

  console.log('\n=== Section 4: corpus fetch ===');

  const fetchCli = runCli(['corpus', 'fetch', FIXTURES]);
  assertEqual(fetchCli.status, 0, '`corpus fetch` on the fixture tree exits 0');
  assert(fetchCli.stdout.includes('Found:   8 SKILL.md file(s)'), '`corpus fetch` counts the discovered skills');
  assert(fetchCli.stdout.includes('backend-cache-priming'), '`corpus fetch` lists the skill names');

  const fetchTo = join(tmp, 'manifest');
  const fetchManifest = runCli(['corpus', 'fetch', FIXTURES, '--to', fetchTo]);
  assertEqual(fetchManifest.status, 0, '`corpus fetch --to` exits 0');
  assert(existsSync(join(fetchTo, 'corpus-fetch.json')), '`corpus fetch --to` writes corpus-fetch.json');
  const manifest = JSON.parse(readFileSync(join(fetchTo, 'corpus-fetch.json'), 'utf-8'));
  assertEqual(manifest.total, 8, 'the manifest records 8 skills');
  assertEqual(manifest.source.type, 'local', 'the manifest records the source type');

  const fetchMissing = runCli(['corpus', 'fetch']);
  assertEqual(fetchMissing.status, 1, '`corpus fetch` with no source exits 1');
  const fetchBad = runCli(['corpus', 'fetch', join(tmp, 'nope')]);
  assertEqual(fetchBad.status, 1, '`corpus fetch` on a missing directory exits 1');
  assert(fetchBad.all.includes('corpus fetch failed'), 'a fetch failure is reported, not swallowed');

  // ── Section 5: corpus import ───────────────────────────────────────────────

  console.log('\n=== Section 5: corpus import ===');

  const target = join(tmp, 'import-target');
  const importCli = runCli(['corpus', 'import', FIXTURES, '--target', target]);
  assertEqual(importCli.status, 1, '`corpus import` exits 1 when a skill is rejected');
  assert(importCli.stdout.includes('Imported:        5'), '`corpus import` reports 5 imported');
  assert(importCli.stdout.includes('Rejected:        3'), '`corpus import` reports 3 rejected');
  assert(existsSync(join(target, 'backend', 'cache-priming', 'SKILL.md')), 'the import wrote the valid skills');
  assert(existsSync(resolve(ROOT, 'logs', `corpus-import-${new Date().toISOString().slice(0, 10)}.json`)), 'the CLI import wrote a dated report under logs/');

  const importAgain = runCli(['corpus', 'import', FIXTURES, '--target', target]);
  assertEqual(importAgain.status, 1, 'the second import still exits 1 because of the rejections');
  assert(importAgain.stdout.includes('Skipped (exists):5'), 'the second import skips the 5 existing skills');

  const importForce = runCli(['corpus', 'import', FIXTURES, '--target', target, '--force']);
  assert(importForce.stdout.includes('Overwritten:     5'), '`--force` overwrites the 5 existing skills');

  const importNoSource = runCli(['corpus', 'import', '--target', target]);
  assertEqual(importNoSource.status, 1, '`corpus import` with no source exits 1');
  assert(importNoSource.all.includes('Usage: node bin/skill-router.mjs corpus import'), 'the import usage line is printed');

  const importJson = runCli(['corpus', 'import', FIXTURES, '--target', join(tmp, 'json-target'), '--json']);
  const parsedImport = JSON.parse(importJson.stdout);
  assertEqual(parsedImport.imported, 5, '`corpus import --json` reports 5 imported');
  assertEqual(parsedImport.rejected, 3, '`corpus import --json` reports 3 rejected');
  assertEqual(parsedImport.items.length, 8, '`corpus import --json` lists all 8 items');

  // ── Section 6: a flag with no value is a usage error ───────────────────────

  console.log('\n=== Section 6: value-less flags ===');

  // `--to` at the end of the line used to be silently dropped, so the command
  // printed a clean successful run having written no manifest at all.
  const fetchDangling = runCli(['corpus', 'fetch', FIXTURES, '--to']);
  assertEqual(fetchDangling.status, 1, '`corpus fetch <src> --to` with no value exits 1');
  assert(fetchDangling.all.includes('--to requires a value'), 'the value-less --to is named on stderr');
  assert(fetchDangling.all.includes('Usage: node bin/skill-router.mjs corpus fetch'), 'the fetch usage line is printed');

  const fetchFlagSwallow = runCli(['corpus', 'fetch', FIXTURES, '--to', '--json']);
  assertEqual(fetchFlagSwallow.status, 1, '`--to` followed by another flag exits 1 rather than consuming it');

  const importDangling = runCli(['corpus', 'import', FIXTURES, '--target']);
  assertEqual(importDangling.status, 1, '`corpus import <src> --target` with no value exits 1');
  assert(importDangling.all.includes('--target requires a value'), 'the value-less --target is named on stderr');

  const manifestDangling = runCli(['corpus', 'import', '--from-manifest']);
  assertEqual(manifestDangling.status, 1, '`--from-manifest` with no value exits 1');

  // ── Section 7: import from a fetch manifest ────────────────────────────────

  console.log('\n=== Section 7: import --from-manifest ===');

  const manifestDir = join(tmp, 'manifest-src');
  const manifestWrite = runCli(['corpus', 'fetch', FIXTURES, '--to', manifestDir]);
  assertEqual(manifestWrite.status, 0, '`corpus fetch --to` writes a manifest and exits 0');
  const manifestFile = join(manifestDir, 'corpus-fetch.json');
  assert(existsSync(manifestFile), '`corpus fetch --to` writes corpus-fetch.json');
  const written = JSON.parse(readFileSync(manifestFile, 'utf-8'));
  assertEqual(written.total, 8, 'the manifest records 8 skills');
  assertEqual(written.source.type, 'local', 'the manifest records the source type');
  assertEqual(written.kind, 'skill-router-corpus-fetch', 'the manifest carries its identifying kind');
  assert(
    written.skills.every((s) => typeof s.files?.['SKILL.md'] === 'string' && s.files['SKILL.md'].length > 0),
    'every manifest record carries the SKILL.md body, not a dead path',
  );
  assert(
    written.skills.every((s) => typeof s.path !== 'string' || !existsSync(s.path)),
    'the manifest records no path into a directory that is not there',
  );

  const manifestTarget = join(tmp, 'manifest-target');
  const importManifest = runCli(['corpus', 'import', '--from-manifest', manifestFile, '--target', manifestTarget]);
  assertEqual(importManifest.status, 1, '`corpus import --from-manifest` exits 1 on the 3 invalid fixtures');
  assert(importManifest.stdout.includes('Imported:        5'), 'the manifest import reports 5 imported');
  assert(importManifest.stdout.includes('Rejected:        3'), 'the manifest import reports 3 rejected');
  assert(
    readFileSync(join(manifestTarget, 'backend', 'cache-priming', 'SKILL.md'), 'utf-8') ===
      readFileSync(join(FIXTURES, 'backend', 'cache-priming', 'SKILL.md'), 'utf-8'),
    'a skill imported from a manifest is byte-identical to the source',
  );

  // Deleting the source tree after the fetch must not affect the import: that
  // is the whole point of a self-contained manifest.
  const throwawaySrc = join(tmp, 'throwaway-src');
  const throwawayDir = join(tmp, 'throwaway-manifest');
  mkdirSync(join(throwawaySrc, 'backend', 'throwaway'), { recursive: true });
  writeFileSync(
    join(throwawaySrc, 'backend', 'throwaway', 'SKILL.md'),
    '---\nname: backend-throwaway-skill\ndescription: A skill that only ever existed in a directory deleted before the manifest was imported, proving the manifest carries its own bytes\n---\n\nbody\n',
    'utf-8',
  );
  assertEqual(runCli(['corpus', 'fetch', throwawaySrc, '--to', throwawayDir]).status, 0, 'the throwaway source fetches into a manifest');
  rmSync(throwawaySrc, { recursive: true, force: true });
  const throwawayTarget = join(tmp, 'throwaway-target');
  const throwawayImport = runCli(['corpus', 'import', '--from-manifest', join(throwawayDir, 'corpus-fetch.json'), '--target', throwawayTarget]);
  assertEqual(throwawayImport.status, 0, 'importing a manifest after deleting its source exits 0');
  assert(
    existsSync(join(throwawayTarget, 'backend', 'throwaway-skill', 'SKILL.md')),
    'the skill lands in the target even though its source directory is gone',
  );

  const notAManifest = join(tmp, 'not-a-manifest.json');
  writeFileSync(notAManifest, JSON.stringify({ hello: 'world' }), 'utf-8');
  const badManifest = runCli(['corpus', 'import', '--from-manifest', notAManifest, '--target', join(tmp, 'bad-target')]);
  assertEqual(badManifest.status, 1, 'a JSON file that is not a manifest exits 1');
  assert(badManifest.all.includes('is not a corpus fetch manifest'), 'the rejected file is named as not-a-manifest');

  const bothInputs = runCli(['corpus', 'import', FIXTURES, '--from-manifest', manifestFile, '--target', join(tmp, 'both-target')]);
  assertEqual(bothInputs.status, 1, 'a source and --from-manifest together is a usage error');
  assert(bothInputs.all.includes('mutually exclusive'), 'the conflict between the two inputs is explained');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n=== Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) process.exit(1);
