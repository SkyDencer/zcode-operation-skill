/**
 * Corpus fetcher tests (Sub-phase 7.2).
 *
 * Covers the two source types the fetcher supports:
 *   - `local` — a directory scanned recursively for SKILL.md
 *   - `git`   — a repository shallow-cloned into a temp directory, with the
 *               temp directory removed in a finally block on both the success
 *               and the failure path
 * plus deduplication across overlapping sources in fetchFromSources().
 *
 * The git tests use a real repository created locally with `git init`, so they
 * exercise the real clone path without any network access.
 *
 * Scope note: this file covers the metadata-only contract (fetchFromGit) and
 * local scanning. The copy path -- importing from a live git clone, and
 * deduplicating a clone against a local source that contains the same skill --
 * is in tests/corpus/git-import.test.mjs.
 *
 * Under test: src/corpus/fetcher.mjs, src/corpus/scan.mjs, src/corpus/dedupe.mjs
 */
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  fetchFromLocal,
  fetchFromGit,
  fetchFromSources,
  normalizeSource,
} from '../../src/corpus/fetcher.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
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

const tmp = mkdtempSync(join(tmpdir(), 'corpus-fetcher-'));

try {
  // ── Section 1: fetchFromLocal ──────────────────────────────────────────────

  console.log('\n=== Section 1: fetchFromLocal ===');

  const warnings = [];
  const local = await fetchFromLocal(FIXTURES, { warnings });
  assertEqual(local.length, 8, 'fetchFromLocal() finds all 8 fixture SKILL.md files');
  assertEqual(warnings.length, 0, 'a clean tree produces no warnings');
  assert(
    local.every((s) => s.path.endsWith('SKILL.md')),
    'every record points at a SKILL.md',
  );
  assert(
    local.every((s) => s.source === 'local' && s.sourceRef === resolve(FIXTURES)),
    'every record is tagged source=local with the resolved source root',
  );
  assert(
    local.every((s) => typeof s.dir === 'string' && existsSync(s.dir)),
    'every record carries the directory holding the SKILL.md',
  );
  const names = local.map((s) => s.name);
  assert(
    names.join(',') === [...names].sort((a, b) => a.localeCompare(b)).join(','),
    'records are sorted by name',
  );
  assert(
    local.find((s) => s.name === 'backend-cache-priming')?.description.length > 40,
    'a frontmatter description is carried onto the record',
  );
  assertEqual(
    local.find((s) => s.name === 'testing-contract-first')?.domains.join(','),
    'testing',
    'a domains list is carried onto the record',
  );

  // A file with no frontmatter still yields a record (with an empty name) so
  // the validator, not the fetcher, decides what is unusable.
  const noFm = local.find((s) => s.path.includes('no-frontmatter'));
  assert(Boolean(noFm), 'a SKILL.md without frontmatter is still returned');
  assertEqual(noFm?.name, '', 'that record carries an empty name');

  let threw = false;
  try {
    await fetchFromLocal(join(tmp, 'no-such-directory'));
  } catch (err) {
    threw = true;
    assert(/not found/i.test(err.message), 'fetchFromLocal() names the missing path in its error');
  }
  assert(threw, 'fetchFromLocal() throws on a missing directory rather than returning []');

  // maxDepth is honoured.
  const deepRoot = join(tmp, 'deep');
  mkdirSync(join(deepRoot, 'a', 'b', 'c', 'd', 'e'), { recursive: true });
  writeFileSync(
    join(deepRoot, 'a', 'b', 'c', 'd', 'e', 'SKILL.md'),
    '---\nname: backend-deep-skill\ndescription: ' + 'x'.repeat(60) + '\n---\n\nbody\n',
    'utf-8',
  );
  const depthWarn = [];
  assertEqual((await fetchFromLocal(deepRoot, { maxDepth: 3, warnings: depthWarn })).length, 0, 'maxDepth=3 does not reach a level-6 skill');
  assert(depthWarn.length > 0, 'hitting the depth limit is reported as a warning, not silently dropped');
  assertEqual((await fetchFromLocal(deepRoot)).length, 1, 'the default depth reaches the level-6 skill');

  // ── Section 2: fetchFromGit ────────────────────────────────────────────────

  console.log('\n=== Section 2: fetchFromGit ===');

  const repo = join(tmp, 'source-repo');
  mkdirSync(join(repo, 'backend', 'gql'), { recursive: true });
  writeFileSync(
    join(repo, 'backend', 'gql', 'SKILL.md'),
    '---\nname: backend-git-skill\ndescription: A skill that only exists inside a git clone, used to prove the fetchFromGit path really clones the repository before scanning it for manifests\ndomains:\n  - backend\n---\n\nbody\n',
    'utf-8',
  );
  writeFileSync(join(repo, 'README.md'), 'not a skill\n', 'utf-8');
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'corpus-test',
    GIT_AUTHOR_EMAIL: 'corpus@test.invalid',
    GIT_COMMITTER_NAME: 'corpus-test',
    GIT_COMMITTER_EMAIL: 'corpus@test.invalid',
  };
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, stdio: 'pipe', env: gitEnv });
  execFileSync('git', ['add', '-A'], { cwd: repo, stdio: 'pipe', env: gitEnv });
  execFileSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: repo, stdio: 'pipe', env: gitEnv });

  const gitTempRoot = join(tmp, 'clones');
  mkdirSync(gitTempRoot, { recursive: true });
  const gitWarnings = [];
  const cloned = await fetchFromGit(repo, { tempRoot: gitTempRoot, warnings: gitWarnings });
  assertEqual(cloned.length, 1, 'fetchFromGit() finds the one SKILL.md in the cloned repository');
  assertEqual(cloned[0]?.name, 'backend-git-skill', 'the cloned record carries the skill name');
  assertEqual(cloned[0]?.source, 'git', 'the cloned record is tagged source=git');
  assertEqual(cloned[0]?.sourceRef, repo, 'the cloned record carries the repository as sourceRef');
  assert(
    cloned[0]?.path.includes('skill-router-corpus-'),
    'the record was read from inside a temporary clone directory',
  );
  assertEqual(gitWarnings.length, 0, 'a successful clone produces no warnings');
  assertEqual(readdirSync(gitTempRoot).length, 0, 'the temporary clone directory is removed on the success path');

  // A failed clone must throw, must include git's own message, and must still
  // clean up the temporary directory it created.
  const notARepo = join(tmp, 'not-a-repo');
  mkdirSync(notARepo, { recursive: true });
  const failTempRoot = join(tmp, 'clones-fail');
  mkdirSync(failTempRoot, { recursive: true });
  const failWarnings = [];
  let cloneThrew = false;
  try {
    await fetchFromGit(notARepo, { tempRoot: failTempRoot, warnings: failWarnings });
  } catch (err) {
    cloneThrew = true;
    assert(
      err.message.startsWith('git clone failed for'),
      'a failed clone throws an error that names the source',
    );
    assert(
      err.message.length > 'git clone failed for '.length,
      'the clone error carries git stderr rather than a bare message',
    );
  }
  assert(cloneThrew, 'fetchFromGit() throws instead of returning an empty list on a failed clone');
  assertEqual(readdirSync(failTempRoot).length, 0, 'the temporary clone directory is removed on the failure path');

  // ── Section 3: fetchFromSources and deduplication ──────────────────────────

  console.log('\n=== Section 3: fetchFromSources ===');

  // The fixture tree and the git repository hold different skills, so listing
  // the fixture tree twice plus the repo gives 8 + 1 records. The local
  // duplicate is collapsed by the real-path key; the git record survives on its
  // own. Deduplication *across* sources — the same skill reached both locally
  // and through a clone — is pinned in tests/corpus/git-import.test.mjs.
  const dedupeWarnings = [];
  const fromBoth = await fetchFromSources(
    [
      { type: 'local', path: FIXTURES },
      { type: 'local', path: FIXTURES },
      { type: 'git', url: repo },
    ],
    { tempRoot: gitTempRoot, warnings: dedupeWarnings },
  );
  assertEqual(fromBoth.length, 9, 'the same source listed twice contributes each skill once');
  assertEqual(fromBoth.filter((s) => s.source === 'local').length, 8, 'all 8 local records survive deduplication');
  assertEqual(fromBoth.filter((s) => s.source === 'git').length, 1, 'the git record survives');
  assert(
    dedupeWarnings.some((w) => w.startsWith('duplicate skill skipped:')),
    'the deduplicated copy is reported as a warning, not dropped silently',
  );
  assertEqual(
    dedupeWarnings.filter((w) => w.startsWith('duplicate skill skipped:')).length,
    8,
    'exactly 8 duplicates are dropped, one per fixture skill',
  );

  // The same repository listed twice used to produce two records and no
  // warning: each git descriptor got its own mkdtemp parent, so the realpath
  // keys could never collide.
  const sameRepoTwice = [];
  const doubled = await fetchFromSources(
    [{ type: 'git', url: repo }, { type: 'git', url: repo }],
    { tempRoot: gitTempRoot, warnings: sameRepoTwice },
  );
  assertEqual(doubled.length, 1, 'the same git repository listed twice yields one record');
  assert(
    sameRepoTwice.some((w) => w.startsWith('duplicate skill skipped:')),
    'the duplicate git clone is reported as a warning rather than imported twice',
  );

  const mixed = await fetchFromSources(
    [{ type: 'local', path: FIXTURES }, { type: 'git', url: repo }],
    { tempRoot: gitTempRoot },
  );
  assertEqual(mixed.length, 9, 'fetchFromSources() merges a local and a git source');

  let descriptorThrew = false;
  try {
    await fetchFromSources([{ type: 'svn', path: FIXTURES }]);
  } catch (err) {
    descriptorThrew = true;
    assert(/Unknown source type/.test(err.message), 'an unknown source type is named in the error');
  }
  assert(descriptorThrew, 'fetchFromSources() rejects an unknown source type');

  let nonArrayThrew = false;
  try {
    await fetchFromSources(FIXTURES);
  } catch (err) {
    nonArrayThrew = true;
  }
  assert(nonArrayThrew, 'fetchFromSources() rejects a non-array argument');

  // ── Section 4: normalizeSource ────────────────────────────────────────────

  console.log('\n=== Section 4: normalizeSource ===');

  assertEqual(normalizeSource('some/dir').type, 'local', 'a bare string is shorthand for a local source');
  assertEqual(normalizeSource('some/dir').path, 'some/dir', 'the bare string becomes the path');
  assertEqual(normalizeSource({ type: 'git', url: 'u' }).type, 'git', 'a git descriptor keeps its type');
  for (const [descriptor, pattern] of [
    [{ type: 'local' }, /requires a "path"/],
    [{ type: 'git' }, /requires a "url"/],
  ]) {
    let t = false;
    try {
      normalizeSource(descriptor);
    } catch (err) {
      t = true;
      assert(pattern.test(err.message), `an incomplete descriptor throws: ${pattern.source}`);
    }
    assert(t, 'an incomplete source descriptor is rejected');
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n=== Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) process.exit(1);
