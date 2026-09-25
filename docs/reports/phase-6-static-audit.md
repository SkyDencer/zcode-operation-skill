# Phase 6 — Static Code Audit Report (Sub-Phase 6.4)

- **Date:** 2026-09-25 (report rewritten; first pass 2026-09-24)
- **Scope:** `src/**` (82 modules), `hooks/**` (2), `bin/**` (1) plus the test
  harness files the DoD depends on.
- **Method:** three independent read-only passes (dead code / unused exports /
  duplicates; conventions, hardcoded values, cross-platform; security and
  silent failures) over the 82 `.mjs` modules in `src/`, plus `hooks/`, `bin/`,
  `tests/`, `scripts/`, followed by a verification pass that re-read every file
  cited here and re-ran every check quoted below. Entry points (`hooks/*`,
  `bin/skill-router.mjs`, and the 13 modules with an `import.meta.url` +
  `process.argv` self-execution guard) are excluded from "dead code".
- **Rule applied:** Critical items fixed immediately with regression tests; High
  items recorded in `docs/problems.md` as `P6-H-0NN` and left unfixed.
- **Prior work:** the first pass of this report and commit `30a7968` (security
  remediation) are treated as prior work. Every claim below was re-verified
  against the source at `30a7968`; two prior claims were corrected (Section 4).

---

## 0. Verification runs executed for this report

| Command (run from the repo root) | Result |
|---|---|
| `node tests/security/path-traversal.test.mjs` | Passed 20, Failed 0 |
| `node tests/security/cli-path-traversal.test.mjs` | Passed 10, Failed 0 |
| `node tests/retriever/field-weight-safety.test.mjs` | Passed 19, Failed 0 |
| `node tests/cli/esm-require.test.mjs` | Passed 5, Failed 0 |
| `grep -rn "catch\s*{" src hooks bin --include="*.mjs"` | 39 modules; each one is listed in 3.7 |
| `grep -rn "\.catch(" src hooks bin` / `grep -rn "{any}" src` | 3 `.catch(` hits, all with a real handler (no `.catch(() => {})`); 4 `{any}` hits, all in the two cache modules |
| `diff <(sed -n '393,414p' src/cli/health.mjs) <(sed -n '402,423p' src/cli/verify.mjs)` | identical (DUP-4 check-table renderer) |
| `awk '/function parseFrontmatter/,/^}/' … \| md5sum` (5 files) and `… loadSkillsSync …` (3 files) | 4 of 5 `parseFrontmatter` bodies identical (`src/loader.mjs` differs only in comments); the 3 `loadSkillsSync` bodies identical except one comment |
| secret regex, `grep -rnE "[A-Za-z]:\\\\\|[A-Za-z]:/" src hooks bin`, `grep -rn "shell: *true" src hooks bin` | no matches; the only `execSync` is a fixed literal (`src/cli/health.mjs:311`) |

`npm` was not used (AGENTS.md environment gotcha). The full test suite was not
run; the run script gates on it.

---

## 1. Summary by category

| # | Category | Findings | Critical | High | Medium | Low |
|---|----------|---------:|---------:|-----:|-------:|----:|
| 1 | Dead code / unreachable modules | 5 | 0 | 2 | 2 | 1 |
| 2 | Unused exports | 9 | 0 | 0 | 1 | 8 |
| 3 | Duplicate logic | 8 | 0 | 1 | 3 | 4 |
| 4 | Inconsistent conventions (errors, config) | 6 | 0 | 2 | 2 | 2 |
| 5 | Hardcoded values | 10 | 0 | 0 | 1 | 9 |
| 6 | Cross-platform issues | 5 | 0 | 2 | 0 | 3 |
| 7 | Silent failures | 11 | 0 | 4 | 2 | 5 |
| 8 | Type safety / JSDoc | 7 | 0 | 0 | 1 | 6 |
| S | Security (separate track) | 5 | 2 | 1 | 0 | 2 |

Critical total: 4 (C1–C4, all fixed in this phase, each with a regression test).
High total: 19 open (`P6-H-001`–`P6-H-019` in `docs/problems.md`).

---

## 2. Critical findings — fixed in this phase

All four were fixed in the 6.4 code steps (commit `30a7968` for C3/C4); the
regression tests below were re-run in this session and pass.

### C1 — Fractional BM25 field weights crash retrieval (`RangeError`)

- **Where:** `src/core/retriever/bm25.mjs:20-49` (`buildWeightedDocTokens`),
  `src/scorer.mjs:31-45` (`resolveFieldWeight`), used by
  `src/core/routing/detector.mjs:43-53`.
- **Description:** field weights were passed straight into `Array(n)` /
  `String.repeat(n)`, so any fractional value from `data/weights.json` (which
  `src/core/retriever/weights.mjs` produces and `src/cli/tune-core.mjs:245`
  writes) threw `RangeError: Invalid array length`. The hook catches the error
  and exits 0 without writing `output.json`, so routing silently stops.
- **Fix:** weights are normalised to a positive integer before use.
- **Regression test:** `node tests/retriever/field-weight-safety.test.mjs` → 19/19.

### C2 — `require()` inside ESM modules broke two CLI commands

- **Where:** `src/cli/add.mjs:5-8`, `src/cli/doctor.mjs:15-19`,
  `tests/run-benchmark.mjs:17`, `tests/integration/phase-2.mjs:14`.
- **Description:** `require('node:fs')` is undefined in ESM; both calls were
  wrapped in `catch { return [] / 'no' }`, so `add` rejected every valid skill
  (empty domain registry) and `doctor` always reported the mirror non-writable.
- **Fix:** static `node:` imports.
- **Regression test:** `node tests/cli/esm-require.test.mjs` → 5/5 (scans every
  `.mjs` in `src/ hooks/ bin/ tests/ scripts/` for `require(`).

### C3 — Arbitrary file write via path traversal in the import/add path (security blocker)

- **Where:** `src/import/importer.mjs:87-98,207`, `src/cli/import.mjs:90-100,208`,
  `src/cli/add.mjs:45,83`, guards in `src/utils/fs.mjs:74-95`.
- **Description:** the destination directory was derived from the untrusted
  SKILL.md frontmatter `name` via `name.split('-')` + `path.join`. A name like
  `backend-../../../../pwned` passes `validateSkill()` (domain `backend` is
  registered, name starts with `backend-`) and writes `SKILL.md` outside
  `data/skills`. The previous `hasTraversal()` guard could never fire: it ran
  on an already-`resolve()`d absolute skills directory (always false) and on
  `candidate.sourcePath`, never on the name. The auditor's sandbox
  reproduction returned `status: "imported"`, `score: 100` with `targetPath`
  outside the skills directory.
- **Fix:** `isSafeName()` rejects separators and `..`; `isWithinRoot()` checks
  the resolved target on path segments; `resolveTargetDir()` returns `null` and
  the candidate is rejected with `field: "path"`; `add` rejects the name before
  validation and re-checks containment before writing.
- **Regression tests:** `node tests/security/path-traversal.test.mjs` → 20/20
  (importer + disabler); `node tests/security/cli-path-traversal.test.mjs` →
  10/10 (CLI `add` + `import`). Both include legitimate-name cases proving the
  guard is not over-broad. Recorded in `docs/problems.md` rows 9–10 (P6-C3, P6-C4).

### C4 — Path traversal in the disable/sync path (security blocker, same class)

- **Where:** `src/sync/disabler.mjs:110,221`, `src/sync/writer.mjs:169,201,239`,
  shared guard `src/utils/fs.mjs:74-79`.
- **Description:** `entry.path` from `.skill-router-disabled.json` (populated
  verbatim from `--disable <name>`, `src/cli/sync.mjs:40`) was joined onto the
  mirror root with no containment check; shadow mode wrote `SKILL.md` and
  `.skill-router-meta.json` outside the root and mirror mode `rmSync`-ed a
  sibling directory. `src/sync/writer.mjs` used a string-prefix check that
  accepted sibling directories such as `<root>/evil2` for `<root>/evil`.
- **Fix:** `disableSkill()` / `enableSkill()` fail closed on out-of-root paths;
  `applySync()` checks both source and mirror targets for add/update/remove
  before any filesystem probe.
- **Regression test:** `node tests/security/path-traversal.test.mjs` sections
  4–6 → 20/20.

---

## 3. Findings by category

Severity key: **C** Critical (fixed), **H** High (`docs/problems.md`),
**M** Medium, **L** Low.

### 3.1 Dead code / unreachable modules

| ID | Where | Description | Sev | Suggested action |
|---|---|---|---|---|
| DEAD-1 | `src/logger.mjs:1-25` | Fully orphaned legacy logger (`logs/routing.jsonl`, old schema). Zero importers; the only other reference is the string `'src/logger.mjs'` in the file-existence list at `src/cli/health.mjs:114`. Also the only module in `src/` with no JSDoc file header. | H | Delete the module and drop the entry from the `src/cli/health.mjs:110-118` list. |
| DEAD-2 | `src/retriever.mjs:1-71` | Legacy duplicate of `src/core/retriever/bm25.mjs:62,110`; kept alive only by `src/analytics/analyzer.mjs:18`, which therefore computes `top10Skills` with hardcoded 3/2/1 field weights while the hook uses the configured weights from `data/weights.json`. | H | Repoint the analyzer at `src/core/retriever/bm25.mjs` and delete this file. |
| DEAD-3 | `src/import/scanner.mjs:133`, `src/import/importer.mjs:165`, `src/import/reporter.mjs:32` | The whole tested import subsystem is test-only; `src/cli/import.mjs:59` re-implements the scan/validate/write pipeline inline. The two copies have already diverged on symlink handling. | M | Make `src/cli/import.mjs` call the tested modules and delete the inline copies. |
| DEAD-4 | `src/core/routing/hierarchical.mjs:45`, `src/routing/selector.mjs:25` | Neither is reachable from `hooks/route.mjs` or any CLI (verified: no importer under `src/`, `hooks/`, `bin/`). `docs/ai-context.md:208-216,257-264` still documents the hook as choosing between them. | M | Wire behind the documented `--experimental` flag or delete; correct the doc either way. |
| DEAD-5 | `src/core/slm/index.mjs:9-12` | Barrel with no production importer (`src/core/routing/hybrid.mjs:22-24` imports the concrete modules); only `tests/slm/client.test.mjs:13` uses it. | L | Delete and point the test at the concrete modules. |

### 3.2 Unused exports

| ID | Where | Description | Sev | Suggested action |
|---|---|---|---|---|
| UNUSED-1 | `src/utils/fs.mjs:16,27,39,58` | `readFileJson`, `writeFileJson`, `walkDir`, `resolvePath` have zero consumers; the file is kept alive only by the re-export at `src/index.mjs:39`. | L | Delete the four functions and the re-export line. |
| UNUSED-2 | `src/telemetry/signals.mjs:26` | `hashText` exported, never called anywhere. | L | De-export. |
| UNUSED-3 | `src/core/telemetry/metrics.mjs:40,59`, `src/core/telemetry/reporter.mjs:13,35` | `getSnapshot`, `resetMetrics`, `reportMetrics`, `reportBenchmark` are re-exported at `src/index.mjs:30-31` but never called; `src/cli/stats.mjs` recomputes inline. | L | Wire `stats`/`doctor` to them or de-export. |
| UNUSED-4 | `src/sync/state.mjs:67`, `src/analytics/analyzer.mjs:39,55,77,322`, `src/cli/tune-core.mjs:148,178` | `writeSyncState`, `loadIndex`, `getDocs`, `resolveTopSkills`, `runBenchmark`, `logTuningDecision` are only called inside their own module; `loadIndexFromPath` (`analyzer.mjs:322`) is a one-line wrapper around `loadIndex`. | L | Remove `export` and delete the wrapper. |
| UNUSED-5 | `src/config/env.mjs:76`, `src/core/slm/client.mjs:183` | `mergeEnvOverrides` is re-exported at `src/index.mjs:35` and only called by its own top-level `const _config = …` (`:114`); `export { SlmClient as default }` has no default-import consumer. | L | De-export both. |
| UNUSED-6 | `src/core/retrieval/synonyms.mjs:22` | `buildSynonymMap` has no production consumer; `hooks/route.mjs:153` never passes a `synonymMap`, although `docs/ai-context.md:308-314` documents the map as usable by `expandQuery()`. | M | Expose through a documented flag or delete module and test. |
| UNUSED-7 | `src/cli/list.mjs:9`, `src/cli/stats.mjs:8` | Both import async `loadSkills` from `src/loader.mjs` but call their private `loadSkillsSync`. | L | Remove the dead imports. |
| UNUSED-8 | `src/core/budget/truncator.mjs:57`, `src/tuning/optimizer.mjs:37`, `src/core/cache/query-cache.mjs:20,209` | `charCount`, `evaluate`, `sha256hex`, `_origGetOrSet` have no referencing import. | L | De-export or delete. |
| UNUSED-9 | `src/index.mjs:8-46` | The public barrel omits `selectRouter`, `detectExplicitSkill`, `routeHybrid`, `routeWithExplicit`, `fitWithinBudget`, `expandQuery`, `buildSynonymMap`, `attributeOutcome`, `computeWeights`; every consumer reaches into internal paths. | L | Extend the barrel or document it as internal-only. |

### 3.3 Duplicate logic

| ID | Where | Description | Sev | Suggested action |
|---|---|---|---|---|
| DUP-1 | `src/loader.mjs:17`, `src/quality/validator.mjs:59`, `src/cli/list.mjs:131`, `src/cli/sources.mjs:150`, `src/cli/stats.mjs:138` | `parseFrontmatter` implemented five times; four bodies are byte-identical (verified by md5), `src/quality/validator.mjs:53` even comments that it "mirrors" the loader. | M | Keep one implementation in `src/loader.mjs`; import it in the other four. |
| DUP-2 | `src/cli/list.mjs:96`, `src/cli/stats.mjs:103`, `src/cli/sources.mjs:116` | Three synchronous `loadSkillsSync` copies (identical except one comment), plus a fourth async implementation in `src/loader.mjs:90`. | M | Export one `loadSkillsSync` from the loader. |
| DUP-3 | `src/cli/import.mjs:190-236` vs `src/import/importer.mjs:191-239` | The CLI import command re-implements validate → collision → mkdir/write → status verbatim. The symlink paths have diverged: `src/cli/import.mjs:33-38` reads a link target's file contents as a path, `src/import/scanner.mjs:105-108` uses `realpath`. | M | Call the tested modules from the CLI. |
| DUP-4 | `src/cli/health.mjs:393-414` vs `src/cli/verify.mjs:402-423` | Check-table renderer (header, separator, PASS/FAIL/WARN colouring, summary) is byte-identical (verified with `diff`). | L | Extract `renderCheckTable(results)`. |
| DUP-5 | `src/cli/add.mjs:107`, `src/import/importer.mjs:106`, `src/quality/validator.mjs:120` | `getRegisteredDomains` copy-pasted three times. | L | Export once from a domain-registry module. |
| DUP-6 | `src/deploy/planner.mjs:47`, `src/deploy/verifier.mjs:57`, `src/sync/planner.mjs:48`, `src/sync/writer.mjs:77` | `hashContent` in four modules. | L | One shared helper. |
| DUP-7 | `src/deploy/{planner,verifier,writer}.mjs`, `src/sync/{writer,disabler}.mjs` | `readMeta` in five modules (the `sync/` copies return `null` on malformed JSON, which `src/sync/writer.mjs` then treats as "user-managed, never touch") and the `META_FILENAME` constant in the same five files. | L | One shared reader with a documented error contract, and one shared constant. |
| DUP-8 | `src/retriever.mjs:14,59` vs `src/core/retriever/bm25.mjs:62,110` | `rankSkills` / `readSkillContent` duplicated; the legacy copy is the one the analytics CLI uses (see DEAD-2). | H | Delete the legacy copy. |

### 3.4 Inconsistent conventions (errors, config)

| ID | Where | Description | Sev | Suggested action |
|---|---|---|---|---|
| CONF-1 | `src/core/retriever/bm25.mjs:14,64`, `src/core/routing/detector.mjs:21,47`, `src/core/retriever/attribution.mjs:12`, `src/core/retriever/hybrid.mjs:16`, `src/core/routing/hybrid.mjs:29` vs `src/core/routing/hierarchical.mjs:19`, `src/core/routing/planner.mjs:16` | Two config sources: `getDefaults()` (no env) in the scoring/routing core, `getConfig()` (env-merged) in two routing modules whose destructured weights are never used. Documented `SKILL_ROUTER_BM25_*` overrides therefore never reach the scorer. | H | Make `getConfig()` authoritative everywhere. |
| CONF-2 | `src/core/routing/hybrid.mjs:29` | This module uses `getDefaults()`, so `SKILL_ROUTER_SLM_ENABLED` and every SLM env override never reach `_slmCfg`; the flag documented in `docs/ai-context.md:248` is inert on this path. | H | Switch to `getConfig()`. |
| CONF-3 | `src/deploy/planner.mjs:89`, `src/deploy/verifier.mjs:85`, `src/deploy/writer.mjs:397`, `src/sync/planner.mjs:161`; CLIs at `src/cli/deploy.mjs:24`, `src/cli/sync.mjs:21`, `src/cli/verify.mjs:90,121,149`, `src/cli/doctor.mjs:86`, `src/cli/sources.mjs:42` | `process.env.SKILL_ROUTER_ZCODE_DIR` is read directly in nine places and is absent from the `env.mjs` schema (`:16-34`), bypassing the validated override path. | M | Add a config accessor and use it in all sites. |
| CONF-4 | `src/core/cache/lru.mjs:23`, `src/core/cache/query-cache.mjs:67`, `src/import/importer.mjs:173`, `src/import/scanner.mjs:141,144` vs `src/core/slm/errors.mjs:7-39` | Plain `Error` everywhere except the SLM subsystem, which defines `SlmError` / `SlmTimeoutError` / `SlmUnavailableError`. Callers cannot distinguish failure classes. | L | Introduce a shared domain-error base. |
| CONF-5 | `src/config/defaults.mjs:136-180` vs `src/config/env.mjs:76-110` | Two overlapping env parsers; `mergeEnvOverrides` calls `mergeWithEnv` and then re-applies the same overrides with range checks. | M | Collapse into one validated path. |
| CONF-6 | `src/cli/health.mjs:433-440` (0/1/2) vs `src/cli/verify.mjs:464` (0/1) and every other CLI (0/1) | Inconsistent exit-code contract. | L | Document or unify. |

### 3.5 Hardcoded values

| ID | Where | Description | Sev | Suggested action |
|---|---|---|---|---|
| HC-1 | `src/core/routing/hybrid.mjs:38-41` and `src/core/slm/client.mjs:21-27` | `http://127.0.0.1:8080`, `qwen2.5` and `2000` are hardcoded in both modules even though `src/config/defaults.mjs:116-122` already defines them. A defaults change would not propagate. | M | Read from config; keep one source of truth. |
| HC-2 | `src/core/routing/hybrid.mjs:77-81` | `20`, `7`, `0.35`, `0.5`, `2000` restated as inline fallbacks already present in `config.slm`. | L | Drop the fallbacks. |
| HC-3 | `src/cli/health.mjs:286-300` | Port `8080` and the `2000` ms socket timeout hardcoded for the SLM probe, including the message text. | L | Derive from `config.slm.endpoint` / `slmTimeoutMs`. |
| HC-4 | `src/core/routing/detector.mjs:67,119`, `src/core/routing/domain-registry.mjs:191` | Scoring weights (`0.5/0.3/0.2`, `0.4/0.6`) and the `0.3` score threshold are not configurable. | L | Move to config. |
| HC-5 | `src/core/retrieval/expander.mjs:12,18,24`, `src/core/reranker/engine.mjs:13` | `EXPAND_WEIGHT 0.5`, `MIN_IDF_THRESHOLD 0.8`, `MAX_EXPANDED_TOKENS 3`, `BLEND 0.01`. | L | Move to config with env overrides. |
| HC-6 | `src/core/retriever/weights.mjs:15-18`, `src/cli/tune-guard.mjs:17-18,59,70` | Adaptation constants `20 / 0.05 / 0.5 / 5.0` and a hardcoded baseline fallback `0.9231`. | L | Read from config / `data/baseline.json`. |
| HC-7 | `src/tuning/optimizer.mjs:18,23,122-123`, `src/tuning/report.mjs:25-26,118-119` | Grid `0.70–0.95 / 0.40–0.75 step 0.05` and the `0.85 / 0.60` defaults re-hardcoded instead of reading `config.confidence`. | L | Read from the config module. |
| HC-8 | `src/cli/import.mjs:14`, `src/import/importer.mjs:60`, `src/import/scanner.mjs:36`, `src/sync/planner.mjs:62`; `src/core/retriever/hybrid.mjs:39`, `src/core/reranker/engine.mjs:33`, `src/core/routing/hierarchical.mjs:46`, `src/core/routing/planner.mjs:45` | `MAX_DEPTH = 10` declared four times and `options.topK ?? 5` in four retrievers; config has no `topK` key. | L | One shared constant each. |
| HC-9 | `src/core/telemetry/metrics.mjs:30`, `src/cli/feedback.mjs:43,62` | Capacity `1000` samples and `300` records hardcoded. | L | Config with env override. |
| HC-10 | `src/cli/health.mjs:311` | `execSync('git status --porcelain', …)` — fixed literal, no interpolation, so safe; recorded so the single `execSync` in the codebase is documented. | L | None (no change needed). |

### 3.6 Cross-platform issues

| ID | Where | Description | Sev | Suggested action |
|---|---|---|---|---|
| XP-1 | `src/deploy/writer.mjs:128,155,347` | Snapshot paths are stored with `path.join` (backslashes on Windows) but matched with `f.path.startsWith(entry.name + '/')` and split with `file.path.split('/')`. On Windows the match never succeeds and the split never separates, so automatic rollback deletes newly created router directories and `--restore` cannot rebuild them. | H | Normalise snapshot paths to POSIX form before writing. |
| XP-2 | `src/core/telemetry/logger.mjs:9`, `src/telemetry/feedback.mjs:10`, `src/telemetry/signals.mjs:15`, `src/telemetry/session-tracker.mjs:19`, `src/analytics/reader.mjs:10`, `src/analytics/analyzer.mjs:19-20`, `src/config/defaults.mjs:25,46`, `src/core/routing/domain-registry.mjs:14`, `hooks/build-index.mjs:27-28`, `src/cli/reindex.mjs:15-16` | `resolve('logs' | 'data/…')` is cwd-relative while `hooks/route.mjs:26-27` resolves the index from `import.meta.url`; running the hook from a foreign cwd writes telemetry into that cwd and hides `data/weights.json` / `data/thresholds.json`. | H | Resolve all data paths from the plugin root. |
| XP-3 | `src/cli/reindex.mjs:66`, `src/cli/sources.mjs:24`, `hooks/build-index.mjs:93`, `src/cli/import.mjs:39-42,111`, `src/import/importer.mjs:70,182` | One-character separator probe (`skill.path[src.path.length] === '\\'`) and hand-rolled backslash→slash normalisation plus `/[\\/]/` splitting instead of `path.relative` / `path.resolve`. | L | Use `node:path` helpers. |
| XP-4 | `src/cli/health.mjs:161` | `argsStr.includes('hooks/route.mjs')` cannot match a Windows-registered path; only the `'route.mjs'` fallback saves the check. | L | Normalise args before matching. |
| XP-5 | `src/sync/planner.mjs:130` | `dirname()` is called on a forward-slash-normalised relative path; correct on win32 but mixes two conventions in one expression. | L | Use one convention. |

### 3.7 Silent failures

| ID | Where | Description | Sev | Suggested action |
|---|---|---|---|---|
| SIL-1 | `src/deploy/writer.mjs:110-143` (`catch {}` at `:139`), rollback at `:146-176` | The whole mirror scan inside `snapshotMirror()` is swallowed. A partial/empty `files` array is written unconditionally, `applyDeploy()` reports success, and rollback then deletes every mirror directory not in that empty snapshot. | H | Distinguish "mirror missing" from "read failed"; abort the deploy on a partial snapshot. |
| SIL-2 | `src/sync/planner.mjs:66-71,138-140`, consumer `src/sync/writer.mjs:239-263` | A `readdir` error in `walkSkillFiles` returns silently, producing an empty project index; every mirror skill is then classified `remove` and `rmSync`-ed. | H | Fail the plan when either tree cannot be indexed. |
| SIL-3 | `src/telemetry/outcomes.mjs:132-155` (`:152-154`) | The readdir/read loop is wrapped in one `catch { // Directory doesn't exist }` that also swallows permission errors and mid-loop read failures. Zero signals makes `correlate()` classify every decision `positive` (`:87-90`) — the exact failure mode Sub-Phase 6.1 addressed. | H | Branch on `err.code === 'ENOENT'`; surface other errors. |
| SIL-4 | `src/config/defaults.mjs:23-35,45-61` | A malformed `data/thresholds.json` or `data/weights.json` is indistinguishable from a missing file, so BM25 weights silently revert to 3/2/1. `data/weights.json` is written by the tune CLI, so a failed write is invisible to retrieval. | M | Log a warning on parse failure. |
| SIL-5 | `src/cli/tune-core.mjs:63,78,181-182,241` | The tuning audit trail (`logs/tuning/decisions.jsonl`) and the post-failure snapshot cleanup swallow every error; a permission error is reported as "No snapshots found". | M | Report the failure on stderr. |
| SIL-6 | `src/core/routing/domain-registry.mjs:48-54,130-133` | Dead code hidden behind an empty catch: `readFileSync(DOMAINS_DIR, …)` reads a directory and always throws; the real work is the `readdirSync` below. The second catch silently discards a malformed `meta.json` and overwrites it with corpus-derived text. | L | Delete the dead `try`; warn on malformed meta. |
| SIL-7 | `src/deploy/writer.mjs:274,305,422,428-429`, `src/sync/writer.mjs:95-99`, `src/import/scanner.mjs:82-87,104-110`, `src/analytics/reader.mjs:55-61` | Corrupt snapshots are never pruned and the secondary snapshot copy is best-effort (a deploy can report success with no rollback point); `readMeta()` returns `null` on malformed JSON, identical to "user-managed, never touch"; readdir/stat errors are skipped, so a permission problem presents as "fewer skills found" or "zero requests". | L | Log and surface; branch on `err.code`; count skipped paths. |
| SIL-8 | `src/core/retriever/bm25.mjs:109-120`, `src/core/embeddings/engine.mjs:139-160`, `src/core/routing/hybrid.mjs:122-141`, `src/core/slm/parser.mjs:39,72,78`, `src/analytics/analyzer.mjs:39-46`, `src/cli/feedback.mjs:105-124` | Silent degradations with no telemetry: unreadable skills dropped from injected context, embedding index silently built from name+description only, SLM failures silently degraded to BM25, malformed SLM JSON indistinguishable from "model chose nothing", broken index yields an all-zero analytics report, and `feedback --outcomes` drops attribution silently. | L | Record a degradation counter per path. |
| SIL-9 | `src/core/telemetry/logger.mjs:31-33`, `src/telemetry/feedback.mjs:66-68`, `src/cli/add.mjs:113`, `src/cli/doctor.mjs:48,63,111,135,155,178`, `src/cli/tune-guard.mjs:37`, `src/core/slm/client.mjs:50,95` | Remaining best-effort catches: telemetry writes intentionally fail open (required by the hook contract) and the CLI/SLM probes already degrade safely, but nothing records that telemetry is being dropped. | L | Optional stderr counter under a debug flag. |
| SIL-10 | `src/cli/benchmark.mjs:22`, `hooks/build-index.mjs:172`, `hooks/route.mjs:309` | Every `.catch(` in the codebase installs a real handler. **No `.catch(() => {})` occurrences exist** (verified by the grep quoted in Section 0). | L | None. |
| SIL-11 | `src/import/scanner.mjs:105-108`, `src/sync/planner.mjs:81-100`, `src/cli/import.mjs:33-38` | Symlink containment checks use `stat()` (which follows symlinks) and then test `isSymbolicLink()`, which is always false. Runtime reproduction was not possible on this host (`symlinkSync` → EPERM), so this is a static finding. Recorded as `P6-H-010`. | H | Use `lstat()` + `realpath()`. |

### 3.8 Type safety / JSDoc

| ID | Where | Description | Sev | Suggested action |
|---|---|---|---|---|
| TS-1 | `src/core/cache/lru.mjs:25,35,51`, `src/core/cache/query-cache.mjs:54,123` | The cache boundary for every route plan is typed `Map<string, any>` / `@param {any} value` / `@returns {any}` (the only `{any}` hits in `src/`). | L | Introduce a `RoutePlan` typedef. |
| TS-2 | `src/cli/{feedback,doctor,health,import,tune,verify}.mjs` and `src/config/env.mjs:115` | Exported `main(argv)` entry points and `getConfig()` have no JSDoc, so their argv contract and the config return shape are undocumented at the definition site. | M | Add `@param {string[]} argv` / `@returns {Promise<number>}` and the config shape. |
| TS-3 | `src/logger.mjs:1-3` | The only module in `src/` without a JSDoc file header, and it duplicates `logDecision` from `src/core/telemetry/logger.mjs` with a different output file — a real source of confusion. | L | Delete the module (DEAD-1). |
| TS-4 | `src/core/retriever/hybrid.mjs:31,37,110` | JSDoc documents `options.rerank=true` as default-on while the code reranks only for an explicit `=== true`, and `doRerank` is dead. | L | Align doc and code. |
| TS-5 | `src/core/retriever/weights.mjs:23`, `src/analytics/reader.mjs:15`, `src/core/telemetry/reporter.mjs:9,31` | JSDoc references `import('./attribution.mjs').Attribution` and `LogEntry` shapes that are never exported or defined. | L | Export the typedefs or inline the shapes. |
| TS-6 | `src/tuning/report.mjs:23-25`, `src/tuning/optimizer.mjs:100,194` | Entry-point detection uses `import.meta.url.split('/').slice(3).join('/')`, which does not survive Windows drive-letter paths; the rest of the codebase uses the `endsWith(argv[1].replace(/\\/g,'/'))` pattern. | L | Use the established pattern. |
| TS-7 | `src/quality/validator.mjs:233` | Non-English comment (`满分 = 6 checks passed`) in an English-only codebase. | L | Translate. |

### 3.9 Security track (separate from the eight categories)

| ID | Where | Description | Sev | Suggested action |
|---|---|---|---|---|
| SEC-1 | `src/import/importer.mjs`, `src/cli/import.mjs`, `src/cli/add.mjs` | Arbitrary file write via frontmatter-name path traversal. | C | **Fixed in this phase** — see C3 and its two regression tests. |
| SEC-2 | `src/sync/disabler.mjs:110,167,221`, reachable from `src/cli/sync.mjs:40` | Arbitrary write/delete outside the mirror root via `--disable` names. | C | **Fixed in this phase** — see C4. |
| SEC-3 | `src/import/scanner.mjs:105-108`, `src/sync/planner.mjs:81-100`, `src/cli/import.mjs:33-38` | Symlink-containment checks are dead code (SIL-11). | H | `P6-H-010`. |
| SEC-4 | `src/cli/remove.mjs:38` | `rmSync(skillDir, { recursive: true, force: true })` has no containment assertion at delete time; it is safe only because `findSkillDir` walks under `SKILLS_DIR`. | L | Add an `isWithinRoot()` check before the delete, as in `src/sync/writer.mjs:82`. |
| SEC-5 | `src/`, `hooks/`, `bin/` | No hardcoded secrets, tokens or absolute personal paths; no command injection (every child process is `spawn(process.execPath, [args…])` with no shell, and the single `execSync` uses a fixed literal); SSRF limited to the operator-configured SLM endpoint (loopback by default), with no response-size limit. | L | Note only. |

---

### 3.10 Carry-over High findings from the first pass (re-verified)

| ID | Where | Description | Sev | Suggested action |
|---|---|---|---|---|
| P6-H-001 | `hooks/route.mjs:153` | The hook calls `rankSkills(query, idx)` with no `topK` and no score floor, so all 54 entries (including zero-score ones) are written to `additionalContext`, violating `docs/ai-context.md:502,521`. `tests/e2e/hook-process.mjs:122-123,157-158` asserts non-empty context for zero-scoring prompts, so a threshold would flip an existing test. | H | Decide the shortlist policy and update the E2E expectations in the same change. |
| P6-H-002 | `src/core/budget/manager.mjs:56-57` | `max(quota, minPerSkill)` lets `minPerSkill × count` exceed `maxChars`; `tests/budget/manager.test.mjs:117-122` asserts the overflow, contradicting the module docstring. | H | Cap the total or drop the floor. |
| P6-H-003 | `hooks/route.mjs:192,202,214,271`, `src/telemetry/session-tracker.mjs:118` | Raw prompts are logged and a 60-char prefix is persisted in session state, contradicting the privacy invariant in `docs/ai-context.md:423,618`. | H | Hash or drop the query field. |
| P6-H-004 | `tests/run-benchmark.mjs:38`, `package.json:14` | The benchmark defaults to `hybrid`, so the unqualified command reports 0.4385 while `data/baseline.json` records the BM25 figure 0.9231. | H | Default to `--mode bm25`. |
| P6-H-006 | `src/cli/feedback.mjs:110-112`, `src/telemetry/feedback.mjs:61` | Attribution needs `decision.prompt`, but decision logs persist only `promptHash`, so `--json` never emits `attributions`. | H | Persist an attribution-safe input or hash-match it. |
| P6-H-009 | `data/skill-index.json` entries | The generated index stores absolute user-local `SKILL.md` paths; the file is git-ignored but non-portable, and `src/core/retriever/bm25.mjs:112-114` silently skips unresolvable paths. | H | Store repo-relative paths. |
| P6-H-011 | `src/config/defaults.mjs:141-152`, `src/config/env.mjs:66` | Both env parsers assign an array whenever the value contains a comma, so `SKILL_ROUTER_BM25_K1=1,2` makes `bm25.k1` an array. | H | Apply the array convention to list fields only. |
| P6-H-012 | `hooks/route.mjs:221,287` | `RoutePlan.mode` emits `bm25` / `none` / `explicit`; `docs/ai-context.md:542` declares `"flat" \| "hierarchical" \| "single" \| "multi" \| "fallback"`. | H | Emit the documented union. |
| P6-H-013 | `hooks/route.mjs:142` | A fresh `QueryCache` is built per hook process, so the `cache` telemetry event always reports 0 hits in production. | H | Persist the cache or drop the event. |

The other first-pass High items are re-verified in the category tables above:
`P6-H-005` = XP-1, `P6-H-007` = CONF-1, `P6-H-008` = XP-2, `P6-H-010` = SIL-11,
`P6-H-014`–`P6-H-019` = SIL-1, SIL-2, SIL-3, CONF-2, DEAD-2, DEAD-1.

## 4. Corrected claims from the first pass

1. **"Path-traversal guards in the importer are effective"** (first pass, §4.8)
   was wrong. `hasTraversal()` ran on an already-`resolve()`d absolute directory
   and on `candidate.sourcePath`, never on the untrusted `name`. The auditor's
   runtime reproduction wrote `SKILL.md` outside `data/skills`; now recorded as
   C3 and P6-C3.
2. **"No security vulnerability requiring immediate attention"** (first-pass
   framing) was wrong for the same reason; the security blocker is now C3/C4,
   both fixed with regression tests.

---

## 5. Changes made in Sub-Phase 6.4

- **Code (C1):** `src/scorer.mjs` (`resolveFieldWeight`),
  `src/core/retriever/bm25.mjs` (exported `buildWeightedDocTokens`),
  `src/core/routing/detector.mjs` (uses the helper).
- **Code (C2):** static `node:fs` / `node:child_process` imports in
  `src/cli/add.mjs`, `src/cli/doctor.mjs`, `tests/run-benchmark.mjs`,
  `tests/integration/phase-2.mjs`.
- **Code (C3, C4):** `src/utils/fs.mjs` (`isWithinRoot`, `isSafeName`);
  `src/import/importer.mjs`, `src/cli/import.mjs`, `src/cli/add.mjs`,
  `src/sync/disabler.mjs`, `src/sync/writer.mjs` reject unsafe names and
  out-of-root targets.
- **Tests:** `tests/retriever/field-weight-safety.test.mjs` (19),
  `tests/cli/esm-require.test.mjs` (5), `tests/security/path-traversal.test.mjs`
  (20), `tests/security/cli-path-traversal.test.mjs` (10), shared
  `tests/security/helpers.mjs`; all registered in the `package.json` `test` chain.
- **Docs:** this report, 19 `P6-H-0NN` entries plus the P6-C3 / P6-C4 resolved
  rows in `docs/problems.md`, and the 6.4 entry-log line in
  `docs/current-state.md`.

## 6. Recommended Fixes (Critical and High only)

| Priority | ID | Action |
|---|---|---|
| Done | C1–C4 | Fractional-weight crash, ESM `require()`, and both path-traversal arbitrary-write classes are fixed and covered by regression tests. |
| 1 | P6-H-014 (SIL-1) | Make `snapshotMirror()` fail loudly on a partial read; rollback currently trusts an empty snapshot and deletes mirror directories. |
| 1 | P6-H-015 (SIL-2) | Make `planSync()` fail when a skill tree cannot be indexed; an empty project index currently plans a mass removal. |
| 1 | P6-H-016 (SIL-3) | Branch on `ENOENT` in `readSignalFiles()`; any other error currently turns the whole outcome corpus into "positive". |
| 2 | P6-H-001, P6-H-003 | Decide the hook shortlist policy and update the E2E expectations; stop persisting raw prompts and prompt prefixes. |
| 2 | P6-H-005 (XP-1) | Normalise deploy snapshot paths to POSIX form before relying on rollback or `--restore` on Windows. |
| 2 | P6-H-006, P6-H-007, P6-H-011, P6-H-017 (CONF-1, CONF-2) | Make `getConfig()` the single authoritative config source, validate scalar env values, and make decision logs carry the attribution input. |
| 3 | P6-H-002, P6-H-004, P6-H-008, P6-H-009, P6-H-012, P6-H-013 | Budget overflow, default benchmark mode, cwd-relative data paths, absolute paths in the generated index, `RoutePlan.mode` union, and the per-process query cache. |
| 3 | P6-H-010, P6-H-018, P6-H-019 | Replace `stat()` with `lstat()` + `realpath()` for symlink containment; delete `src/retriever.mjs` and `src/logger.mjs` after repointing the analyzer and the health file list. |
