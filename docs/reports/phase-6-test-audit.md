# Phase 6 — Test Coverage Audit (Sub-Phase 6.6, audit pass)

- **Date:** 2026-09-25. **Scope:** 86 `.mjs` modules under `src/` (82), `hooks/` (2),
  `bin/` (1); 61 test files under `tests/`.
- **HEAD at measurement time:** `a013aee`. No `src/`, `hooks/`, `bin/` or
  `tests/**/*.mjs` file changed during the run window (verified, see §7).
- **Method:** read-only; no source file was edited. Two independent evidence sources:
  (1) a **static import map** — every `'./*.mjs'` specifier in all 61 test files
  resolved against the 86 module paths; (2) a **runtime load graph** — a temporary
  `--experimental-loader` hook written to `%TEMP%` (not the repo) appended every
  resolved module URL to a log while the `package.json` `test` chain ran. The load
  graph is how subprocess-exercised CLI modules (`src/cli/*.mjs`, `src/deploy/*`)
  were detected: they are spawned, never imported. **Prior pass:** commits `5224c2c`
  and `a013aee` already carry a `test: add test coverage audit for Phases 0-5`
  report and a `coverage` script; this pass re-measured from scratch and §8 records
  where it disagrees.

## 1. Verification runs executed for this report

| Command | Result |
|---|---|
| every test file x3 via a `%TEMP%` driver script (§7) | 183 runs, 4884 assertions, 0 failed, 0 non-deterministic |
| `node tests/run-coverage.mjs --single tests/cache/lru.test.mjs` | 1 module tracked; 100% line / branch / func |
| `node tests/run-coverage.mjs --single tests/telemetry/outcomes.test.mjs` | 2 modules; `outcomes.mjs` 96.4% line, `feedback.mjs` 53.2% line |
| `node tests/routing.test.mjs` (standalone, no instrumentation) | `Passed: 43  Failed: 0`, exit 0 |
| `node tests/routing.test.mjs` (same file, ESM loader active) | **42 passed, 1 failed**: `max routing overhead < 80 ms (84.32 ms)` |
| `find src hooks bin -name "*.mjs"` / `node bin/skill-router.mjs help` | 86 modules; 18 subcommands, 20 `src/cli/` modules |

`npm test` and `npm run coverage` were **not** invoked: `AGENTS.md` records that npm is not on the subprocess PATH on this host. Every check above is a `node <file>` run.

## 2. Coverage matrix (module x test)

`xN` = imported by N test files. `(subprocess)` = only ever loaded by a spawned hook/CLI, never imported. **NONE** = no test reaches it.

| group | covered by test | unreachable |
|---|---|---|
| bin | skill-router.mjs (subprocess) | - |
| hooks | build-index.mjs (subprocess), route.mjs (subprocess) | - |
| src | index.mjs x1, loader.mjs (subprocess), retriever.mjs (subprocess), scorer.mjs x1 | logger.mjs |
| src/analytics | analyzer.mjs x1, reader.mjs x2 | reporter.mjs |
| src/cli | feedback.mjs x1, tune-guard.mjs x1; add, deploy, doctor, health, help, import, list, reindex, stats, sync, tune, tune-core, validate, verify (all subprocess) | analytics, benchmark, remove, sources |
| src/config | defaults.mjs x1; aliases.mjs, env.mjs (subprocess) | - |
| src/core/budget | manager.mjs x1, truncator.mjs x1 | - |
| src/core/cache | lru.mjs x1, query-cache.mjs x1 | - |
| src/core/embeddings | engine.mjs x2 | - |
| src/core/reranker | engine.mjs x1, features.mjs x1 | - |
| src/core/retrieval | expander.mjs x1, synonyms.mjs x1 | - |
| src/core/retriever | attribution.mjs x1, bm25.mjs x9, hybrid.mjs x3, weights.mjs x1 | - |
| src/core/routing | detector.mjs x2, domain-registry.mjs x1, explicit.mjs x1, hierarchical.mjs x1, hybrid.mjs x2, planner.mjs x1 | - |
| src/core/slm | index.mjs x1, parser.mjs x1, prompt-builder.mjs x1; client.mjs, errors.mjs (subprocess) | - |
| src/core/telemetry | logger.mjs, metrics.mjs, reporter.mjs (all subprocess) | - |
| src/deploy | hook-registrar.mjs x1, planner.mjs x2, writer.mjs x1; verifier.mjs (subprocess) | - |
| src/import | importer.mjs x2, reporter.mjs x1, scanner.mjs x2 | - |
| src/index | dedupe.mjs x1; sources.mjs (subprocess) | - |
| src/quality | reporter.mjs x1, validator.mjs x1 | - |
| src/routing | selector.mjs x1 | - |
| src/sync | disabler.mjs x2, planner.mjs x3, state.mjs x1, writer.mjs x2 | - |
| src/telemetry | feedback.mjs x2, outcomes.mjs x1, session-tracker.mjs x1, signals.mjs x1 | - |
| src/tuning | optimizer.mjs x1, report.mjs x1 | - |
| src/utils | text.mjs x1; fs.mjs, time.mjs (subprocess) | - |

**80 / 86 modules reachable by at least one test (93.0%). 6 unreachable.**

### 2a. Modules with no test at all

- `src/logger.mjs` — zero importers repo-wide (grepping `src/logger.mjs` and
  `../logger.mjs` across `src hooks bin tests scripts` returns nothing). Already
  recorded as dead code (P6-H-019).
- `src/cli/analytics.mjs` — `grep -rn "'analytics'" tests` outside `tests/cli/`
  returns 0 hits and the module is absent from the load graph.
- `src/cli/benchmark.mjs` — same; the `'benchmark'` at `tests/cli/list.test.mjs:66`
  asserts `help` **output**, not an invocation.
- `src/cli/remove.mjs` — same; `tests/cli/list.test.mjs:63` is likewise a
  `help`-output assertion.
- `src/cli/sources.mjs` — same; `tests/cli/reindex.test.mjs:110,124` pass
  `--sources` to **reindex**, not to `sources`.
- `src/analytics/reporter.mjs` — not imported by any test, never loaded. Pure
  markdown-report writer.

### 2b. Exported symbols no test imports

214 exported names across the 86 modules; **90 (42.1%)** are imported by a test.
Neither imported nor reached indirectly:
`src/core/telemetry/logger.mjs` (`logRecord`, `logRetrieve`, `logBuild`, `logError`);
`src/core/telemetry/metrics.mjs` (`increment`, `recordTiming`, `getSnapshot`,
`resetMetrics`); `src/core/telemetry/reporter.mjs` (`reportMetrics`, `reportBenchmark`);
`src/core/retriever/bm25.mjs` (`readSkillContent`);
`src/scorer.mjs` (`tokenize`, `computeIdf`, `bm25` — only `resolveFieldWeight` is
tested); `src/loader.mjs` (`parseFrontmatter`, `loadSkills`);
`src/utils/time.mjs` (`now`, `measure`, `percentile`);
`src/deploy/writer.mjs` (`verifySnapshotIntegrity`, `listSnapshots`,
`pruneSnapshots`, `restoreFromSnapshot`); `src/cli/tune-core.mjs` (all 8 exports);
`src/index.mjs` (39 of its 40 re-exports).

### 2c. Test files that no npm script runs

`package.json` `scripts.test` currently holds 52 `node ...` steps. These test files
exist, pass when run by hand, and are executed by **no** script:
`tests/deploy/planner.test.mjs`, `tests/deploy/writer.test.mjs`,
`tests/hooks/hybrid-output.test.mjs`, `tests/routing-hierarchical.test.mjs`,
`tests/routing/explicit.test.mjs`, `tests/routing/hybrid.test.mjs`,
`tests/scale/scale-benchmark.test.mjs`, `tests/slm/client.test.mjs`,
`tests/slm/prompt-builder.test.mjs`, `tests/deploy/e2e.mjs`,
`tests/deploy/idempotency.mjs`, `tests/deploy/rollback.mjs`,
`tests/integration/phase-2.mjs`. All 13 were run manually for this audit (§7) and
all pass, so a broken `tests/routing/explicit.test.mjs` would not turn the suite red.

## 3. Assertion density

"assertions" is the count each file reports itself (`Passed: N` for the custom
harnesses, `pass N` for the `node:test` files, `Passed assertions: N` for
`tests/e2e/hook-process.mjs`); "src fns" is the number of distinct `src/` exports
the file imports. **1846 assertions across 60 files** (`tests/run-benchmark.mjs` is
excluded — it reports no assertion count).

**Flagged (< 5 assertions per public function) — 5 files:**

| test file | src fns | assertions | per fn |
|---|---|---|---|
| tests/slm/prompt-builder.test.mjs | 4 | 7 | 1.8 |
| tests/slm/client.test.mjs | 3 | 7 | 2.3 |
| tests/routing/hybrid.test.mjs | 2 | 7 | 3.5 |
| tests/routing-hierarchical.test.mjs | 8 | 37 | 4.6 |
| tests/retriever/field-weight-safety.test.mjs | 4 | 19 | 4.8 |

**Not flagged (>= 5 per function), descending:** analytics/analyzer 43.0 ·
cache/lru 42.0 · retriever/weights 39.0 · sync/planner 38.0 · cache/query-cache
27.5 · import/scanner 26.0 · deploy/planner 23.0 · scale/scale-benchmark 21.0 ·
telemetry/outcomes 19.0 · embeddings 18.8 · analytics/reader 17.0 ·
routing/selector 16.0 · retriever/attribution 15.5 · deploy/writer 14.0 ·
import/importer 12.3 · telemetry/session-tracker 11.0 · tuning/optimizer 11.0 ·
routing 10.8 · budget/manager 10.7 · quality/validator 10.7 · sync/state 10.3 ·
budget/truncator 10.0 · config/env 10.0 · telemetry/feedback 10.0 · utils/fs 9.7 ·
retrieval/synonyms 9.5 · sync/writer 8.5 · sync/disabler 7.0 ·
security/path-traversal 6.7 · cli/tune-guard 6.3 · telemetry/signals 6.3 ·
hybrid 5.3 · reranker 5.3.

**Process-level suites** import zero `src/` symbols — they drive
`bin/skill-router.mjs` as a subprocess and assert on stdout and exit codes only, so
they have no per-function density: e2e/hook-process 144 · e2e/full-pipeline 80 ·
e2e/orphan-cleanup 50 · install 43 · cli/tune 40 · e2e/full-loop 33 · cli/list 28 ·
e2e/idempotency 27 · cli/doctor 26 · deploy/hook-registrar 25 · cli/validate 20 ·
cli/tune-guard 19 · cli/health 17 · hook-edge-cases 17 · cli/verify-deep 17 ·
cli/reindex 12 · security/cli-path-traversal 10 · cli/verify 6 · cli/esm-require 5.
The `node:test` files report test counts rather than assertion counts: slm/parser 22, routing/explicit 18, index/dedupe 9, slm/client 7, routing/hybrid 7, slm/prompt-builder 7, hooks/hybrid-output 4.

## 4. Edge-case gaps (happy / empty / invalid / boundary)

| public API | happy | empty | invalid | boundary | evidence of the gap |
|---|---|---|---|---|---|
| `rankSkills` (`src/core/retriever/bm25.mjs:62`) | Y | **N** | **N** | **N** | `tests/routing.test.mjs` is corpus-driven happy path only; no `rankSkills('')`, no null prompt, no empty-index case anywhere in the suite |
| `detectDomains` / `planRoutes` | Y | **N** | **N** | **N** | `tests/routing.test.mjs:44-64` — no empty or invalid input |
| `readSkillContent` (`bm25.mjs:110`) | **N** | N | N | N | not imported by any test (§2b) |
| `applySync` (`src/sync/writer.mjs`) | Y | **N** | **N** | Y | `tests/sync/writer.test.mjs:1-12` lists 10 scenarios, none with an empty `SyncPlan` or an unresolvable path |
| `applyDeploy` (`src/deploy/writer.mjs`) | Y | **N** | **N** | **N** | `tests/deploy/writer.test.mjs:1-9` — 6 scenarios, no empty plan |
| `registerHook` / `unregisterHook` | Y | **N** | **N** | **N** | `tests/deploy/hook-registrar.test.mjs:1-8` — 5 scenarios; no malformed existing `config.json`, no missing `hooks.events` key |
| `correlate` / `correlateFromLogs` | Y | Y | **N** | Y | `tests/telemetry/outcomes.test.mjs` covers 5 time windows + fixtures + the `logDir` regression; no null / non-array `decisions` argument |
| `trackPrompt` | Y | Y | Y | **N** | `tests/telemetry/session-tracker.test.mjs` — no case at exactly the 5-minute boundary |
| `recordSignal` | Y | Y | Y | **N** | `tests/telemetry/signals.test.mjs` — no unknown-signal-type or oversized-payload boundary |
| `computeWeights` | Y | Y | **N** | Y | `tests/retriever/weights.test.mjs:1-11` — `[0.5, 5.0]` clamping covered; no NaN / missing-field attribution |
| `resolveCollisions` | Y | Y | **N** | **N** | `tests/index/dedupe.test.mjs` — 9 tests, no empty index, no same-source collision |
| `optimizeThresholds` | Y | **N** | Y | Y | `tests/tuning/optimizer.test.mjs:1-11` — no empty `prompts` or empty `expected` |
| `selectRouter` | Y | Y | Y | Y | `tests/routing/selector.test.mjs:57-63` — `corpusSize` 0/1/10000, `mode:'unknown'` |
| `fitWithinBudget`, `truncateAtParagraph`, `LRUCache`, `QueryCache`, `validateSkill`, `scanSource`, `importSkills`, `hooks/route.mjs` | Y | Y | Y | Y | `tests/budget/manager.test.mjs:36-40` (empty + null), `:120-122` (tight-budget overflow); 42 `maxSize` and TTL boundaries in `tests/cache/query-cache.test.mjs`; 32 assertions over the 6 field rules in `tests/quality/validator.test.mjs`; `tests/e2e/hook-process.mjs` (20 payloads) + `tests/hook-edge-cases.mjs` (17) |

## 5. Missing regression tests for Phase 4-5 bugs

| # | Bug | Fixed in | Regression test | Status |
|---|---|---|---|---|
| 1-5 | ZCode 3.14.1 does not load plugin `hooks/hooks.json`; `verify --deep` had no `hook_registered` check; no structured routing-decision log; no `health` command; hook must fail open on bad stdin | Phase 3.5 / 4 | `tests/deploy/hook-registrar.test.mjs` (25), `tests/cli/verify-deep.test.mjs` (17), `tests/telemetry/feedback.test.mjs` (40), `tests/cli/health.test.mjs` (17), `tests/hook-edge-cases.mjs` (17) + `tests/e2e/hook-process.mjs` (144) | present |
| 6 | **`router-*` entries polluted implicit retrieval** | Phase 4.1 | `tests/routing.test.mjs:26-29`, `tests/hybrid.test.mjs`, `tests/reranker.test.mjs` filter to `leafIndex` **inside the test** | **GAP** — nothing asserts the *hook* does it. `hooks/route.mjs:139` filters, but `tests/e2e/hook-process.mjs:87-88` only asserts the index *contains* >= 6 routers. No assertion anywhere that an implicit `output.json` never lists a `router-*` skill |
| 7 | `feedback --outcomes` called `correlateFromLogs()` with no `logDir` | Sub-Phase 6.1 | `tests/telemetry/outcomes.test.mjs` section 7 (`:201-255`) and section 8 fixed-clock replay (`:262-287`) | present |
| 8 | `tests/tuning/optimizer.test.mjs` `top1 0.8615 >= 0.89` corpus drift | Sub-Phase 6.1 | the test itself (44 assertions) now pins the leaf-only corpus and asserts the router gap | present |
| 9 | Two index builders disagreed on the default corpus (`reindex` 54 vs `build-index` 60) | Sub-Phase 6.4-repair | `tests/cli/reindex.test.mjs` (12 assertions; 7 fail without the fix) | present |
| 10 | `readSignalFiles()` swallows every error and marks the whole corpus positive | open (P6-H-016) | none | **missing** |
| 11 | `tune --analyze` ignores live signals; attributions come from the benchmark dataset | open (`docs/reports/phase-5-final-report.md:378-380`) | none | **missing** |
| 12 | Attribution counters disagree: `tune --status` 130 vs `tune --analyze` 127 | open (`phase-5-final-report.md:381-383`) | none | **missing** |
| 13 | Post-benchmark auto-rollback never exercised (no proposal ever passed the guard) | open (`phase-5-final-report.md:357-365`) | `tests/cli/tune-guard.test.mjs` (19) covers the *static* guard only | **partial** |
| 14 | No log rotation / disk monitoring for `routing-*`, `signals-*`, `session-*` | never implemented (`phase-5-final-report.md:394-396`) | none | **missing** (feature absent) |
| 15 | Adaptation loop never exercised against real user data | n/a | no test can supply this | **not testable** |

Items 10-12 are open defects, so "missing regression test" is the right label; 13-14 need the feature before a regression test can exist.

## 6. Integration coverage — the two confirmations the ask names

### 6a. Hook stdin-to-stdout end-to-end test — **PARTIAL**

`tests/e2e/hook-process.mjs` exists and is in the `test:e2e` chain. It spawns the
real hook and writes the payload to the child's stdin (`:63-65`), but the hook writes
**nothing to stdout**: `grep -n "console.log\|process.stdout" hooks/route.mjs` returns
0 hits, and the contract at `docs/ai-context.md:539` says the hook must write
`.zcode/output.json`. The test therefore reads stdout into `stdoutBuf` (`:62`) and
returns it (`:75`) but **never asserts on it**; every assertion reads
`.zcode/output.json` (`:66-71`). `tests/hook-edge-cases.mjs:28` goes further and
passes `stdio: ['pipe', 'ignore', 'pipe']`, discarding stdout entirely. What exists
is therefore **stdin -> `.zcode/output.json`**, which is the correct contract; a
literal "stdin-to-stdout" test does not exist and, under the current hook contract,
could not.

### 6b. Full decision -> signal -> outcome loop — **DOES NOT EXIST as one test**

`tests/e2e/full-loop.mjs` (33 assertions, in `test:e2e`) is the closest. It runs the
hook, asserts `logs/YYYY-MM-DD.jsonl` (the *runtime event* log) grew, then runs
`skill-router feedback --json` and asserts `summary.totalCount > 0` (`:200-203`). It
never mentions `routing-`, `signals-`, `session-` or `--outcomes` (grep over the file:
0 hits), and `totalCount > 0` is satisfied by decisions already on disk — it does not
prove the hook wrote one. The three legs are covered separately but never chained:

- **Hook wiring exists**: `hooks/route.mjs:227` `logDecision`, `:240` `trackPrompt`,
  `:242` `recordSignal`. No test spawns the hook and then asserts on
  `logs/routing-*.jsonl` or `logs/signals-*.jsonl` — the only matches for those
  filenames across `tests/` are the in-process writer tests
  (`tests/telemetry/feedback.test.mjs` 40, `tests/telemetry/signals.test.mjs` 19).
- **Correlator**: `tests/telemetry/outcomes.test.mjs` sections 6/7/8 — fixtures, the
  `logDir` regression, and a fixed-clock replay of the *on-disk* logs.

**Gap**: no single test (a) runs the hook with prompt A, (b) runs it again with a
near-identical prompt so `trackPrompt` emits a `retry` signal, and (c) asserts
`feedback --outcomes` classifies decision A as `negative`.

## 7. Determinism

**Result: fully deterministic. 0 non-deterministic tests, 0 failures.**

Method (mission item 6.6.6, at the scale the ask named): a driver script written to
`%TEMP%` (not the repo) enumerated the 52-step `package.json` `test` chain **plus the
13 test files no script runs** = 61 targets, and ran each **3 times** as its own
process, recording exit code and the pass/fail counts each file reports itself.

| Metric | Value |
|---|---|
| Distinct test targets | 61 |
| Repetitions each | 3 |
| Total runs | 183 |
| Total assertions reported | 4884 (sum over all runs) |
| Failures | 0 |
| Targets whose (exit, pass, fail) triple differed across the 3 runs | **0** |
| Runs with a non-zero exit | 0 |

Per-file results are stable, e.g. `tests/tuning/optimizer.test.mjs` 44/0/0 three
times, `tests/retriever/attribution.test.mjs` 31/0/0, `tests/retriever/weights.test.mjs`
39/0/0, `tests/routing/selector.test.mjs` 16/0/0, `tests/telemetry/feedback.test.mjs`
40/0/0, `tests/e2e/hook-process.mjs` 144/0/0.

**Concurrent-modification caveat, and how it was handled.** A first determinism
attempt showed five files with varying pass counts plus a `tests/routing.test.mjs`
failure. Both artifacts trace to a concurrent agent editing the same sub-phase, not
to the code: (a) `git log` advanced from `5224c2c` to `a013aee` mid-run, and that
commit rewrites `tests/retriever/attribution.test.mjs`, `weights.test.mjs`,
`tests/routing/selector.test.mjs`, `tests/telemetry/feedback.test.mjs`,
`tests/slm/parser.test.mjs` and adds three test files; (b) the `routing.test.mjs`
failure was caused by **my own** instrumentation — with the `--experimental-loader`
hook active its wall-clock assertion `max routing overhead < 80 ms` measured
84.32 ms, while the same file standalone with no loader reports
`Passed: 43  Failed: 0`, exit 0. The reported run was therefore executed on a
settled tree and verified afterwards: `find src hooks bin tests -name "*.mjs"
-newermt "2026-09-25 20:38"` returns nothing, i.e. **no source or test file changed
during the run window**. The only files that did change are test-generated artifacts
(`logs/*`, `data/*`, `tests/scale/synthetic-*.json`, `tests/deploy/tmp-debug*`).

## 8. Defects found in the coverage tooling and the suite

1. **Brittle latency assertion — already fixed in the working tree, uncommitted.**
   At `a013aee`, `tests/routing.test.mjs` asserted `max routing overhead < 80 ms` on
   wall-clock time; it was the only assertion in the suite that failed when the
   machine ran ~5% slower. While this report was being written (21:08) the working
   copy was changed to add a warm-up iteration, sort the samples and assert the
   **median** against a 200 ms ceiling — the remedy §8 recommended. Measured
   behaviour in §1 and §7 reflects the 80 ms version.
2. **`npm run coverage` keys modules by basename, not path.**
   `tests/run-coverage.mjs:56-58` captures the module name from Node's coverage table
   and `:141` keys the aggregation map on it; run against
   `tests/telemetry/outcomes.test.mjs` it reports `feedback.mjs` and `outcomes.mjs`
   with no directory. The repo has three `planner.mjs`, three `writer.mjs` and four
   `reporter.mjs` modules and `:135-137` takes the **max** across them, so a
   well-covered module masks an uncovered one. Any project-wide coverage percentage
   from this script is untrustworthy.
3. **The full-suite coverage report is near-empty, and its pass counter is wrong.**
   `logs/coverage-2026-09-25.json` (written 20:32 by the prior pass) records
   `totalModulesTracked: 1` for a whole-suite run because the per-file table regex
   matched one row; single-file runs are accurate (`lru.mjs` 100%/100%/100%;
   `outcomes.mjs` 96.4% line, 88.9% branch, 100% func; `feedback.mjs` 53.2% line).
   `run-coverage.mjs:107` matches `/pass\s+(\d+)/`, which reports "1 tests" for every
   custom-harness file because those suites do not use `node:test`.
4. **13 test files run by no script** (§2c); a broken `tests/routing/explicit.test.mjs`
   would not turn the suite red. **6 modules unreachable** (§2a).

## 9. What this pass did not do

- No source file was edited — this is the audit half of Sub-Phase 6.6 — and no new
  test was written; the gaps in §4, §5 and §6b are the input for the fix half.
- `npm test` and `npm run coverage` were not invoked (npm is not on the subprocess
  PATH here, per `AGENTS.md`); every check is a `node <file>` run named in §1.
- The edge-case classification in §4 was read from each test file's scenario list and
  assertion bodies, not from an instrumented branch-coverage run, because §8.2 shows
  the available coverage script cannot produce one.
- §2 and §3 were measured on the 48-step chain present when the load-graph pass ran
  and on the 52-step chain for the determinism pass. The 4 extra steps
  (`tests/config/env.test.mjs`, `tests/sync/state.test.mjs`, `tests/utils/fs.test.mjs`,
  `tests/slm/parser.test.mjs`) only add coverage; they cannot remove any row.
