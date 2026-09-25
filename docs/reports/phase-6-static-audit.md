# Phase 6 — Static Audit Report (Sub-Phase 6.4)

- **Date:** 2026-09-24
- **Agent:** static-audit lead
- **Scope:** `src/**` (82 modules), `hooks/**` (2), `bin/**` (1) — 85 `.mjs`
  modules in total — plus the test harness files the DoD depends on
  (`tests/run-benchmark.mjs`, `tests/integration/phase-2.mjs`).
- **Method:** full read of every module listed in `find src hooks bin -type f`
  (13,358 lines), plus deterministic probes executed in this session (commands and
  output quoted inline). No finding below is inferred from memory.
- **Rule applied:** Critical items fixed immediately with regression tests; High
  items recorded in `docs/problems.md` with `P6-H` identifiers and left unfixed.

---

## 0. Verification runs executed in this session

| Command | Result |
|---|---|
| `node tests/run-benchmark.mjs` (package `test`/`benchmark` entry) | Top-1 **0.4385** (57/130) — runs in **hybrid** mode by default |
| `node tests/run-benchmark.mjs --mode bm25` | Top-1 **0.9231** (120/130), Recall@3 0.8923, median 2 ms |
| `node tests/two-mode-benchmark/runner.mjs` | 40/40 overall, implicit Top-1 25/25 |
| full `package.json` `test` chain (45 commands, run one-by-one via `node <file>` per AGENTS.md) | **45/45 commands exit 0, 0 failing** after the fixes |
| `node tests/retriever/field-weight-safety.test.mjs` (new) | 19/19 pass |
| `node tests/cli/esm-require.test.mjs` (new) | 5/5 pass |

`npm` was not used anywhere (AGENTS.md environment gotcha).

---

## 1. Module inventory

### 1.1 Counts

`find src hooks bin -type f` → 86 files, of which 85 are `.mjs` (`src` 82,
`hooks` 2, `bin` 1) and 1 is `hooks/hooks.json`; 13,358 `.mjs` lines at the
pre-fix commit `ffb8424`, 13,395 after the C1/C2 fixes in this sub-phase.
Largest modules: `src/deploy/writer.mjs` (502), `src/cli/verify.mjs` (466),
`src/cli/health.mjs` (442), `src/cli/tune-core.mjs` (346), `src/quality/validator.mjs` (328),
`src/analytics/analyzer.mjs` (324), `src/cli/feedback.mjs` (316), `hooks/route.mjs` (312).

### 1.2 Entry points and their dispatch

- `bin/skill-router.mjs:38-47` — dynamic `import(pathToFileURL(cliDir/<subcommand>.mjs))`,
  requires an exported `main()`. Verified working for all 18 subcommands via the
  `test:cli` / `test:e2e` chains above.
- `hooks/route.mjs` (UserPromptSubmit), `hooks/build-index.mjs` (reindex),
  `node src/tuning/optimizer.mjs`, `node src/quality/validator.mjs`,
  `node src/import/scanner.mjs` all carry their own "am I the entry point?" guard.

### 1.3 Public surface (`src/index.mjs`)

Re-exports retrieval, reranker, embeddings, routing, telemetry, config, utils,
cache and loader symbols (`src/index.mjs:8-46`). It does **not** re-export
`selectRouter`, `detectExplicitSkill`, `routeHybrid`/`routeWithExplicit`, the
budget manager, the query-expander, or any `src/cli/*` module — consumers must
reach into internal paths for those (see Finding **DUP-1**).

---

## 2. Critical findings (fixed in this sub-phase)

### C1 — Fractional BM25 field weights crash retrieval (`RangeError`)

**Severity:** Critical — total retrieval outage, reachable from the project's own
tuning output and from any hand-edited `data/weights.json`.

**Code:** `src/core/retriever/bm25.mjs:41-44` (pre-fix) and
`src/core/routing/detector.mjs:47-50` (pre-fix) built each document's token array as

```js
...Array(nameTokens.length * nameWeight)     // non-integer → RangeError
...kwTokens.map((t) => t.repeat(keywordWeight > 1 ? keywordWeight : 1))
```

`Array(n)` requires an integer and `String.prototype.repeat` requires an integer
count, so any fractional weight throws. Fractional weights are exactly what
`src/core/retriever/weights.mjs:76-92` produces (delta math + sum-preserving
normalisation, no rounding) and what `src/cli/tune-core.mjs:245` writes to
`data/weights.json`. `src/config/defaults.mjs:45-60` accepts any JSON number.

**Evidence (this session, before the fix):**

```
$ printf '{"name":2.71,"description":2.71,"keywords":0.57}' > data/weights.json
$ node --input-type=module -e "... rankSkills('eloquent relationship', idx) ..."
THREW: RangeError: Invalid array length
```

Impact path: the hook catches the error and exits 0 without writing
`output.json` (`hooks/route.mjs:143-178` → `process.exit(0)`), so the plugin
silently stops routing; `node tests/run-benchmark.mjs` dies with
`Failed to load index: ...`.

**Fix:** new `resolveFieldWeight()` in `src/scorer.mjs:31-45` normalises a weight
to a positive integer (`max(1, round(w))`, non-numeric → 1), and the duplicated
token-building code now lives once in `buildWeightedDocTokens()`
(`src/core/retriever/bm25.mjs:20-49`) and is shared by `rankSkills()`
(`src/core/retriever/bm25.mjs:55-62`) and `detectDomains()`
(`src/core/routing/detector.mjs:43-53`).

**Tests:** `tests/retriever/field-weight-safety.test.mjs` (19 assertions) —
normalisation rules, hostile-weight token construction, and a child process whose
`data/weights.json` is fractional asserting `rankSkills` + `detectDomains` still rank
correctly. Added to `package.json` `test`.

**Verification after fix:** the same fractional-weights probe prints
`fractional weights OK, top: backend-eloquent n= 60` and
`detectDomains top: database 0.71`.

---

### C2 — `require()` inside ESM modules: two CLI commands silently wrong

**Severity:** Critical — a shipped CLI command is 100 % broken, and a health
command reports a false negative; both defects were hidden by `catch` blocks.

**Code:**
- `src/cli/add.mjs:96` (pre-fix) — `require('node:fs').readdirSync(...)` inside
  `getRegisteredDomains()`, wrapped by `catch { return []; }` (`src/cli/add.mjs:97-99`).
- `src/cli/doctor.mjs:61-62` (pre-fix) — `require('node:fs').writeFileSync/unlinkSync`
  inside `isWritable()`, wrapped by `catch { return 'no'; }` (`src/cli/doctor.mjs:63-65`).
- `tests/run-benchmark.mjs:161` and `tests/integration/phase-2.mjs:130` (pre-fix) —
  `require('node:child_process')` in the synthetic-corpus generator path.

`package.json:3` declares `"type": "module"` and every module is `.mjs`, so
`require` is not defined. (Node 26 does expose a `require` binding in some
non-entry contexts, which is why the first probe looked green; running the real
entry point reproduces the failure — see below.)

**Evidence (this session, before the fix):**

```
$ node bin/skill-router.mjs add tmp-audit/SKILL2.md          # a valid backend SKILL.md, score 100 when domains resolve
Validation failed for backend-audit-probe:
  • [domains] Unknown domain(s): backend
  Score: 83/100
EXIT=1
skill NOT written

$ node bin/skill-router.mjs doctor | grep -i writ
  Writable                     no          # while a direct write to that same directory succeeded ("manual write OK")

$ node tests/run-benchmark.mjs --corpus synthetic-500
  Generating synthetic corpus (500 skills)...
Failed to load index: require is not defined
```

**Fix:** static `node:fs` imports in `src/cli/add.mjs:5-8` and
`src/cli/doctor.mjs:15-19`; static `node:child_process` imports in
`tests/run-benchmark.mjs:17` and `tests/integration/phase-2.mjs:14`.

**Tests:** `tests/cli/esm-require.test.mjs` (5 assertions) — a static scan asserting
no `require(` call exists in any `.mjs` under `src/ hooks/ bin/ tests/ scripts/`,
plus functional checks that `add --dry-run` scores a valid backend skill `100/100`
and that `doctor` reports the mirror as writable. Added to `package.json`
`test` and `test:cli`.

**Verification after fix:**

```
$ node bin/skill-router.mjs add tmp-audit/SKILL2.md --dry-run
[dry-run] Would add skill: backend-audit-probe (score: 100/100)
EXIT=0
$ node bin/skill-router.mjs doctor | grep -i writ
  Writable                     yes
$ node tests/run-benchmark.mjs --corpus synthetic-50      # generator path now reachable
... (benchmark completes)
```

---

## 3. High findings (recorded in `docs/problems.md`, not fixed here)

| ID | Finding | Evidence |
|---|---|---|
| **P6-H1** | **Route hook injects the entire 54-skill corpus into every prompt.** `hooks/route.mjs:152-165` calls `rankSkills(query, idx)` with no `topK` and no score floor; `rankSkills` returns *every* document sorted, including zero-score ones, so `decision.skills` is 54 entries and `readSkillContent` (`hooks/route.mjs:259`) reads all 54 files. Violates the documented shortlist contract (`docs/ai-context.md:502` "truncated to `topK` (default 5)" and `:521` "If zero results match, the hook returns an empty suggestion list") and burns 28 KB of context per prompt. | `echo '{"prompt":"zzzz qqqq wwww","cwd":"."}' \| node hooks/route.mjs` → `skillsInContext 54`, `ctxLen 28183`, `Confidence: 0`. Same for a normal prompt (`fix N+1 query in Laravel` → 54 skills). Not fixed: the E2E suite (`tests/e2e/hook-process.mjs:118-119`) explicitly asserts non-empty context for prompts that score **0.000**, so a threshold would flip an existing test — a product decision, not an audit-only fix. |
| **P6-H2** | **Context budget can be exceeded by design.** `src/core/budget/manager.mjs:56-57` takes `max(quota, minPerSkill)`, so `minPerSkill × skillCount` may exceed `maxChars`. | Hook budget log: `{"event":"budget","totalSkills":54,"rawTotalChars":216000,"injectedChars":24972,"budgetMaxChars":24000}` — 972 chars over a 24,000 budget. `tests/budget/manager.test.mjs:117-122` asserts the overflow, so it is intentional in the tests but contradicts the module's own docstring (`manager.mjs:2-6`). |
| **P6-H3** | **Raw prompts are persisted, contradicting the stated privacy invariant.** `hooks/route.mjs:191,200,213,270` pass `query: trimmedPrompt` to `logRetrieve`/`logRecord`; `src/telemetry/session-tracker.mjs:118` stores `prompt.slice(0, 60)` as `fingerprint` in `logs/session-*.json`. | After a hook run in a temp cwd: `grep -rl "quantum blockchain" .` → `logs/2026-09-24.jsonl`, `logs/session-20260924.json`; `"fingerprint": "implement a quantum blockchain ledger"`. `docs/ai-context.md:423,618` states "Never logs raw query text" / "Raw prompts are never stored or displayed". `session-tracker.mjs:194` also documents "first 20 chars" while the code slices 60. |
| **P6-H4** | **The default benchmark mode contradicts the frozen baseline.** `tests/run-benchmark.mjs:38` defaults `--mode` to `hybrid`; `package.json:14` runs it with no mode. | `node tests/run-benchmark.mjs` → Top-1 **0.4385** (57/130). `node tests/run-benchmark.mjs --mode bm25` → Top-1 **0.9231** (120/130), matching `data/baseline.json`. `src/cli/tune-core.mjs:150` therefore passes `--mode bm25` explicitly. |
| **P6-H5** | **Deploy snapshot/rollback is broken on Windows path separators.** `src/deploy/writer.mjs:127` stores `join(entry.name, 'SKILL.md')` (backslashes), while `rollbackMirror` matches `f.path.startsWith(entry.name + '/')` (`writer.mjs:154`) and `restoreFromSnapshot` does `file.path.split('/')` (`writer.mjs:347`). On Windows the match never succeeds and the split never separates, so `deploy` rollback deletes newly created router directories and `--restore` cannot rebuild them. | Static evidence only — the destructive path needs a live deploy error to trigger; no deploy was executed in this audit. |
| **P6-H6** | **`feedback --outcomes` attribution is structurally dead.** `src/cli/feedback.mjs:110-112` requires `decision.prompt`, but decision logs only persist `promptHash` (`src/telemetry/feedback.mjs:61`), so every attribution is `null` and no weight recommendation is ever produced. | `node bin/skill-router.mjs feedback --outcomes --json` → `{"positive":0,"negative":0,"unknown":300,"total":300,"negatives":[]}` with no `attributions` key. |
| **P6-H7** | **Documented `SKILL_ROUTER_BM25_*` env overrides never reach the scorer.** `src/core/retriever/bm25.mjs:7,55`, `src/core/routing/detector.mjs:19`, `src/core/retriever/attribution.mjs:9,11`, `src/core/retriever/hybrid.mjs:13,15` and `src/core/routing/hybrid.mjs:25,28` read `getDefaults()`, not `getConfig()`; only `src/core/routing/hierarchical.mjs:16-20` uses `getConfig()`, and its destructured `k1/b/nameWeight/...` are never used. | `SKILL_ROUTER_BM25_NAME_WEIGHT=1` vs `=10` produce byte-identical top-5 (`design-color-theory:1.000 | design-accessibility:0.807 | ...`) while `getConfig().bm25.nameWeight` reports 10. `docs/ai-context.md:588-592` documents these variables. |
| **P6-H8** | **cwd-relative data paths, inconsistent with the Phase 3.5 fix.** `hooks/route.mjs:26-27` resolves the index from `import.meta.url`, but `src/core/telemetry/logger.mjs:9`, `src/telemetry/{feedback,signals,session-tracker}.mjs:10/15/19`, `src/analytics/{reader,analyzer}.mjs:10,19-20`, `src/config/defaults.mjs:25,46`, `src/core/routing/domain-registry.mjs:14`, `hooks/build-index.mjs:27-28`, `src/cli/reindex.mjs:15-16` all use `resolve('logs'|'data/…')`. Running the hook from a foreign cwd writes telemetry into the user's project and makes `data/weights.json` / `data/thresholds.json` invisible (silent fallback to hardcoded 3/2/1). | Hook run from `/tmp/ht3` created `/tmp/ht3/logs/{2026-09-24.jsonl,routing-20260924.jsonl,session-20260924.json,signals-20260924.jsonl}`. |
| **P6-H9** | **Generated index stores absolute personal paths.** `data/skill-index.json` entries carry absolute user-local paths to `SKILL.md` files. The file is git-ignored (`.gitignore:10`), but the artifact is non-portable and `readSkillContent` (`src/core/retriever/bm25.mjs:105-115`) silently skips any file it can no longer resolve. | `node -e "...console.log(JSON.parse(fs.readFileSync('data/skill-index.json'))[0].path)"` → `%USERPROFILE%\\\\Desktop\\\\projects\\\\zcode-operation-skill\\\\data\\\\skills\\\\backend\\\\laravel\\\\api-resources\\\\SKILL.md`; `git check-ignore -v data/skill-index.json` → `.gitignore:10`. |
| **P6-H10** | **Symlink-containment checks are dead code in three modules.** `src/sync/planner.mjs:84-90`, `src/import/scanner.mjs:105-108` and `src/cli/import.mjs:33-34` use `stat()` (which follows symlinks) and then test `isSymbolicLink()`, which is always `false`; `src/cli/import.mjs:34` additionally resolves the link *target's file contents* as a path. The documented guarantee (`docs/ai-context.md:330-331`) is therefore not actually enforced. | Static evidence (`fs.stat` follows links; `fs.lstat` does not). Runtime reproduction was not possible on this host — `fs.symlinkSync` returns `EPERM` here — so no runtime claim is made. |
| **P6-H11** | **`mergeWithEnv` can corrupt scalar config into arrays.** `src/config/defaults.mjs:141-152` assigns a parsed array whenever the env value contains a comma, so `SKILL_ROUTER_BM25_K1=1,2` yields `cfg.bm25.k1 = [1,2]`; `src/config/env.mjs:66` repeats the same behaviour inside the schema-validated path. The "list parameters" convention is applied to scalar fields. | `SKILL_ROUTER_BM25_K1=1,2 node -e "...getConfig().bm25.k1"` → `bm25.k1 = [1,2] typeof object`. |
| **P6-H12** | **`RoutePlan.mode` violates its own contract.** `hooks/route.mjs:286` writes `decision.mode ?? tier`, producing `"bm25"`, `"none"` or `"explicit"`; `docs/ai-context.md:542` declares the union `"flat" | "hierarchical" | "single" | "multi" | "fallback"`. | Hook output for an implicit prompt: `RoutePlan.mode === "bm25"`. |
| **P6-H13** | **The query cache can never hit in production.** `hooks/route.mjs:141` constructs a fresh `QueryCache` per hook invocation, and each invocation is a new process; the "cache" telemetry event (`hooks/route.mjs:197-208`) is therefore always 0 hits. | `node tests/run-benchmark.mjs --mode bm25` (single process) reports `Cache Hits: 1 / Cache Misses: 129`; hook runs spawn one process each. |

---

## 4. Inventory by requested category

### 4.1 Imports and exports

- **Convention:** all runtime imports use `node:`-prefixed specifiers, except two
  legacy modules: `src/retriever.mjs:1-2` (`'fs/promises'`, `'path'`) and
  `src/logger.mjs:1-2` (`'fs/promises'`, `'path'`).
- **Dynamic imports:** `bin/skill-router.mjs:40`, `hooks/route.mjs:297`,
  `src/cli/{benchmark,health}.mjs:13/55`, `src/cli/tune-core.mjs:198`
  (a redundant dynamic re-import of an already statically imported module).
- **`require()`:** none remain in `src/`, `hooks/`, `bin/`, `tests/`, `scripts/`
  (enforced by the new test; see C2).
- **Unused imports: 37 across 24 modules** (independently re-measured during the
  6.4 review on the post-fix tree with the same heuristic: 36 across 22 modules) (scanned with a throwaway script that
  strips each `import {…}` statement and regex-matches the remaining identifier;
  script deleted after the run). Examples: `src/cli/verify.mjs:21,25`
  (`readdirSync, writeFileSync, rmSync, statSync, readSyncState`),
  `src/sync/writer.mjs:17,23` (`readdirSync, dirname`),
  `src/core/retriever/weights.mjs:13` (`getDefaults`),
  `src/core/routing/hierarchical.mjs:13` (`computeIdf`),
  `src/telemetry/session-tracker.mjs:17` (`existsSync, join`),
  `src/utils/fs.mjs:6` (`stat`). Unused *locals* also exist:
  `src/core/retriever/hybrid.mjs:37` (`doRerank`), `src/cli/benchmark.mjs:9`
  (`args`), `hooks/route.mjs:47` (`modeLabel`), `src/sync/writer.mjs:153`
  (`mirrorSkillDir`).
- **Exports never consumed:** `src/logger.mjs:17` `logDecision` (no importer —
  only a filename string reference in `src/cli/health.mjs:114`),
  `src/core/budget/truncator.mjs:57` `charCount`, `src/tuning/optimizer.mjs:37`
  `evaluate` (dead, see 4.3), `src/core/cache/query-cache.mjs:20` `sha256hex`
  and `:209` `_origGetOrSet`.
- **Barrel incompleteness:** `src/index.mjs` omits `selectRouter`, `detectExplicitSkill`,
  `routeHybrid`, `routeWithExplicit`, `fitWithinBudget`, `expandQuery`,
  `buildSynonymMap`, `attributeOutcome`, `computeWeights` — consumers (hook, tests)
  import internal paths directly.

### 4.2 Duplicate functions (duplication inventory)

| Function / constant | Copies | Notes |
|---|---|---|
| `rankSkills`, `readSkillContent` | `src/core/retriever/bm25.mjs:55,105` **and** `src/retriever.mjs:14,59` | Legacy copy hardcodes weights 3/2/1 and ignores `data/weights.json` + env. Still imported by `src/analytics/analyzer.mjs:17`, so analytics ranks with a *different* scorer than production. |
| `logDecision` | `src/telemetry/feedback.mjs:50` **and** `src/logger.mjs:17` | Different schemas, different files (`logs/routing-YYYYMMDD.jsonl` vs `logs/routing.jsonl`); the legacy one documents a raw `record.prompt` field and is unused. |
| `parseFrontmatter` | 5 copies: `src/loader.mjs:16`, `src/quality/validator.mjs:58`, `src/cli/list.mjs:130`, `src/cli/stats.mjs:137`, `src/cli/sources.mjs:149` (+ `tests/run-benchmark.mjs:61`) | `src/quality/validator.mjs:53` even documents "Mirrors the implementation in src/loader.mjs". |
| `loadSkillsSync` | 3 copies: `src/cli/list.mjs:95`, `src/cli/stats.mjs:102`, `src/cli/sources.mjs:115` | Third async implementation in `src/loader.mjs:90`. |
| `tagSkillsBySource` | 3 copies: `hooks/build-index.mjs:86`, `src/cli/reindex.mjs:60`, `src/cli/sources.mjs:18` | Identical bodies including the separator probe. |
| `hashContent` | 5 copies: `src/sync/planner.mjs:47`, `src/sync/writer.mjs:75`, `src/sync/disabler.mjs:66`, `src/deploy/planner.mjs:46`, `src/deploy/verifier.mjs:56` | |
| `readMeta` | 5 copies: `src/sync/writer.mjs:92`, `src/sync/disabler.mjs:73`, `src/deploy/writer.mjs:83`, `src/deploy/planner.mjs:53`, `src/deploy/verifier.mjs:63` | Behaviour drift: the `sync/` copies return `null` on malformed JSON, which `writer.mjs:222-227` then treats as "user-managed → skip". |
| `isWithinRoot` | 3 copies: `src/import/scanner.mjs:48`, `src/sync/writer.mjs:82`, `src/deploy/planner.mjs:66` | |
| `META_FILENAME` / `SKILL_FILE_NAME` constants | 5 files (`src/sync/{writer,disabler}.mjs`, `src/deploy/{planner,writer,verifier}.mjs`) | |
| `STOPWORDS` sets | `src/scorer.mjs:1-15` and `src/utils/text.mjs:9-23` | Sets are currently identical (verified: 114 unique entries each, symmetric difference empty); `scorer.mjs` lists `again` and `been` twice. `utils/text.mjs:53` filters with its own copy, not the scorer's. |
| `hashPrompt` | `src/telemetry/feedback.mjs:19` (`sha256:<hex>`) and `src/analytics/analyzer.mjs:28` (bare hex) | Two incompatible formats for the same concept. |
| ANSI colour helpers | 5 CLI modules (`feedback.mjs:15-20`, `tune.mjs:21-26`, `tune-core.mjs:39-47`, `verify.mjs:31-36`, `health.mjs:28-33`) | |
| **New in 6.4** | `buildWeightedDocTokens` | The BM25 doc-building block that was duplicated in `bm25.mjs` and `detector.mjs` is now one exported helper (`src/core/retriever/bm25.mjs:20-49`). |

### 4.3 Error and config conventions

- **Config sources are mixed.** `getDefaults()` (no env) is used by
  `bm25.mjs`, `detector.mjs`, `attribution.mjs`, `core/retriever/hybrid.mjs`,
  `core/routing/hybrid.mjs`, `core/embeddings/engine.mjs`, `core/reranker/engine.mjs`;
  `getConfig()` (env-merged) only by `core/routing/hierarchical.mjs` and the hook.
  See **P6-H7**.
- **Module-load-time config snapshot.** `src/config/defaults.mjs:37,63` caches
  `_thresholds`/`_weights` at import; `bm25.mjs:55` now re-reads `getDefaults()`
  per call (cheap, since the file read is still cached at module level) but a
  long-lived process never sees a new `data/weights.json`.
- **Two overlapping env parsers.** `mergeWithEnv` (`defaults.mjs:136-180`,
  unvalidated) and `mergeEnvOverrides` (`env.mjs:75-110`, range-checked) both
  implement the same overrides; `mergeEnvOverrides` calls the first and then
  re-applies. Scalar/array confusion: **P6-H11**.
- **Boolean parsing is lenient**: `SKILL_ROUTER_SLM_ENABLED=banana` → `true`
  (`defaults.mjs:174-177`).
- **Error surfacing:** hook paths fail open by design
  (`hooks/route.mjs:80-119,174-178,308-311`); CLI paths `console.error` +
  `process.exit(1)`. `bin/skill-router.mjs:49-53` maps *any* `MODULE_NOT_FOUND`
  to "Unknown subcommand", so a missing transitive dependency is misreported.
  `bin/skill-router.mjs:43` calls `mod.main(...)` without `await`, so async
  subcommand rejections are unhandled.
- **Exit-code contract:** `health.mjs:433-440` (0/1/2) and `verify.mjs:464`
  (0/1) are inconsistent with every other CLI (0/1).
- **Dead tuning code:** `src/tuning/optimizer.mjs:37-60` `evaluate()` is never
  called and never increments `hits`; its `high` parameter is unused, and
  `evaluateFull` (`:72`) also ignores `high`. Grid search is unaffected because
  it calls `evaluateFull`.
- **Unverifiable contract:** `src/deploy/hook-registrar.mjs:20-21` sets
  `command: 'node'` with `args: ['node', '${ZCODE_PLUGIN_ROOT}/hooks/route.mjs']`
  (the executable is repeated inside `args`). Whether ZCode expects that shape
  could not be checked from this repository — the registrar's own tests encode
  the current form (`tests/deploy/hook-registrar.test.mjs`), so no defect is
  claimed, only a "verify against the real ZCode schema" note.

### 4.4 Hardcoded values and absolute paths

- Absolute personal path in generated `data/skill-index.json` → **P6-H9**.
- `resolve('logs'|'data/…')` module constants (cwd-dependent) → **P6-H8**.
- `homedir()` defaults: `src/sync/planner.mjs:37`, `src/deploy/{planner,verifier}.mjs:39/49`,
  `src/deploy/writer.mjs:76`, `src/deploy/hook-registrar.mjs:17-18`,
  `src/cli/{verify,health,doctor}.mjs:78/53/88`. `src/deploy/hook-registrar.mjs`
  therefore writes to `~/.zcode/cli/config.json`, which conflicts with the
  `AGENTS.md:19-23` rule "Never Modify ~/.zcode/" — this is the documented Phase 4
  behaviour (`docs/ai-context.md:252-254`), so it is recorded as a rule/doc
  conflict, not a code defect.
- Un-configurable magic numbers: `src/core/retriever/bm25.mjs:113` (4000-char read
  cap), `src/core/routing/hybrid.mjs:105` (`bm25MinThreshold` default 0.35),
  `src/core/slm/parser.mjs:89,104` (score ≥ 0.5, cap 7),
  `src/core/slm/prompt-builder.mjs:8-9` (30 candidates / 200 chars),
  `src/core/routing/hierarchical.mjs:219-223` (0.15 bonus threshold, 1.05/1.02),
  `src/core/telemetry/logger.mjs:9` + `logs/YYYY-MM-DD.jsonl`,
  `src/telemetry/*` fixed filename prefixes.
- `src/core/embeddings/engine.mjs:133` JSDoc claims `buildEmbeddingIndex` "writes
  the index to data/skill-embeddings.json"; it does not (the writers are
  `hooks/build-index.mjs:148` and `src/cli/reindex.mjs:140`).

### 4.5 Path separators

- Working: `src/analytics/analyzer.mjs:123-127`, `src/quality/validator.mjs:317`,
  `src/cli/validate.mjs:39`, `src/import/reporter.mjs:52,68,87` all normalise
  `\\` → `/` before string surgery.
- Fragile: `hooks/build-index.mjs:92`, `src/cli/reindex.mjs:65`,
  `src/cli/sources.mjs:23` probe one character (`skill.path[src.path.length] === '\\'`)
  to pick a separator.
- Broken: `src/deploy/writer.mjs:127` vs `:154` and `:347` → **P6-H5**.
- `src/sync/planner.mjs:129` calls `dirname()` on a forward-slash-normalised path;
  correct on win32, but it mixes conventions inside one expression.
- `src/deploy/writer.mjs:77` computes `LOGS_DEPLOYS_DIR` from `process.cwd()` at
  import time while its sibling `DEFAULT_SNAPSHOT_DIR` uses `homedir()` — snapshot
  locations depend on where the process was started.

### 4.6 Silent failures

- 11 empty `catch {}` blocks (scanned): `src/cli/tune-core.mjs:241`,
  `src/core/routing/domain-registry.mjs:54,133`, `src/deploy/writer.mjs:125,139,166,275,306,372,423,429`.
  Most are deliberate best-effort I/O; the deploy ones hide snapshot and restore
  failures behind a "Rollback successful" message (`src/deploy/writer.mjs:479-482`).
- `src/core/routing/domain-registry.mjs:48-53` is dead code that *reads a
  directory as a file* inside `try { … } catch {}` and discards the result.
- `readSkillContent` swallows every read error (`src/core/retriever/bm25.mjs:112-114`)
  and `hooks/route.mjs:255` substitutes a `path: ''` entry, which then resolves to
  the cwd and fails silently again.
- The two `require()` swallow-and-fallback defects (C2) are the worst offenders:
  both turned a hard error into a confidently wrong answer.
- Telemetry/log writes intentionally fail open
  (`src/core/telemetry/logger.mjs:31-33`, `src/telemetry/feedback.mjs:66-68`),
  but nothing records that telemetry is being dropped.

### 4.7 JSDoc / type-safety

- **Contract mismatches:** `src/core/retriever/hybrid.mjs:31` documents
  `options.rerank=true` (default on) while line 110 only reranks for an explicit
  `=== true`, and line 37's `doRerank` is dead;
  `src/core/slm/parser.mjs:12` documents cross-checking against `knownSkills`
  although `parseSingleSelection` never uses the parameter;
  `src/core/slm/prompt-builder.mjs:50,88` document an `options` parameter that is
  never read.
- **Unresolvable type references:** `src/core/retriever/weights.mjs:23` uses
  `import('./attribution.mjs').Attribution` although the typedef is not exported
  (`src/core/retriever/attribution.mjs:135-142`); `src/analytics/reader.mjs:15`
  and `src/core/telemetry/reporter.mjs:9,31` reference `LogEntry` /
  inline shapes that are never defined.
- **Numeric type safety:** fractional weights reaching `Array(n)`/`repeat()`
  (the Critical C1); `src/config/env.mjs:66` returning arrays for scalar fields
  (**P6-H11**).
- **Non-English comment:** `src/quality/validator.mjs:233` (`满分 = 6 checks passed`).
- **Params that lie:** `src/tuning/report.mjs:23-25` and
  `src/tuning/optimizer.mjs:194,100` use
  `import.meta.url.split('/').slice(3).join('/')` for entry-point detection,
  which does not survive Windows drive-letter paths; the rest of the codebase uses
  the `import.meta.url.endsWith(argv[1].replace(/\\/g,'/'))` pattern
  (e.g. `src/sync/writer.mjs:284-288`).

### 4.8 Categories that came back clean

- **No dependency was added**, and none is needed: `package.json` has no
  `dependencies`/`devDependencies` blocks (verified by reading `package.json`).
- **No network calls** in `src/`, `hooks/` or `bin/`; the only `fetch` is
  `src/core/slm/client.mjs:126,90` against the configured local endpoint, and the
  only sockets are the `health` port probe (`src/cli/health.mjs:285`).
- **No hardcoded secrets/tokens** and no personal paths in tracked source: the
  only absolute user-local path occurrence is the git-ignored generated index (**P6-H9**).
- **No `eval`, `new Function`, or shell interpolation of untrusted input**; the
  CLI arg parser only resolves paths (`src/cli/sync.mjs:33-48`).
- **Path-traversal guards in the importer are effective:**
  `src/import/importer.mjs:165-167,182-187` rejects `..`/`.` components before
  any copy, and the import test suite passes (`tests/import/importer.test.mjs`).

---

## 5. Changes made in Sub-Phase 6.4

| File | Change |
|---|---|
| `src/scorer.mjs` | added `resolveFieldWeight()` (C1) |
| `src/core/retriever/bm25.mjs` | added exported `buildWeightedDocTokens()`; `rankSkills()` uses it (C1) |
| `src/core/routing/detector.mjs` | `detectDomains()` uses the shared helper (C1) |
| `src/cli/add.mjs` | `node:fs` static imports replace `require()` (C2) |
| `src/cli/doctor.mjs` | `node:fs` static imports replace `require()` (C2) |
| `tests/run-benchmark.mjs`, `tests/integration/phase-2.mjs` | `spawnSync` static import replaces `require()` (C2) |
| `tests/retriever/field-weight-safety.test.mjs` | new — 19 assertions (C1) |
| `tests/cli/esm-require.test.mjs` | new — 5 assertions (C2); hardened during the 6.4 review to provision its own `data/domains/<name>` registry in a temp cwd, because `data/domains/` is generated and git-ignored (the original version failed on a fresh clone) |
| `package.json` | both new tests added to `test` / `test:cli` |
| `docs/problems.md` | 13 `P6-H` entries |
| `docs/current-state.md` | entry-log line |
| `docs/reports/phase-6-static-audit.md` | this report |

## 6. Recommended next actions (not done in 6.4)

1. Decide the hook shortlist policy (P6-H1/P6-H2) and update the E2E expectations
   in the same change — the current tests encode "always inject the corpus".
2. Reconcile the privacy invariant: hash or drop `query` in runtime logs and stop
   persisting prompt prefixes in session state (P6-H3).
3. Make one config source authoritative (`getConfig()` everywhere), validate
   `data/weights.json` integers at load, and normalise `SKILL_ROUTER_SOURCES` to
   `path.delimiter` (P6-H7, P6-H11, Windows drive letters).
4. Delete the legacy duplicates (`src/retriever.mjs`, `src/logger.mjs`) after
   repointing `src/analytics/analyzer.mjs` at the canonical modules.
5. Fix the deploy snapshot paths to POSIX form before relying on
   `deploy --restore` / automatic rollback on Windows (P6-H5).
