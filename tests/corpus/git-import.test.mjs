/**
 * Corpus git-source tests (Sub-Phase 7.2 review fix).
 *
 * The whole git half of the source matrix was untested before this file. The
 * suite was green over a dead path: `fetchFromGit()` removed its temporary
 * clone in a `finally` block and returned records whose `path` and `dir` pointed
 * inside that now-deleted directory, and `importSkills()` read and copied those
 * paths *after* the fetch resolved. Every git-sourced skill was therefore
 * rejected with ENOENT and nothing was written.
 *
 * What is pinned here:
 *   1. `importSkills([{type:'git',url:repo}], target)` writes the skill to
 *      `<target>/<domain>/<slug>/SKILL.md` and the temp root is empty afterwards
 *   2. the same, through the real CLI (`corpus import <repo> --git --target`)
 *   3. `fetchFromGit()` really is metadata-only: its records' paths are dead on
 *      return, which is why the importer uses `openSources()` instead
 *   4. a git source that ships `references/` keeps them
 *   5. the same repository listed twice is fetched and imported once
 *   6. a clone of a repository that *contains* a local skill collapses with the
 *      local source to one record
 *
 * Every repository is created locally with `git init`, so the real clone path is
 * exercised with no network access.
 *
 * Under test: src/corpus/fetcher.mjs, src/corpus/git.mjs, src/corpus/dedupe.mjs,
 *             src/corpus/importer.mjs, src/cli/corpus.mjs
 */
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fetchFromGit, openSources } from '../../src/corpus/fetcher.mjs';
import { importSkills } from '../../src/corpus/importer.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const CLI = resolve(ROOT, 'bin', 'skill-router.mjs');
const FIXTURES = resolve(__dirname, 'fixtures');
const DATE = '2026-02-03';

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

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'corpus-test',
  GIT_AUTHOR_EMAIL: 'corpus@test.invalid',
  GIT_COMMITTER_NAME: 'corpus-test',
  GIT_COMMITTER_EMAIL: 'corpus@test.invalid',
};

/**
 * Create a real git repository containing `files` (relative path -> contents).
 *
 * @param {string} dir
 * @param {Record<string, string>} files
 * @returns {string} the repository path
 */
function makeRepo(dir, files) {
  mkdirSync(dir, { recursive: true });
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(dir, ...rel.split('/'));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents, 'utf-8');
  }
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, stdio: 'pipe', env: GIT_ENV });
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'pipe', env: GIT_ENV });
  execFileSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: dir, stdio: 'pipe', env: GIT_ENV });
  return dir;
}

const GIT_SKILL =
  '---\nname: backend-git-skill\ndescription: A skill that only exists inside a git clone, used to prove that a git-sourced import copies the bytes while the clone is still on disk rather than after it has been deleted\ndomains:\n  - backend\n---\n\nbody\n';

const tmp = mkdtempSync(join(tmpdir(), 'corpus-git-'));
const cloneRoot = join(tmp, 'clones');
mkdirSync(cloneRoot, { recursive: true });

try {
  // ── Section 1: importSkills from a git source ──────────────────────────────

  console.log('\n=== Section 1: importSkills from a git source ===');

  const repo = makeRepo(join(tmp, 'repo'), {
    'backend/git-skill/SKILL.md': GIT_SKILL,
    'README.md': 'not a skill\n',
  });

  const target = join(tmp, 'git-target');
  const reportDir = join(tmp, 'reports');
  const warnings = [];
  const report = await importSkills([{ type: 'git', url: repo }], target, {
    tempRoot: cloneRoot,
    reportDir,
    date: DATE,
    warnings,
  });

  assertEqual(report.total, 1, 'the git-sourced import sees the one committed skill');
  assertEqual(report.imported, 1, 'the git-sourced skill is imported, not rejected');
  assertEqual(report.rejected, 0, 'nothing is rejected');
  assertEqual(report.items[0]?.status, 'imported', 'the item status is imported');

  const landed = join(target, 'backend', 'git-skill', 'SKILL.md');
  assert(existsSync(landed), 'the skill lands at <target>/backend/git-skill/SKILL.md');
  // Byte-identity, line endings included: the clone passes
  // `-c core.autocrlf=false`, so a git-sourced import reproduces the committed
  // bytes rather than this machine's CRLF convention.
  assertEqual(
    readFileSync(landed, 'utf-8'),
    GIT_SKILL,
    'the imported SKILL.md is byte-identical to the committed one, line endings included',
  );
  assert(
    !readFileSync(landed, 'utf-8').includes('\r\n'),
    'the clone did not apply core.autocrlf, so the import is reproducible',
  );
  assertEqual(report.items[0]?.source, undefined, 'a manifest-shaped field is not invented on a live record');
  assert(
    report.items[0]?.sourcePath.includes('skill-router-corpus-'),
    'the report records the temporary clone as the source path, which is the copy source',
  );
  assertEqual(readdirSync(cloneRoot).length, 0, 'the temporary clone is removed after the import');
  assertEqual(
    readdirSync(reportDir).length,
    1,
    'the import report is written even on the git path',
  );

  // Re-running is safe: the second import skips rather than clobbering.
  const second = await importSkills([{ type: 'git', url: repo }], target, {
    tempRoot: cloneRoot,
    reportDir,
    date: DATE,
  });
  assertEqual(second.skipped, 1, 'a second git-sourced import skips the existing skill');
  assertEqual(second.imported, 0, 'a second git-sourced import writes nothing new');
  assertEqual(readdirSync(cloneRoot).length, 0, 'the temporary clone is removed on the skip path too');

  // ── Section 2: the same import through the real CLI ────────────────────────

  console.log('\n=== Section 2: corpus import <repo> --git through the CLI ===');

  const cliTarget = join(tmp, 'cli-git-target');
  const cli = spawnSync('node', [CLI, 'corpus', 'import', repo, '--git', '--target', cliTarget], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
  });
  const cliOut = `${cli.stdout ?? ''}${cli.stderr ?? ''}`;
  assertEqual(cli.status, 0, '`corpus import <repo> --git --target <dir>` exits 0');
  assert(cliOut.includes('Imported:        1'), 'the CLI reports 1 imported');
  assert(cliOut.includes('Rejected:        0'), 'the CLI reports 0 rejected');
  assert(
    !cliOut.includes('ENOENT'),
    'the CLI output carries no ENOENT — the clone outlives the copy',
  );
  assert(
    existsSync(join(cliTarget, 'backend', 'git-skill', 'SKILL.md')),
    '`corpus import --git` writes the skill to the target tree',
  );

  // ── Section 3: fetchFromGit is metadata-only, by contract ──────────────────

  console.log('\n=== Section 3: the metadata-only contract ===');

  const metaRecords = await fetchFromGit(repo, { tempRoot: cloneRoot });
  assertEqual(metaRecords.length, 1, 'fetchFromGit() still returns the record');
  assert(
    !existsSync(metaRecords[0].path),
    'fetchFromGit() records point at a directory it has already removed — the documented contract',
  );
  assertEqual(readdirSync(cloneRoot).length, 0, 'fetchFromGit() leaves no clone behind');

  // openSources() is the form the importer uses, and its records are live.
  const open = await openSources([{ type: 'git', url: repo }], { tempRoot: cloneRoot });
  assertEqual(open.records.length, 1, 'openSources() returns the same record');
  assert(existsSync(open.records[0].path), 'openSources() records are readable until release() is called');
  await open.release();
  assertEqual(readdirSync(cloneRoot).length, 0, 'release() removes the clone');
  assert(!existsSync(open.records[0].path), 'after release() the record path is gone, as documented');

  // ── Section 4: a git source that ships extra files ─────────────────────────

  console.log('\n=== Section 4: reference material survives the git path ===');

  const richRepo = makeRepo(join(tmp, 'rich-repo'), {
    'testing/git-rich/SKILL.md':
      '---\nname: testing-git-rich\ndescription: A git-sourced skill that ships a references directory, used to prove the importer copies the whole skill directory and not just the manifest\n---\n\nbody\n',
    'testing/git-rich/references/checklist.md': '# checklist\n\none\ntwo\n',
  });
  const richTarget = join(tmp, 'rich-target');
  const richReport = await importSkills([{ type: 'git', url: richRepo }], richTarget, {
    tempRoot: cloneRoot,
    reportDir,
    date: DATE,
  });
  assertEqual(richReport.imported, 1, 'the skill with reference material is imported');
  assert(
    existsSync(join(richTarget, 'testing', 'git-rich', 'references', 'checklist.md')),
    'references/checklist.md is copied out of the clone along with the SKILL.md',
  );

  // ── Section 5: the same repository listed twice ────────────────────────────

  console.log('\n=== Section 5: deduplication ===');

  const dupWarnings = [];
  const dupRecords = await openSources(
    [{ type: 'git', url: repo }, { type: 'git', url: repo }],
    { tempRoot: cloneRoot, warnings: dupWarnings },
  );
  assertEqual(dupRecords.records.length, 1, 'the same repository listed twice yields one record');
  assert(
    dupWarnings.some((w) => w.startsWith('duplicate skill skipped:')),
    'the dropped duplicate is reported as a warning, not silently discarded',
  );
  await dupRecords.release();

  // ...and importing it twice writes the skill once.
  const dupTarget = join(tmp, 'dup-target');
  const dupReport = await importSkills(
    [{ type: 'git', url: repo }, { type: 'git', url: repo }],
    dupTarget,
    { tempRoot: cloneRoot, reportDir, date: DATE },
  );
  assertEqual(dupReport.total, 1, 'a doubled git source produces one import item, not two');
  assertEqual(dupReport.imported, 1, 'the doubled git source imports the skill once');
  assertEqual(
    dupReport.warnings.filter((w) => w.startsWith('duplicate skill skipped:')).length,
    1,
    'the duplicate is recorded in the import report',
  );

  // A clone of a repository that contains a locally-fetched skill collapses
  // with the local source. Before the fix each git descriptor got its own
  // mkdtemp parent, so the realpath keys could never collide and the same repo
  // listed twice imported twice, silently.
  const overlappingRepo = makeRepo(join(tmp, 'overlap-repo'), {
    'backend/cache-priming/SKILL.md': readFileSync(
      join(FIXTURES, 'backend', 'cache-priming', 'SKILL.md'),
      'utf-8',
    ),
  });
  const overlapWarnings = [];
  const overlap = await openSources(
    [{ type: 'local', path: FIXTURES }, { type: 'git', url: overlappingRepo }],
    { tempRoot: cloneRoot, warnings: overlapWarnings },
  );
  assertEqual(
    overlap.records.length,
    8,
    'a local directory plus a clone of a repository containing it collapse to 8 records, not 9',
  );
  assert(
    overlap.records.every((r) => r.source === 'local'),
    'the first occurrence wins, so the local records are the ones kept',
  );
  assert(
    overlapWarnings.some((w) => w.startsWith('duplicate skill skipped:')),
    'the cross-source duplicate is reported as a warning',
  );
  await overlap.release();

  // A genuinely different skill of the same name in another repository is not
  // collapsed: content is part of the key, so the two imports are both real.
  const variantRepo = makeRepo(join(tmp, 'variant-repo'), {
    'backend/git-skill/SKILL.md': GIT_SKILL.replace('prove that a git-sourced import', 'demonstrate something else, different'),
  });
  const variantTarget = join(tmp, 'variant-target');
  const variantReport = await importSkills(
    [{ type: 'git', url: repo }, { type: 'git', url: variantRepo }],
    variantTarget,
    { tempRoot: cloneRoot, reportDir, date: DATE },
  );
  assertEqual(variantReport.total, 2, 'two repositories with a same-named but different skill keep both records');
  assertEqual(variantReport.imported, 1, 'the first is imported');
  assertEqual(variantReport.skipped, 1, 'the second collides on the target name and is skipped, not silently merged');
  assertEqual(readdirSync(cloneRoot).length, 0, 'every clone is removed in the mixed-source case too');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n=== Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) process.exit(1);
