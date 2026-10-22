# Phase 7.2 -- command transcripts

Companion to `docs/reports/phase-7.2-corpus-tooling.md`, split out
to keep each file under the 400-line cap. Every block below is verbatim
terminal output from that report's verification run, on this machine,
with `node <file>`. Exit codes are the real ones.

The surrounding file explains what each number means and why the contract is
what it is. This file is only the evidence.

## 1. `corpus stats data/skills`

```
$ node bin/skill-router.mjs corpus stats data/skills
----------------------------------------------------------------------
Directory:                <repo-root>\data\skills
Total skills:             54
Valid skills:             54
Invalid skills:           0
Avg description length:   132 chars
Avg content tokens:       781
----------------------------------------------------------------------
Domains:
  backend: 21
  frontend: 20
  testing: 8
  api: 7
  design: 6
  security: 4
  meta: 4
  database: 2
  debugging: 1
  diagnostics: 1
----------------------------------------------------------------------
Issues: none

EXIT=0
```

All 54 shipped skills pass all four rules, so relaxing the corpus gate relative
to the six-rule quality validator rejects nothing the project already has. That
is the calibration the rules were written against.

## 2. `corpus validate tests/corpus/fixtures`

```
$ node bin/skill-router.mjs corpus validate tests/corpus/fixtures
----------------------------------------------------------------------
Directory: <repo-root>\tests\corpus\fixtures
Total:     8
Valid:     5
Invalid:   3
----------------------------------------------------------------------
  PASS  backend/cache-priming/SKILL.md  (backend-cache-priming)
  PASS  backend/queue-backoff/SKILL.md  (backend-queue-backoff)
  FAIL  broken/bad-name-shape/SKILL.md  (Observability)
          [name] Name "Observability" does not match the {domain}-{specific} shape (lowercase segments joined by hyphens, e.g. backend-eloquent)
  FAIL  broken/no-frontmatter/SKILL.md  (no name)
          [frontmatter] No YAML frontmatter block — the file must start with --- and close with ---
          [name] Missing or empty name field
          [description] Missing or empty description field
  FAIL  broken/overlong-description/SKILL.md  (backend-overlong-description)
          [description] Description too long (597 chars, maximum 400)
  PASS  frontend/streaming-ssr/SKILL.md  (frontend-streaming-ssr)
  PASS  router-python/SKILL.md  (router-python)
  PASS  testing/contract-first/SKILL.md  (testing-contract-first)

EXIT=1
```

Exit 1 because three skills are invalid, matching `validate`'s convention.

## 3. `corpus import tests/corpus/fixtures --target tmp/corpus-tooling-smoke`

```
$ node bin/skill-router.mjs corpus import tests/corpus/fixtures --target tmp/corpus-tooling-smoke
----------------------------------------------------------------------
Target:  <repo-root>\tmp\corpus-tooling-smoke
Force:   false
Total:   8
Imported:        5
Overwritten:     0
Skipped (exists):0
Rejected:        3
----------------------------------------------------------------------
  REJECTED   (no name)  <-  .../tests/corpus/fixtures/broken/no-frontmatter/SKILL.md
             [frontmatter] No YAML frontmatter block — the file must start with --- and close with ---
             [name] Missing or empty name field
             [description] Missing or empty description field
  IMPORTED   backend-cache-priming  <-  .../tests/corpus/fixtures/backend/cache-priming/SKILL.md
  REJECTED   backend-overlong-description  <-  .../tests/corpus/fixtures/broken/overlong-description/SKILL.md
             [description] Description too long (597 chars, maximum 400)
  IMPORTED   backend-queue-backoff  <-  .../tests/corpus/fixtures/backend/queue-backoff/SKILL.md
  IMPORTED   frontend-streaming-ssr  <-  .../tests/corpus/fixtures/frontend/streaming-ssr/SKILL.md
  REJECTED   Observability  <-  .../tests/corpus/fixtures/broken/bad-name-shape/SKILL.md
             [name] Name "Observability" does not match the {domain}-{specific} shape (...)
  IMPORTED   router-python  <-  .../tests/corpus/fixtures/router-python/SKILL.md
  IMPORTED   testing-contract-first  <-  .../tests/corpus/fixtures/testing/contract-first/SKILL.md
----------------------------------------------------------------------
Report: logs/corpus-import-2026-09-26.json
  WARN target directory did not exist and was created: ...\tmp\corpus-tooling-smoke

EXIT=1
```

Exit 1 for the same reason as `validate`. The absolute source paths above were
shortened with `.../` for this report; the terminal printed them in full.

## 4. `corpus import tmp/gitrepo --git --target tmp/corpus-git-smoke`

`tmp/gitrepo` is a real repository created for this pass with `git init`, one
committed skill at `backend/caching-headers/SKILL.md`.

```
$ node bin/skill-router.mjs corpus import tmp/gitrepo --git --target tmp/corpus-git-smoke
----------------------------------------------------------------------
Target:  <repo-root>\tmp\corpus-git-smoke
Force:   false
Total:   1
Imported:        1
Overwritten:     0
Skipped (exists):0
Rejected:        0
----------------------------------------------------------------------
  IMPORTED   backend-caching-headers  <-  <user-home>/AppData/Local/Temp/skill-router-corpus-zXuNxs/repo/backend/caching-headers/SKILL.md
----------------------------------------------------------------------
Report: logs/corpus-import-2026-09-26.json
  WARN target directory did not exist and was created: ...\tmp\corpus-git-smoke

EXIT=0
```

```
$ find tmp/corpus-git-smoke -type f
tmp/corpus-git-smoke/backend/caching-headers/SKILL.md
```

The `sourcePath` column still names the temporary clone, which is correct: that
is where the bytes were copied from, and the copy happened while it existed.
Three further properties of that run, checked directly:

```
byte-identical to the committed file: true
contains CRLF: false
leftover skill-router-corpus-* temp dirs: 0
```

## 5. `corpus fetch` and the manifest round trip

```
$ node bin/skill-router.mjs corpus fetch tmp/gitrepo --git --to tmp/fetch-smoke
----------------------------------------------------------------------
Source:  tmp/gitrepo
Found:   1 SKILL.md file(s)
----------------------------------------------------------------------
  backend-caching-headers  <-  tmp/gitrepo::backend/caching-headers/SKILL.md
Manifest written: <repo-root>\tmp\fetch-smoke\corpus-fetch.json (1 skill(s))

EXIT=0
```

```
kind: skill-router-corpus-fetch version: 1 total: 1
record fields: name,description,keywords,domains,version,relPath,source,sourceRef,contentHash,files
embedded SKILL.md bytes: 245
has a live path field: false

$ node bin/skill-router.mjs corpus import --from-manifest tmp/fetch-smoke/corpus-fetch.json --target tmp/manifest-smoke
----------------------------------------------------------------------
Target:  <repo-root>\tmp\manifest-smoke
Force:   false
Total:   1
Imported:        1
Overwritten:     0
Skipped (exists):0
Rejected:        0
----------------------------------------------------------------------
  IMPORTED   backend-caching-headers  <-  .../tmp/fetch-smoke/corpus-fetch.json#backend/caching-headers/SKILL.md
----------------------------------------------------------------------

EXIT=0

$ find tmp/manifest-smoke -type f
tmp/manifest-smoke/backend/caching-headers/SKILL.md
byte-identical: true
```

### The fetch manifest

`corpus fetch --to <dir>` writes `<dir>/corpus-fetch.json`, and
`corpus import --from-manifest <file>` reads it back. The manifest is
**self-contained**: each record carries the whole skill directory as a
`files` map of relative path to UTF-8 text, not a path.

```json
{ "kind": "skill-router-corpus-fetch", "version": 1,
  "generatedAt": "2026-09-26T...", "total": 1, "warnings": [],
  "source": { "type": "git", "url": "tmp/gitrepo" },
  "skills": [
    { "name": "...", "description": "...", "keywords": [], "domains": [],
      "version": "", "relPath": "backend/caching-headers/SKILL.md",
      "source": "git", "sourceRef": "tmp/gitrepo", "contentHash": "...",
      "files": { "backend/caching-headers/SKILL.md": "---\nname: ..." } }
  ] }
```

The first delivery recorded `path` instead, and the file was dead on arrival: a
git source is cloned into a temp directory that `fetch` removes before
returning, so every recorded path pointed at a deleted tree and no code path
read a manifest at all. The first delivery's own smoke run made this visible --
`corpus fetch tmp/gitrepo --git --to tmp/fetch-smoke` wrote
`"path": "...\Temp\skill-router-corpus-lKrHGy\repo\backend\caching-headers\SKILL.md"`
and passing it to import gave `Local source not found`.

Two things follow from the manifest being self-contained:

- It can be imported on a different machine, or after the source is deleted.
  Pinned in `tests/corpus/cli-corpus-stats.test.mjs` section 7, which fetches a
  throwaway source into a manifest, deletes the source directory, and then
  imports the skill successfully.
- **A non-UTF-8 file is refused, not mangled.** Each file is decoded and
  re-encoded; if the bytes do not survive the round trip the file is binary and
  it is left out of the manifest with a warning naming it. A round trip that
  quietly corrupts a binary asset is worse than one that says it cannot carry
  it. Symlinks and other special entries are not carried, matching the
  importer's copy, which also skips them.

Reading is strict: a file that is not a manifest, or whose `kind` or `version`
is not recognised, throws and the command exits 1. Silently importing half a
corpus from a mis-identified JSON file is not a failure mode worth having.
`corpus fetch` prints `<repo>::<path within the repo>` for a git record rather
than its absolute path, because that path is inside a clone that no longer
exists by the time anything is printed.

### Tests

Fixture corpus at `tests/corpus/fixtures/`, eight `SKILL.md` files:

- valid: `backend/cache-priming`, `backend/queue-backoff`,
  `frontend/streaming-ssr`, `testing/contract-first`, `router-python`
- invalid: `broken/no-frontmatter` (no frontmatter at all),
  `broken/overlong-description` (597-char description, fails only rule 3),
  `broken/bad-name-shape` (`name: Observability`, fails only rule 4)

The fixtures are `.md` files, so `scripts/run-all-tests.mjs` (which sweeps every
`.mjs` under `tests/`) does not pick them up as test files. The five test files
are named so they read clearly in that list, and all five are registered in the
`package.json` `test` chain (78 -> 79 steps) with the CLI one also in `test:cli`.

| Test file | Assertions | Covers |
|---|---|---|
| `tests/corpus/validator-rules.test.mjs` | 81 | all 8 fixtures classified; rule attribution per invalid fixture; the 40/400/39/401 boundaries; 4 good and 8 bad name shapes; an unreadable file is an issue, not a crash |
| `tests/corpus/fetcher-sources.test.mjs` | 44 | local scan, depth limit, missing dir throws, real `git init` + clone, clone failure throws with git stderr, temp dir removed on both paths, dedup across 3 sources, **the same git repository listed twice now yielding one record**, `normalizeSource` |
| `tests/corpus/git-import.test.mjs` | 40 | **the whole git import path**: `importSkills([{type:'git'}])` writing `<target>/<domain>/<slug>/SKILL.md` byte-identically with the temp root empty afterwards; the same through the real CLI; `fetchFromGit` records dead on return while `openSources` records are live until `release()`; a git source shipping `references/`; a doubled git repository importing once; a clone of a repo containing a local skill collapsing to 8 records not 9; two repos with a same-named but different skill keeping both |
| `tests/corpus/importer-force.test.mjs` | 48 | first import 5/3; **second import skips 5 and leaves a local edit byte-identical**; **third import with `force` overwrites 5**; report contents; target creation; containment; `dateStamp` |
| `tests/corpus/cli-corpus-stats.test.mjs` | 107 | all four subcommands through the real bin, `--json` output, exit codes (including `stats` exiting 1 on an invalid tree and 0 on a clean one), value-less `--to` / `--target` / `--from-manifest` as usage errors, the manifest round trip after the source is deleted, a non-manifest file refused, help, `corpusStats()` counts pinned independently of formatting, `data/skills` measured at 54/0 |

The git-import file is the one the review found missing entirely: the first
delivery had no test that imported from a git source, so the suite was green
over a path that rejected 100% of its input.

Two existing assertions were changed rather than deleted, both because the
behaviour they pinned was the defect:

- `tests/corpus/cli-corpus-stats.test.mjs` asserted `corpus stats` on the
  three-invalid-skill fixture tree exits 0. It now asserts 1, and a new
  assertion pins that the shipped all-valid corpus still exits 0.
- `tests/corpus/fetcher-sources.test.mjs` asserted `mixed.length === 9` for a
  local + git pair, which read as "a clone of a repository that contains the
  local source is not deduplicated". That assertion still holds for that pair --
  the two hold different skills -- but the reason has changed, and the test now
  says so, and pins the cross-source case in `git-import.test.mjs` where it
  genuinely applies.

### Checks run in this pass

Each is `node <file>`, exit code as stated.

| Command | Result |
|---|---|
| `node tests/corpus/validator-rules.test.mjs` | 81 passed, 0 failed, exit 0 |
| `node tests/corpus/fetcher-sources.test.mjs` | 44 passed, 0 failed, exit 0 |
| `node tests/corpus/git-import.test.mjs` | 40 passed, 0 failed, exit 0 |
| `node tests/corpus/importer-force.test.mjs` | 48 passed, 0 failed, exit 0 |
| `node tests/corpus/cli-corpus-stats.test.mjs` | 107 passed, 0 failed, exit 0 |
| `node bin/skill-router.mjs corpus stats data/skills` | 54 total / 54 valid / 0 invalid, exit 0 |
| `node bin/skill-router.mjs corpus validate tests/corpus/fixtures` | 8 / 5 / 3, exit 1 (3 invalid) |
| `node bin/skill-router.mjs corpus import tests/corpus/fixtures --target tmp/corpus-tooling-smoke` | imported 5, rejected 3, exit 1 (3 rejected) |
| `node bin/skill-router.mjs corpus import tmp/gitrepo --git --target tmp/corpus-git-smoke` | **imported 1, rejected 0, exit 0**, file at `tmp/corpus-git-smoke/backend/caching-headers/SKILL.md` |
| `node bin/skill-router.mjs corpus fetch tmp/gitrepo --git --to tmp/fetch-smoke` | 1 skill found, manifest with 1 record, exit 0 |
| `node bin/skill-router.mjs corpus import --from-manifest tmp/fetch-smoke/corpus-fetch.json --target tmp/manifest-smoke` | imported 1, exit 0, byte-identical |
| `node scripts/run-all-tests.mjs` | `Total: passed=2480, failed=5`, exit 1 |
| `node tests/run-benchmark.mjs --mode bm25` | Top-1 0.9231 (120/130), Recall@3 0.8923, Set Recall@5 1.0000 (116/116), median 2 ms, p95 3 ms, exit 0 |

### No regressions

`passed=2480, failed=5`. The 5 failures are the pre-existing set that
`docs/current-state.md` records for Sub-Phase 7.1, all of them file-level errors
in the auto-discovering sweep rather than assertion failures:

```
ERR  tests/e2e/tmp-debug-hook.mjs
ERR  tests/e2e/tmp-trace-1790383091780.mjs
ERR  tests/e2e/tmp-trace-1790383091791.mjs   (untracked stale hook copies, ERR_MODULE_NOT_FOUND)
ERR  tests/run-coverage.mjs                  (spawnSync node ETIMEDOUT)
ERR  tests/scale/run-synthetic-benchmark.mjs (needs a <skill-count> argument)
```

Zero failing assertions (checked by listing every `OK` line whose `failed` count
is not 0: none). The pass count moved 2410 -> 2480, and the +70 is exactly this
pass's new and changed assertions: `git-import` +40, `cli-corpus-stats`
80 -> 107 (+27), `fetcher-sources` 41 -> 44 (+3). Nothing else moved. The
frozen BM25 baseline is unchanged at Top-1 0.9231 (120/130).

Running the auto-discovering suite rewrote four tracked Phase 2/3 files
(`docs/reports/phase-2-slm-benchmark.md`, `phase-3-scale-benchmark.md`,
`phase-3-two-mode-benchmark.md`, `tests/integration/phase-2-results.json`) with
latency-only churn from the benchmark runners the sweep invokes -- 22 insertions
and 22 deletions across the four. Those four were reverted to HEAD, following
the convention in the 6.9 and 6.10 entry log rows.

## The four verification commands named by the brief

| # | Command | Result |
|---|---|---|
| 1 | `node bin/skill-router.mjs corpus stats data/skills` | 54 total / 54 valid / 0 invalid, **exit 0** |
| 2 | `node bin/skill-router.mjs corpus validate tests/corpus/fixtures` | 8 / 5 / 3, **exit 1** |
| 3 | `node bin/skill-router.mjs corpus import tests/corpus/fixtures --target tmp/corpus-tooling-smoke` | imported 5, rejected 3, **exit 1** |
| 4 | `node bin/skill-router.mjs corpus import tmp/gitrepo --git --target tmp/corpus-git-smoke` | **imported 1, rejected 0, exit 0** |

`tmp/gitrepo` is a real repository created for the run with `git init`,
one committed skill at `backend/caching-headers/SKILL.md`. All four `tmp/` outputs
were deleted after the runs.
