# Phase 7.2 -- Corpus Tooling

Sub-phase 7.2 of Phase 7 (Hardening and Corpus Truth). The tooling that fetches
and validates large skill corpora, so sub-phase 7.3 can assemble a real
200-skill corpus without hand-editing files.

Every command output quoted below was produced in this pass, on this machine,
with `node <file>` (npm is not on the subprocess PATH here). Exit codes are the
real ones.

**Revision note.** An independent review of the first delivery of this sub-phase
found five defects. All five are fixed and the affected text rewritten; each is
answered in [Review findings and resolutions](#review-findings-and-resolutions)
with the command that reproduces it. Two fixes changed behaviour a caller can
observe (git sources now import, `corpus stats` now exits 1 on an invalid
skill) and one added a new input form (`corpus import --from-manifest`).

## Files added

| Path | Lines | Purpose |
|---|---|---|
| `src/corpus/fetcher.mjs` | 272 | the three fetch entry points and their clone-lifetime contracts |
| `src/corpus/scan.mjs` | 145 | the local directory walk that produces one record per `SKILL.md` |
| `src/corpus/git.mjs` | 101 | `cloneRepo()` — the only module in `src/corpus/` that shells out |
| `src/corpus/dedupe.mjs` | 83 | when two fetched records are the same skill |
| `src/corpus/manifest.mjs` | 252 | the self-contained fetch manifest `fetch --to` writes and `import --from-manifest` reads |
| `src/corpus/validator.mjs` | 209 | the four corpus validation rules |
| `src/corpus/importer.mjs` | 380 | copy validated skills into a target tree, write the import report |
| `src/cli/corpus.mjs` | 345 | the four `corpus` subcommands |
| `src/cli/corpus-args.mjs` | 111 | usage block and flag parsing (a helper, not a subcommand) |
| `tests/corpus/validator-rules.test.mjs` | 185 | 81 assertions |
| `tests/corpus/fetcher-sources.test.mjs` | 281 | 44 assertions |
| `tests/corpus/git-import.test.mjs` | 307 | 40 assertions |
| `tests/corpus/importer-force.test.mjs` | 196 | 48 assertions |
| `tests/corpus/cli-corpus-stats.test.mjs` | 320 | 107 assertions |
| `tests/corpus/fixtures/**/SKILL.md` | 8 files | 5 valid, 3 invalid |

Every new module carries a JSDoc header, no source or test file in the table
above exceeds 400 lines, and no npm dependency was added. (This report and its
companion are split in two for the same reason. `docs/ai-context.md` was already
over the cap at 693 lines before this pass and is a scheduled Phase 7 split --
implementation-plan item 8 -- so it was extended, not split, here.)
`fetcher.mjs`, `scan.mjs`, `git.mjs` and `dedupe.mjs` were one 477-line file in
the first delivery; the split is not cosmetic, because burying the clone
lifetime, the local walk and the deduplication rule together is how the lifetime
bug survived a green suite. Also modified:
`bin/skill-router.mjs` (subcommand list + async `main()` handling),
`src/cli/help.mjs` (subcommand + examples), `package.json` (the corpus test files
added to the `test` chain, the CLI one also to `test:cli`),
`docs/ai-context.md` (new "Corpus Tooling" section, module counts corrected),
`docs/current-state.md` (a new entry-log row; the original 7.2 row is left as a
record of what that pass reported, and its dedup claim is superseded).

## Source types supported

`src/corpus/fetcher.mjs` exports the scan entry point plus three source
strategies. A record is
`{ name, description, keywords, domains, version, path, dir, relPath, contentHash, source, sourceRef }`,
where `relPath` is the SKILL.md's path relative to the source root,
`/`-separated, and `contentHash` is the SHA-256 of the file's text. Both exist
for deduplication; see below.

### `fetchFromLocal(dir, opts)`

Scans `dir` recursively for files named exactly `SKILL.md` and returns one
record per file. Delegates to `scanLocal()` in `src/corpus/scan.mjs`.
`opts.maxDepth` (default 10) bounds the recursion and hitting it is recorded in
`opts.warnings`, not silently truncated. An unreadable subdirectory is recorded
in `opts.warnings` and the walk continues, because one broken subtree should not
hide the rest of a 200-skill corpus. A `SKILL.md` with no frontmatter still
produces a record, with an empty `name`, so the validator -- not the fetcher --
decides what is unusable. Records are sorted by name, then by path, so two runs
produce the same order. A missing directory throws
(`Local source not found: <path>`) rather than returning an empty list.

### The clone lifetime

A git clone lives in a temporary directory, which creates exactly one hazard: a
function that removes the clone before returning hands back records whose `path`
and `dir` point at a directory that no longer exists, so anything that reads
those records afterwards fails with ENOENT. That is not hypothetical -- it is
what the first delivery of this sub-phase did, and it made **every** git-sourced
import fail. The three entry points therefore differ *only* in who owns the
clone, and each says so in its own JSDoc:

| Function | Clone is removed | Contract |
|---|---|---|
| `fetchFromGit(url, opts)` | before it returns (`finally`) | **Records are metadata only.** `path`/`dir` are dead on return. Fine for a listing, fatal for a copy. |
| `openSources(sources, opts)` | by the caller's `release()` | Records stay readable until `release()`. This is what `importSkills()` uses, so the copy happens while the clone is on disk. |
| `fetchFromSources(sources, opts)` | before it returns | `openSources()` plus an immediate `release()` -- the `fetchFromGit` contract over a list. |

`cloneRepo()` in `src/corpus/git.mjs` is the only place a clone is created, and
it never removes a clone it successfully created; it removes its own temp
directory when the clone *fails*, so a failed clone does not leak either. A
cleanup failure is pushed into `opts.warnings` rather than swallowed: a leftover
clone under the OS temp directory is a real disk leak. `importSkills()` wraps
its whole copy loop in a `try` whose `finally` calls `release()`, so the clone
is removed on the success path, the skip path and a throw.

The clone is made with `-c core.autocrlf=false -c core.eol=lf`. Without that,
Windows' default `core.autocrlf=true` rewrites LF as CRLF at checkout, so a
git-sourced import writes different bytes than the repository holds and a
`--force` re-import on another machine rewrites the same skill again. A corpus
import has to be reproducible to be re-runnable.

### `fetchFromGit(url, opts)`

Shallow-clones (`git clone --depth 1 --single-branch --quiet <url> <tempdir>/repo`)
and delegates to `fetchFromLocal()`.

- The temp parent is created with `mkdtemp()` under `opts.tempRoot` (default
  `os.tmpdir()`); `repo` is a child of it, because `git clone` refuses to write
  into an existing directory.
- Records are re-tagged `source: 'git'` with `sourceRef` set to the URL, because
  after a clone they all live under the temp path.
- A failed clone throws `git clone failed for <url>: <git stderr>`. The error
  carries git's own message, never a bare "clone failed".
- `opts.timeoutMs` (default 120000) bounds the clone.
- Records are sorted by name, then by path.

Because of the lifetime contract above, `fetchFromGit` is **not** what the
importer uses. It is what `corpus fetch` uses when it is only listing.

### `fetchFromSources(sources, opts)`

Takes an array of descriptors:

```js
{ type: 'local', path: '...' }   //   { type: 'git', url: '...' }
```

and merges them. A bare string is shorthand for `{ type: 'local', path }`.
An unknown `type`, or a `local` descriptor with no `path` / `git` descriptor
with no `url`, throws.

### Deduplication (`src/corpus/dedupe.mjs`)

Two keys are used, both of them stable across clones:

- **identity** -- "the same file". For a local source, the real path. For a git
  source, the normalized repository reference (resolved for a local path;
  lower-cased, trailing `/` and `.git` stripped, for a URL) plus the SKILL.md's
  path *within* the clone.
- **content** -- "the same skill by another route". Name plus SHA-256 of the
  bytes. Only applied when the record has a non-empty name, so several broken
  `SKILL.md` files with identical empty bodies stay two distinct problems.

The first occurrence wins and keeps its `source` / `sourceRef`, so ordering is
meaningful. Each dropped duplicate is pushed into `opts.warnings` as
`duplicate skill skipped: <path> already fetched from <ref>` -- deduplication is
reported, never silent.

The first delivery keyed on real path alone. That collapses a local directory
listed twice and nothing else: every git descriptor got its own `mkdtemp`
parent, so two clones of the same repository produced different real paths and
the same skill was fetched -- and imported -- twice, with no warning at all.
Measured on `fetchFromSources([{git,repo},{git,repo}])`, before and after:

```
before: 2 record(s); warnings: []
after:  1 record(s); warnings: ["duplicate skill skipped:
        ...\skill-router-corpus-08Egak\repo\backend\caching-headers\SKILL.md
        already fetched from tmp/gitrepo"]
```

## Validation rules

`validateSkill(skillPath)` in `src/corpus/validator.mjs` reads a file and hands
it to `validateSkillContent(content)`, which applies the rules to text held in
memory and returns `{ valid, issues, parsed }`. `parsed` is
`{ hasFrontmatter, name, description, keywords, domains, version,
descriptionLength, contentTokens }`.

`validateSkillContent` is public because a fetch manifest carries the SKILL.md
bodies with it and has no file to read. Validating a path that does not exist is
precisely the defect that broke git imports; doing it again for manifests would
repeat it.

Four rules decide `valid`:

| # | Field | Rule |
|---|---|---|
| 1 | `frontmatter` | a `---` delimited block is present at the top of the file |
| 2 | `name` | present and non-empty after trimming |
| 3 | `description` | present, and 40-400 characters inclusive |
| 4 | `name` | matches the `{domain}-{specific}` shape |

Rule 4 is `NAME_SHAPE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/` -- two or more
lowercase alphanumeric segments joined by single hyphens.

**Where that shape comes from.** All 60 names in `data/skills/` and
`router-skills/` are lowercase-hyphenated with the domain first --
`backend-eloquent`, `testing-integration-testing`, and the six dispatchers
`router-next` .. `router-meta` (`src/config/aliases.mjs:29-34` keys those six).
`src/quality/validator.mjs` enforces the same idea as "name starts with one of
its declared domains" (`src/quality/validator.mjs:169-179`), which cannot be
applied to a foreign corpus whose domains `data/domains/` has never
registered, so the structural form is what is enforced here.
`testing-integration-testing` and `router-python` pass; `backend` alone,
`Backend-Eloquent`, `backend_`, `-backend`, `backend_eloquent`,
`backend--eloquent` and `back end eloquent` fail.

**Deliberately not checked here**, unlike `src/quality/validator.mjs`: keyword
count (3-15), content token count (100-800), and domain registration against
`data/domains/`. The last one is the important omission: `data/domains/` is this
project's registry, and a harvested corpus legitimately brings domains the
project has not seen. The in-project quality validator still enforces all six
rules for `data/skills/`; this gate is the pre-filter in front of it.

`validateSkills(paths)` runs the same check over a list and turns an unreadable
file into an invalid entry carrying `Cannot read file: <err>` on the `file`
field, so one bad file does not abort a 200-skill batch. `validateSkill()`
throws only for a file it cannot read; a malformed file is a returned issue, not
an exception. `validateSkillContent()` cannot throw at all.

## Import behavior

`importSkills(sources, targetDir, opts)` in `src/corpus/importer.mjs`:

1. Opens every source with `openSources()` (so it inherits the deduplication,
   the warnings, and a clone that outlives the copy).
2. Creates `targetDir` if it does not exist, and records that it did.
3. Validates each fetched skill. An invalid skill is `rejected` with its issues
   and **nothing is written for it** -- no directory is created.
4. Derives the target directory from the validated (trimmed) name, splitting on
   the first hyphen: `backend-cache-priming` -> `<target>/backend/cache-priming/SKILL.md`,
   `router-python` -> `<target>/router/python/SKILL.md`. This is the same rule
   `src/import/importer.mjs:87-99` uses.
5. **Never overwrites without `opts.force`.** An existing `SKILL.md` at the
   target is `skipped` and left byte-for-byte alone; with `force: true` the same
   file is `overwritten`.
6. Copies the whole skill directory recursively, not just `SKILL.md`, so a skill
   that ships `references/` or `scripts/` keeps them. A record that came from a
   manifest is written from its embedded `files` map instead, with every relative
   path re-checked against the destination root.
7. Releases every temporary clone in a `finally` wrapping steps 3-6.
8. Writes `logs/corpus-import-YYYY-MM-DD.json` (local-date stamp; overridable
   with `opts.reportDir`, `opts.date`, `opts.writeReport`).

The four statuses are `imported`, `overwritten`, `skipped`, `rejected`.

Containment: the skill `name` is untrusted frontmatter that becomes a directory
path, so it goes through `isSafeName()` and the resolved target through
`isWithinRoot()` (`src/utils/fs.mjs:74-95`) before anything is written -- the same
rule the Phase 6 audit applied to `src/import/importer.mjs`. A manifest's file
paths get the same `isWithinRoot()` check, because they come from a JSON file the
operator may not have written. In practice the name-shape rule refuses a
traversal-shaped name first, so containment is the second line of defence; both
are asserted in `tests/corpus/importer-force.test.mjs` section 5.
`corpusStats(dir)` returns `{ dir, total, valid, invalid, issuesByField,
domains, avgDescriptionLength, avgContentTokens, warnings }`. The `domains`
histogram counts *declarations*, not skills, because a skill may declare several.

## The fetch manifest

`corpus fetch --to <dir>` writes `<dir>/corpus-fetch.json`, and
`corpus import --from-manifest <file>` reads it back. The manifest is
**self-contained**: each record carries the whole skill directory as a `files`
map of relative path to UTF-8 text, and carries **no `path` field at all**.

The first delivery recorded `path` instead, and the file was dead on arrival: a
git source is cloned into a temp directory that `fetch` removes before
returning, so every recorded path pointed at a deleted tree and no code path
read a manifest at all. Its own smoke run made this visible --
`corpus fetch tmp/gitrepo --git --to tmp/fetch-smoke` wrote
`"path": "...\Temp\skill-router-corpus-lKrHGy\repo\backend\caching-headers\SKILL.md"`
and passing it to import gave `Local source not found`.

Two things follow from the manifest being self-contained. It can be imported on
a different machine, or after the source is deleted -- pinned in
`tests/corpus/cli-corpus-stats.test.mjs` section 7, which fetches a throwaway
source into a manifest, deletes the source directory, and then imports the
skill successfully. And **a non-UTF-8 file is refused, not mangled**: each file
is decoded and re-encoded, and if the bytes do not survive the round trip the
file is binary, so it is left out of the manifest with a warning naming it.
Symlinks and other special entries are not carried, matching the importer
's copy, which also skips them.

Reading is strict: a file that is not a manifest, or whose `kind` or `version`
is not recognised, throws and the command exits 1. Silently importing half a
corpus from a mis-identified JSON file is not a failure mode worth having.
`corpus fetch` prints `<repo>::<path within the repo>` for a git record rather
than its absolute path, because that path is inside a clone that no longer
exists by the time anything is printed.

The manifest file format is in
`docs/reports/phase-7.2-corpus-tooling-commands.md`.

## The four CLI commands

Wired into `bin/skill-router.mjs`, which resolves `src/cli/<name>.mjs` from
`process.argv[2]`. `corpus.mjs` is the first subcommand with an **async**
`main()`, so the bin attaches a `.catch()` to a thenable return
(`bin/skill-router.mjs:51-62`); a synchronous subcommand returns `undefined` and
is unaffected. Unlike the rest of the CLI (finding `P6-H-020`), `corpus --help`
really prints help.

```
skill-router corpus fetch    <source> [--to <dir>] [--git] [--json]
skill-router corpus validate <dir> [--json]
skill-router corpus stats    <dir> [--json]
skill-router corpus import   <source> --target <dir> [--force] [--json]
skill-router corpus import   --from-manifest <file> --target <dir> [--force]
```

A `<source>` is a local directory by default; `--git` or a `git:` prefix selects
the git path. Exit codes follow the existing conventions
(`src/cli/import.mjs:258-260`, `src/quality/validator.mjs:327`): 0 when the
command ran and nothing was rejected or found invalid, 1 on a usage error, a
missing path, or one or more rejected/invalid skills.

**`stats` and `validate` share the invalid-count rule.** `corpus stats` on a
tree with any invalid skill exits 1, so a stats run can gate a corpus. The first
delivery documented that contract and did not implement it -- `corpus stats` on
the three-invalid-skill fixture tree exited 0. It went unnoticed because the
only tree the report ever measured with `stats` was `data/skills`, which has
zero invalid skills, so code and contract agreed by accident.

**A flag with no value is a usage error.** `--to` and `--target` are read
through `flagValue()` in `src/cli/corpus-args.mjs`, which exits 1 when the flag
is last on the line or is immediately followed by another flag. The first
delivery tested `argv[i + 1]` and dropped the flag, so
`corpus fetch foo --to` printed a clean successful run having written no
manifest, and `corpus import foo --target` imported into `data/skills` instead of
the directory the operator asked for.

### What the commands printed

The four verification commands named by the brief, their results, the verbatim
transcripts, the test inventory and the full list of checks run are all in
`docs/reports/phase-7.2-corpus-tooling-commands.md`.

| Command | Result |
|---|---|
| `corpus stats data/skills` | 54 total / 54 valid / 0 invalid. **exit 0** |
| `corpus validate tests/corpus/fixtures` | 8 / 5 / 3. **exit 1** |
| `corpus import tests/corpus/fixtures --target tmp/corpus-tooling-smoke` | imported 5, rejected 3. **exit 1** |
| `corpus import tmp/gitrepo --git --target tmp/corpus-git-smoke` | **imported 1, rejected 0. exit 0** |

`tmp/gitrepo` is a real repository created for the run with `git init`, one
committed skill at `backend/caching-headers/SKILL.md`. Three further properties
of that git import, checked directly against the run:

```
byte-identical to the committed file: true
contains CRLF: false
leftover skill-router-corpus-* temp dirs: 0
```

The `sourcePath` column in the printed table still names the temporary clone.
That is correct: it is where the bytes were copied from, and the copy happened
while the clone existed.

## Review findings and resolutions

| # | Finding | Resolution |
|---|---|---|
| 1 | Git-sourced import rejected 100% of skills with ENOENT and wrote nothing; the clone was removed before the copy. | Fixed. `openSources()` holds the clone open across the copy; `importSkills()` releases it in a `finally` wrapping the loop. `corpus import tmp/gitrepo --git --target tmp/corpus-git-smoke` now reports `Imported: 1 / Rejected: 0`, exit 0. Covered by the new `tests/corpus/git-import.test.mjs` (40 assertions), which the first delivery had nothing equivalent to. |
| 2 | The report presented git as a working input to all four commands; the git-import failure was absent from "Not done". | Corrected. The git path is now demonstrated end to end in section 4 above, and the clone-lifetime contract is stated per entry point. The remote-URL gap is still listed under "Not done" and is still true. |
| 3 | `corpus fetch --to` was described as "usable as the input to a later `corpus import`". It was not, and no code read a manifest. | Fixed. The manifest is self-contained (file contents, not paths) and `corpus import --from-manifest` consumes it. Pinned by a round trip that deletes the source directory before importing. |
| 4 | Deduplication was documented as collapsing "a clone of a repository that contains it" to one record; it did not, and the same repository listed twice imported twice silently. | Fixed. Two keys -- identity (normalized repo + path within the clone, or real path for local) and content (name + SHA-256). `tests/corpus/fetcher-sources.test.mjs` no longer pins the non-dedup, and `git-import.test.mjs` pins both the doubled-repository and the local-plus-containing-clone cases. |
| 5 | `corpus stats` documented an exit-1-on-invalid contract it did not implement; a tree with three invalid skills exited 0. | Fixed. `cmdStats` exits 1 on a non-zero invalid count, in both the text and `--json` forms, matching `validate`. Two test assertions changed from 0 to 1, and a clean-tree-exits-0 assertion was added. |

Two further defects were found while fixing the above, not from the review:
`corpus fetch --to` on a git source wrote a **0-skill** manifest while printing
"Found: 1" (the same lifetime bug reached through the manifest path --
`cmdFetch` now uses `openSources()` and exits 1 if a manifest is short of the
fetch), and `git clone` on Windows applied `core.autocrlf`, so a git-sourced
import wrote CRLF bytes that differ from the repository and from what a second
machine would write.

## Not done

- **The 200-skill corpus itself.** That is 7.3. This sub-phase only built the
  tooling; no real corpus was fetched and `data/skills/` is unchanged (still 54
  skills, and the BM25 baseline still measures the same index).
- **`fetchFromGit` was never run against a remote URL.** The clone path is
  exercised only against a locally-created repository, because the environment
  has no network guarantee. A remote that requires authentication, or a
  `--depth 1` clone of a subdirectory, is untested.
- **A manifest cannot carry a non-UTF-8 file.** It is omitted and named in the
  manifest's `warnings` rather than corrupted. A skill corpus that ships binary
  assets needs a base64 content encoding, which is not implemented.
- **A manifest import places a skill by its `name`**, the same rule every other
  import uses, not at its `relPath`; `relPath` is provenance, not a destination.
- **No `git:` prefix support in `fetchFromSources()`.** The `git:` prefix is a
  CLI convenience handled in `toSource()` in `src/cli/corpus-args.mjs`; the
  library API takes explicit descriptors. A bare string is always local.
- **Symlinked skill files are skipped** by the fetcher walk, the importer's copy
  and the manifest, and the fetcher does not currently warn about them. A corpus
  that ships symlinks will under-report.
- **No new decision-dictionary entry.** Nothing here required a trade-off
  decision; the four rules were read off the shipped corpus rather than chosen
  against an alternative. The clone-lifetime split was forced by a defect, not
  chosen.
- **`logs/corpus-import-2026-09-26.json` was left in the tree** (gitignored) as
  the record of the import smoke tests, and every `tmp/` output was deleted
  after the runs.
