# Phase 5 — The Adaptation Loop — Final Report

> Date: 2026-09-24
> Branch: `main` (working tree modified, nothing committed, nothing pushed)
> Author: final-reporter (dynamic-workflow subagent)

## 0. Scope and provenance of the numbers in this report

Every number below was produced by commands executed in this reporting session
(2026-09-24) on this machine, unless the line explicitly says otherwise.
The exact commands are listed in section 11.

The Phase 5 workflow script that defined the 11 sub-phases is
`.zcode/workflow-drafts/phase-5-adaptation-loop.dwf.ts` (see its header at
line 1-3: "Runs 11 sub-phases across Parts A, B, C"). The output of the earlier
exploration / verification sub-agents of that workflow was **not available** to
this session — the tool that exposes workflow run history returned
`workflow_introspection_unavailable: this session cannot read workflow runs`.
Consequently:

- Sub-phase status for 5.1–5.10 is cited from the repository's own entry log
  (`docs/current-state.md`), changelog (`CHANGELOG.md`) and source code, not from
  a re-execution of those sub-agents.
- Sub-phase 5.11 (final verification) is this report plus the commands re-run here.
- Where a "before" number is quoted, the source file and line are given.

---

## 1. Executive summary — the 11 sub-phases

| # | Sub-phase | Scope (from the workflow script) | Status evidence | Outcome |
|---|-----------|----------------------------------|-----------------|---------|
| 5.1 | Corpus reconciliation | Confirm `data/skills/` holds exactly 54 real skills; move stray fixture skills; rebuild index; BM25 Top-1 must stay >= 90% (`.zcode/workflow-drafts/phase-5-adaptation-loop.dwf.ts:171-177`) | `docs/current-state.md:13` (Part A entry) | Corpus already reconciled: 54 leaf + 6 router skills, index rebuilt, 92.31% Top-1 |
| 5.2 | Resolve pre-existing test failures | Classify and fix the failures in `tests/routing.test.mjs`, `tests/hybrid.test.mjs`, `tests/reranker.test.mjs` (`.zcode/workflow-drafts/phase-5-adaptation-loop.dwf.ts:178-190`) | `docs/current-state.md:13`; `CHANGELOG.md:30-33` | 3 of 3 fixed; re-run here, all three exit 0 |
| 5.3 | Finalize Phase 4 | Run every test file; ensure `docs/reports/phase-4-final-report.md` exists; update state/changelog; list files to commit (`.zcode/workflow-drafts/phase-5-adaptation-loop.dwf.ts:191-198`) | `docs/reports/phase-4-final-report.md` exists; `docs/current-state.md:12` | Phase 4 report and changelog entries present; work left uncommitted per AGENTS.md |
| 5.4 | Implicit signal collection | `src/telemetry/signals.mjs`, `src/telemetry/session-tracker.mjs`, hook wiring, tests (`.zcode/workflow-drafts/phase-5-adaptation-loop.dwf.ts:234-258`) | `docs/current-state.md:11`; files present and tested | Implemented; 41 new assertions pass (19 signals + 22 session-tracker) |
| 5.5 | Outcome correlation | `src/telemetry/outcomes.mjs` with retry<=5m / explicit_override<=2m negative rules, `feedback --outcomes` (`.zcode/workflow-drafts/phase-5-adaptation-loop.dwf.ts:260-273`) | `docs/current-state.md:11`; `src/telemetry/outcomes.mjs:132-168` | Implemented; 32 assertions pass; CLI wiring has the defect recorded in section 9 |
| 5.6 | BM25 field attribution | `src/core/retriever/attribution.mjs` + `src/core/retriever/weights.mjs`, `feedback --outcomes` integration, `data/weights.json` loading (`.zcode/workflow-drafts/phase-5-adaptation-loop.dwf.ts:311-335`) | `docs/current-state.md:11`; `src/core/retriever/weights.mjs:16-19` | Implemented; 27 + 30 assertions pass |
| 5.7 | Tuning CLI | `src/cli/tune.mjs` with `--analyze/--apply/--rollback/--status` (`.zcode/workflow-drafts/phase-5-adaptation-loop.dwf.ts:378-388`) | `docs/current-state.md:10`; `src/cli/tune.mjs` | Implemented; 40 assertions pass; all four subcommands executed here |
| 5.8 | Guardrails and rollback | Pre/post benchmark, auto-rollback on >1pp drop, `logs/tuning/decisions.jsonl`, `src/cli/tune-guard.mjs` (`.zcode/workflow-drafts/phase-5-adaptation-loop.dwf.ts:390-403`) | `src/cli/tune-guard.mjs:18-19,70-108,121-127` | Implemented; 19 assertions pass; refusal path exercised live (section 8) |
| 5.9 | Automated tuning mode | `--auto`, `--auto --dry-run`, `--auto --threshold N`, `--report`, `scripts/periodic-tune.mjs` (`.zcode/workflow-drafts/phase-5-adaptation-loop.dwf.ts:405-415`) | `docs/current-state.md:10`; `scripts/periodic-tune.mjs` (128 lines) | Implemented; `--auto --dry-run` and `--report` executed here |
| 5.10 | Adaptation documentation | README, `docs/architecture.md`, `docs/ai-context.md`, new `docs/tuning.md`, `docs/cli-reference.md`, `HANDOFF.md`, `CHANGELOG.md` (`.zcode/workflow-drafts/phase-5-adaptation-loop.dwf.ts:448-477`) | `docs/current-state.md:9`; `docs/tuning.md` present | Completed by the docs sub-agent (recorded in the entry log; not re-verified line-by-line here) |
| 5.11 | Final verification and report | Re-run every test file, health, `verify --deep`, `feedback --outcomes`, all `tune` modes, BM25 benchmark, `git status` (`.zcode/workflow-drafts/phase-5-adaptation-loop.dwf.ts:516-538`, `557-577`) | This report, sections 2-11 | Re-executed in this session: 1650 assertions passed, 1 failed (see section 3) |

**Overall:** the adaptation loop is present, bounded by guardrails, and exercised
end to end. It has not yet accepted a real weight change — every tuning attempt
observed today was refused or dry-run (sections 7 and 8).

---

## 2. Corpus reconciliation (before / after skill counts)

Measured in this session:

```
$ node -e "<recursive SKILL.md walk of data/skills and router-skills>"
data/skills SKILL.md: 54
router-skills SKILL.md: 6
total 60

$ node -e "<read data/skill-index.json>"
total docs 60
by source {"project":60}
routers 6  router-design, router-laravel, router-meta, router-next, router-react, router-test
```

| Measure | Before Phase 5 (as recorded) | After (measured here) |
|---------|------------------------------|-----------------------|
| `data/skills/` leaf skills | 54 (`docs/current-state.md:13`, "corpus already reconciled") | 54 |
| `router-skills/` router skills | 6 (`docs/current-state.md:21`, "60 total: 54 leaf + 6 router") | 6 |
| `data/skill-index.json` entries | 60 (`docs/reports/phase-4-final-report.md`; index size 60 frozen in `data/baseline.json:19`) | 60 |
| Index entries by source | project only (router skills indexed as project entries) | `{"project":60}` — no `zcode-user` entries |
| Stray fixture skills in `data/skills/` | none reported | none found |
| `node bin/skill-router.mjs health` index freshness | — | PASS, "index valid — 60 skill(s)" |

No skill was added, removed, or moved during Phase 5. The reconciliation
conclusion is that the corpus was already consistent: 54 leaf + 6 router = 60
indexed entries, matching `data/baseline.json` (`indexSize: 60`).

---

## 3. Test results and failure resolutions

### 3.1 The three pre-existing failures fixed in sub-phase 5.2

All three had the same root cause and were fixed by making the tests use the same
leaf-only index the hook uses, plus one documented threshold correction.
Source: `docs/current-state.md:13` and `CHANGELOG.md:30-33`.

| Test file | What was wrong | How it was fixed | Re-run here |
|-----------|----------------|------------------|-------------|
| `tests/routing.test.mjs` | Fixture drift: `router-*` skills were present in the test index, so router descriptions polluted implicit hybrid retrieval and pushed leaf skills down. Hit rate dropped from 59% to 41% under a >= 50% threshold. | Test now builds a leaf-only index, matching `hooks/route.mjs:136` where implicit routing filters out `router-*`. Hit rate restored to 77/130 (59.2%). | `node tests/routing.test.mjs` -> exit 0, 43 passed / 0 failed |
| `tests/hybrid.test.mjs` | Two problems: (1) same router pollution caused Recall@3 fixture drift (restored to 19/20 = 95%); (2) stale Top-1 assertion at 90% (18/20) that FNV-1a n-gram embeddings cannot meet on this corpus. | Leaf-only index; Top-1 threshold lowered from 90% to 55% (72/130) with a WHY comment documenting FNV-1a limitations. | `node tests/hybrid.test.mjs` -> exit 0, 16 passed / 0 failed |
| `tests/reranker.test.mjs` | Fixture drift: router skills degraded hybrid Top-1 from 60% to 35% against a >= 10 threshold. | Leaf-only index; hybrid-without-rerank scores 12/20 (60%). | `node tests/reranker.test.mjs` -> exit 0, 21 passed / 0 failed |

### 3.2 Full suite re-run in this session

Command shape (one process per file, exit code captured):

```
for f in $(find tests -name "*.test.mjs" | sort); do node "$f"; echo "exit=$?"; done
```

| Suite group | Files | Assertions passed | Assertions failed |
|-------------|-------|-------------------|-------------------|
| Unit / component suites (`tests/**/*.test.mjs`) | 46 | 1299 | 1 |
| Integration + E2E (`tests/hook-edge-cases.mjs`, `tests/e2e/{full-pipeline,idempotency,orphan-cleanup,hook-process,full-loop}.mjs`) | 6 | 351 (17 + 80 + 27 + 50 + 144 + 33) | 0 |
| **Total** | **52** | **1650** | **1** |

E2E detail: `tests/e2e/hook-process.mjs` reported 144 passed / 0 failed assertions,
"Explicit routed: 6/6", "Fail-open cases: 2/2".

### 3.3 The one failure that remains

`node tests/tuning/optimizer.test.mjs` -> exit 1, 35 passed / 1 failed / 36 total.

Failing assertion: `✗ top1 0.8615 >= 0.89`.
Suite footer: `Optimized: high=0.85, medium=0.6`, `Top-1: 86.15%, Fallback: 8.46%`.

Assessment: this is **threshold drift in a pre-existing test**, not a Phase 5
regression. The same failure is documented in `docs/reports/phase-2-final-report.md:97`
and `docs/reports/phase-3-final-report.md:94` ("The optimizer achieves 86.15% Top-1
but the test targets >=89%"). The optimizer searches thresholds over the full
60-entry index, whereas the hook benchmarks the leaf-only corpus at 92.31%; the
86.15% figure and the >= 89% assertion come from different corpora. It was not
fixed in this reporting task (this ask is reporting only, and the fix requires a
decision on which corpus the optimizer should target).

---

## 4. New modules created

| Path | Lines | Purpose |
|------|-------|---------|
| `src/telemetry/signals.mjs` | 162 | `recordSignal()` appends user-correction signals (`retry`, `dismiss`, `rephrase`, `success`, `explicit_override`) to `logs/signals-YYYYMMDD.jsonl` with daily rotation; `readSignals()` with date/type filters. Fire-and-forget. |
| `src/telemetry/session-tracker.mjs` | 196 | `trackPrompt(prompt, promptHash)` derives implicit signals from prompt patterns in a 30-minute session window; persists session state to `logs/session-YYYYMMDD.json`; stores hashes, never raw prompts. |
| `src/telemetry/outcomes.mjs` | 188 | `correlate(decisions, signals)` classifies each decision `positive` / `negative` / `unknown` using time windows (retry <= 5m = negative, explicit_override <= 2m = negative, rephrase <= 5m = negative, no signals within 10m = positive, signals older than 10m = unknown); `correlateFromLogs()` reads the signal files. |
| `src/telemetry/feedback.mjs` | 235 | (Sub-phase 5.5 / Phase 4.6) structured routing-decision logger: `logDecision()` to `logs/routing-YYYYMMDD.jsonl` with SHA-256 prompt hashing, `readDecisions()`, `summarize()`. |
| `src/core/retriever/attribution.mjs` | 143 | `attributeOutcome(decision, outcome, index)` scores the top-ranked skill per BM25 field (name, description, keywords), picks the `dominantField`, returns an `Attribution` record. |
| `src/core/retriever/weights.mjs` | 119 | `computeWeights(attributions, currentWeights, opts)`: +5% / -5% gradient-free adjustment on the dominant field, clamp to `[0.5, 5.0]`, sum-preserving normalisation, `MIN_OUTCOMES = 20` minimum sample (`src/core/retriever/weights.mjs:16-19`). |
| `src/cli/tune.mjs` | 187 | The `tune` subcommand with `--analyze`, `--apply`, `--rollback`, `--status`, `--auto`, `--report`. |
| `src/cli/tune-core.mjs` | 346 | Shared tuning logic: benchmark invocation, snapshot management under `logs/weights/`, decision logging to `logs/tuning/decisions.jsonl`, `buildAttributions(promptCount)` (called with 130 at line 195). |
| `src/cli/tune-guard.mjs` | 136 | Guardrail engine: `loadBaseline()`, `checkSafety()` (bounds + `MAX_DELTA` + predicted accuracy), `evaluateOutcome()` (pre/post benchmark accept-vs-revert). |
| `src/cli/feedback.mjs` | 312 | `feedback` subcommand with `--outcomes`, `--json`, `--export`, `--limit`, `--since`. |
| `scripts/periodic-tune.mjs` | 128 | Cron / Task Scheduler-safe daily `tune --auto` job. |
| `data/baseline.json` | 21 | Frozen baseline: Top-1 0.9231, Recall@3 0.8923, median 3 ms, p95 5 ms, no-skill 0.0846, weights `{name:3, description:2, keywords:1}`, thresholds `{high:0.85, medium:0.6}`, `baselineAt 2026-09-24T13:00:00.000Z`, `indexSize 60`, `promptCount 130`. |
| `data/weights.json` | 5 | Current applied weights — still `{name:3, description:2, keywords:1}` (unchanged from baseline). |
| `docs/tuning.md` | — | Adaptation documentation: how the loop works, reading reports, when to run `--auto`, refused-tuning handling, safety guarantees. |
| `src/deploy/hook-registrar.mjs` | 233 | (Phase 4 scope) idempotent `UserPromptSubmit` registration into the ZCode CLI config with backup-before-write. |

Test files added for Phase 5: `tests/telemetry/signals.test.mjs` (19),
`tests/telemetry/session-tracker.test.mjs` (22), `tests/telemetry/outcomes.test.mjs` (32),
`tests/retriever/attribution.test.mjs` (27), `tests/retriever/weights.test.mjs` (30),
`tests/cli/tune.test.mjs` (40), `tests/cli/tune-guard.test.mjs` (19) — all pass in
this session. Fixtures live in `tests/telemetry/fixtures/`.

---

## 5. New CLI commands

Dispatch is dynamic (`bin/skill-router.mjs:38-44` imports `src/cli/<subcommand>.mjs`
and calls its exported `main`), so `tune`, `feedback --outcomes`, `health` and
`verify --deep` need no central registration. `src/cli/help.mjs:29` lists `tune`.

| Command | Purpose | Example |
|---------|---------|---------|
| `skill-router tune --analyze` | Compute attributions and proposed weights without applying | `node bin/skill-router.mjs tune --analyze` |
| `skill-router tune --apply` | Write `data/weights.json` after guardrail checks; snapshot first; benchmark before/after; auto-revert on > 1pp drop | `node bin/skill-router.mjs tune --apply --dry-run` |
| `skill-router tune --rollback` | Restore the latest snapshot from `logs/weights/` | `node bin/skill-router.mjs tune --rollback` |
| `skill-router tune --status` | Show current weights, last applied time, baseline accuracy, sample size | `node bin/skill-router.mjs tune --status` |
| `skill-router tune --auto` | Analyze + apply in one guarded step; `--dry-run` simulates; `--threshold N` sets the minimum outcome count (default 20) | `node bin/skill-router.mjs tune --auto --dry-run` |
| `skill-router tune --report` | Print the tuning history summary from `logs/tuning/decisions.jsonl` | `node bin/skill-router.mjs tune --report` |
| `skill-router feedback --outcomes` | Correlate decisions with signals and show outcome classes | `node bin/skill-router.mjs feedback --outcomes` |

Observed output excerpts (this session):

```
$ node bin/skill-router.mjs tune --status
  Current Weights: name 3, description 2, keywords 1
  Last Applied   : never
  Baseline Top-1 : 92.31%
  Baseline At    : 2026-09-24T13:00:00.000Z
  Attributions   : 130 outcomes (pos: 118, neg: 12)
  exit=0

$ node bin/skill-router.mjs tune --rollback
  No snapshots found in logs/weights/. Nothing to rollback.
  exit=1
```

---

## 6. Benchmark results — BM25 Top-1 before and after

### 6.1 Real corpus, 130 prompts

```
$ node tests/run-benchmark.mjs --mode bm25
```

| Metric | Before Phase 5 (`data/baseline.json:2-7`, frozen 2026-09-24T13:00:00Z) | After Phase 5 (measured here, 2026-09-24) | Delta |
|--------|------------------------------------------------------|------------------------------------------|-------|
| Top-1 accuracy | 0.9231 (120/130) | **0.9231 (120/130)** | none |
| Recall@3 | 0.8923 (116/130) | **0.8923 (116/130)** | none |
| Median latency | 3 ms | **3 ms** | none |
| P95 latency | 5 ms | **4 ms** | -1 ms (timing noise) |
| No-skill / fallback rate | 0.0846 (11/130) | **0.0846 (11/130)** | none |
| Cache hits / misses | — | 1 / 129 (hit rate 0.0077, size 130) | — |

**Top-1 before = 0.9231, after = 0.9231. No regression, no gain** — which is the
intended outcome: Phase 5 adds an adaptation path but deliberately changes no
weights (section 8).

Historical context from the entry log: the same benchmark reported 96.92% Top-1
before the router skills layer was added (`docs/current-state.md:24-25`), and
92.31% on the 60-skill index since router indexing
(`docs/current-state.md:21`). The 96.9% figure belongs to the 54-skill leaf-only
corpus and is not comparable to the current 60-entry index run.

### 6.2 Two-mode routing benchmark (re-run here)

```
$ node tests/two-mode-benchmark/runner.mjs --mode all
```

| Metric | Value |
|--------|-------|
| Mode Detection Accuracy (explicit) | 1.0000 (15/15) |
| Router Selection Accuracy (explicit) | 1.0000 (15/15) |
| Top-1 Accuracy (implicit) | 1.0000 (25/25) |
| Overall Success Rate | 1.0000 (40/40) |
| Latency explicit | p50 = 1 ms, p95 = 5 ms, max = 5 ms |
| Latency implicit | p50 = 3 ms, p95 = 4 ms, max = 4 ms |
| Latency overall | p50 = 3 ms, p95 = 4 ms, max = 5 ms |

Note: this runner **rewrites** `docs/reports/phase-3-two-mode-benchmark.md`. The
file was already listed as modified in `git status` at session start; after this
run it carries the 2026-09-24 results above.

### 6.3 Operational checks (re-run here)

| Command | Result | Exit code |
|---------|--------|-----------|
| `node bin/skill-router.mjs health` | 7 passed, 1 warning, 8 total. Warning: "llama-server not running on port 8080 (hybrid mode unavailable)". PASS items: plugin dir up to date, hook registered, index fresh (60 skills), 6 routers installed, hook invocable, no forbidden files, thresholds valid (high=0.85, medium=0.6) | 1 |
| `node bin/skill-router.mjs verify --deep` | **3 passed, 4 failed, 7 total.** FAIL: mirror sync status ("53 missing, 6 orphan(s)"), orphan mirror directories (the 6 routers), index up to date ("6 mismatch(es): router-* missing from corpus"), hook invocable ("hook output is not valid JSON: Unexpected end of JSON input"). PASS: meta files, thresholds, hook registered | 1 |
| `node bin/skill-router.mjs deploy --dry-run` | Routers to add 0, to update 0, unchanged 6; leaves to disable 0; "Deploy complete: 0 change(s) applied (dry-run)" | 0 |
| `node bin/skill-router.mjs doctor` | Reports thresholds 0.85/0.6, benchmark Top-1 90.0%, fallback 8.5%, 45 grid evaluations, 20446 ms optimization time, last sync 2026-09-24T10:37:27.850Z, 53 tracked skills. Mirror path points at a leftover temp dir: `tmp/install-test-home-1790246247165/home/.zcode/skills` | 0 |

The 4 `verify --deep` failures are environment/mirror state, not code defects:
the 6 `router-*` skills are deployed to the mirror but intentionally excluded from
the leaf corpus that `verify` diffs against. The same pattern was recorded in
`docs/current-state.md:16` ("verify CLI: 2/5 pass (mirror drift from
pre-router-state)").

---

## 7. Tuning system — how signals flow to weight updates

Intended pipeline (documented in `docs/ai-context.md:427-442` and
`docs/architecture.md`):

```
ZCode prompt
  -> hooks/route.mjs routes (explicit $mention or implicit BM25)
  -> src/telemetry/feedback.mjs  logDecision()   -> logs/routing-YYYYMMDD.jsonl
       (mode, router, tier, selectedSkills, latencyMs, confidence, SHA-256 promptHash)
  -> src/telemetry/session-tracker.mjs trackPrompt() detects patterns
  -> src/telemetry/signals.mjs  recordSignal()   -> logs/signals-YYYYMMDD.jsonl
       (retry | dismiss | rephrase | success | explicit_override; hash-linked, never raw prompt)
  -> src/telemetry/outcomes.mjs  correlate()     -> positive | negative | unknown
       retry <= 5m => negative; explicit_override <= 2m => negative;
       rephrase <= 5m => negative; no signal within 10m => positive;
       signals older than 10m => unknown
  -> src/core/retriever/attribution.mjs attributeOutcome()
       per-field BM25 score of the top-ranked skill -> dominantField
  -> src/core/retriever/weights.mjs computeWeights()
       positive => dominant field +5%, negative => -5%,
       clamp [0.5, 5.0], renormalise to keep the sum constant,
       require >= 20 attributions (MIN_OUTCOMES, weights.mjs:16)
  -> src/cli/tune-guard.mjs checkSafety() -> src/cli/tune-core.mjs
       snapshot -> logs/weights/, write data/weights.json, benchmark before/after,
       logs/tuning/decisions.jsonl, revert on > 1pp drop
  -> src/config/defaults.mjs loads data/weights.json (fallback: name 3 / desc 2 / kw 1)
```

What actually happened in this session:

- `logs/routing-20260924.jsonl` holds **549** decision records (first
  `2026-09-24T07:00:53.908Z`, last `2026-09-24T10:42:00.835Z`). The E2E
  hook-process suite contributes to this file when it runs.
- `logs/signals-20260924.jsonl` holds **201** signals (first
  `2026-09-24T10:00:00.000Z`, last `2026-09-24T10:42:00.837Z`): 142
  `explicit_override`, 58 `retry`, 1 `success`. These were produced by the test
  suites run in this session, not by human usage.
- `node bin/skill-router.mjs feedback --outcomes` reported: total decisions
  analysed 300 — positive 300, negative 0, unknown 0 (exit 0).
- `node bin/skill-router.mjs tune --analyze` reported: benchmark samples 127 —
  positive 118, negative 12, unknown 0; field attribution name 41, description
  85, keywords 1; proposed weights name 3.00 -> 2.71, description 2.00 -> 2.71,
  keywords 1.00 -> 0.57; `changed: yes`, `reason: applied` (exit 0).
- `tune --analyze` sources its attributions from the **benchmark dataset**, not
  from live logs: `src/cli/tune-core.mjs:195` calls `buildAttributions(130)`, and
  `buildAttributions` grades a prompt positive when the top-1 BM25 hit matches
  the expected route (`src/cli/tune-core.mjs:82-89`). The 12 negatives are
  benchmark misses, not user corrections.
- `tune --status` prints "Attributions: 130 outcomes (pos: 118, neg: 12)" while
  `--analyze` prints 127 samples — the two counters are produced by different code
  paths in `tune-core.mjs` and disagree; noted as a defect in section 9.
- `logs/weights/` does not exist and `logs/tuning/` is empty, so no weight has
  ever been applied or snapshotted in this repository.

---

## 8. Guardrail behavior — what happens when accuracy would drop

Two independent guards, both in `src/cli/tune-guard.mjs`:

1. **Static refusal (pre-benchmark).** `checkSafety()` (lines 55-111) refuses any
   proposal where a weight leaves `[0.5, 5.0]` (lines 70-75) or where
   `|proposed - baseline| > MAX_DELTA = 0.5` for any field (lines 18, 79-86).
   A heuristic predicted-accuracy model (lines 88-108) can also return `revert`
   when the predicted drop exceeds `ACCURACY_TOLERANCE = 1.0` percentage points (line 19).
2. **Empirical rollback (post-benchmark).** `evaluateOutcome(beforeTop1, afterTop1)`
   (lines 121-127) returns `reverted` when the measured post-change Top-1 is more
   than 1.0 pp below the pre-change Top-1; the previously snapshotted weights are
   restored. `tune --apply` is required to run the benchmark before and after
   (`docs/current-state.md:10`).

Observed behavior in this session — **both `apply` paths were refused**:

```
$ node bin/skill-router.mjs tune --auto --dry-run
  Threshold      : 20 outcomes
  Benchmark samples  : 127   positive 118 / negative 12 / unknown 0
  Proposed: name 3.00 -> 2.71, description 2.00 -> 2.71, keywords 1.00 -> 0.57
  Guardrail      : refuse — weight change for 'description' exceeds MAX_DELTA (0.715 > 0.5)
  No changes were applied (dry-run).
  exit=0

$ node bin/skill-router.mjs tune --apply --dry-run
  Current weights  : {"name":3,"description":2,"keywords":1}
  Proposed weights : {"name":2.7149321266968323,"description":2.7149321266968323,"keywords":0.5701357466063348}
  Attributions     : 127 (pos: 118, neg: 12)
  Guardrail        : refuse — weight change for 'description' exceeds MAX_DELTA (0.715 > 0.5)
  -> Changes would be blocked by guardrail in live mode.
  exit=0
```

Consequence: the guardrail is doing its job on today's data. The proposal moves
the description weight by 0.715, above the 0.5 ceiling, so no change is applied,
`data/weights.json` stays `{name:3, description:2, keywords:1}`, and BM25 Top-1
stays at 0.9231. The post-benchmark auto-rollback path could **not** be exercised
live today because no proposal ever got past the static guard; it is covered only
by `tests/cli/tune-guard.test.mjs` (19 assertions, all passing).

---

## 9. Known limitations and defects observed

1. **Live signals never reach `feedback --outcomes`.** `src/cli/feedback.mjs:93`
   calls `correlateFromLogs(decisions)` with no `logDir`; `readSignalFiles()`
   (`src/telemetry/outcomes.mjs:132-155`) then swallows the `readdir(undefined)`
   error and returns an empty array, so every decision is classified `positive`.
   Measured: CLI reported 300 positive / 0 negative / 0 unknown, while calling the
   same function with `{ logDir: 'logs' }` on the same 300 decisions returned
   **196 positive / 99 negative / 5 unknown** (reasons: "explicit override within
   2 minutes", "signals older than 10 minutes"). This is a live defect; it was not
   fixed here because this task is reporting-only.
2. **No real corrective-feedback data.** The 201 signals in
   `logs/signals-20260924.jsonl` were generated by test suites in this session, not
   by users. The adaptation path has never been exercised against genuine
   retry/dismiss behaviour.
3. **`tune --analyze` ignores live signals.** Attributions come from the benchmark
   dataset (`src/cli/tune-core.mjs:195`), so the "feedback loop" currently closes
   over benchmark labels, not user corrections.
4. **Inconsistent attribution counters.** `tune --status` reports 130 outcomes
   (118/12) while `tune --analyze` reports 127 samples (118/12); the three
   unattributed samples are dropped in the analyze path.
5. **One failing assertion** in `tests/tuning/optimizer.test.mjs`
   (`top1 0.8615 >= 0.89`) — pre-existing threshold drift, documented in the
   Phase 2 and Phase 3 reports.
6. **`verify --deep` fails 4 of 7 checks** against the current mirror (53 missing,
   6 orphans, 6 index mismatches, hook output not valid JSON); `health` returns
   exit code 1 solely because `llama-server` is not running on port 8080.
7. **`doctor` shows a stale mirror path** from an install test
   (`tmp/install-test-home-1790246247165/home/.zcode/skills`, last sync
   2026-09-24T10:37:27.850Z), so its sync-state section is not meaningful.
8. **No weight change has ever been applied**, so the post-benchmark rollback
   path, the snapshot store (`logs/weights/`) and the tuning history
   (`logs/tuning/decisions.jsonl`) are unproven in production use.
9. **Synthetic scale results remain unrepresentative**: accuracy falls from 85%
   at N=50 to ~39% at N=500 on synthetic prompts, an artefact of lexical poverty
   in generated skill names (`docs/current-state.md:23`); real-corpus
   scalability beyond 60 skills is unverified.
10. **Hybrid retrieval still underperforms BM25** (~55-57% vs 92.31% Top-1) and
    the FNV-1a embedding engine is unchanged — the core weakness Phase 6 targets.
11. **No log rotation or disk-space monitoring** for the new
    `logs/routing-*.jsonl`, `logs/signals-*.jsonl` and `logs/session-*.json` files.
12. **Nothing is committed or pushed.** `git status --short` at session start and
    after the verification run is identical: 23 modified files and 24 untracked
    paths (including the new modules, `data/baseline.json`, `data/weights.json`,
    `docs/tuning.md`, and this report), per AGENTS.md "Leave Changes Uncommitted".

---

## 10. Recommendation for future phases

1. **Fix the `logDir` defect in `src/cli/feedback.mjs:93` before the next
   release.** Until it is fixed, `feedback --outcomes` cannot observe real user
   corrections and every decision looks positive — the loop is closed over
   synthetic labels.
2. **Wire live signals into `tune --analyze`.** Merge `correlateFromLogs` output
   with benchmark-derived attributions so the proposed weights respond to actual
   retry/dismiss behaviour, and reconcile the 130-vs-127 sample counters.
3. **Re-baseline the optimizer test.** Either lower the `>= 0.89` assertion in
   `tests/tuning/optimizer.test.mjs` to match the optimizer's actual corpus
   (86.15%), or re-point the optimizer at the leaf-only index so the test and the
   92.31% hook benchmark measure the same thing.
4. **Unblock the mirror checks.** Reconcile the 6 `router-*` entries in
   `verify`'s corpus diff (53 missing / 6 orphans) and clean the leftover install
   test path that `doctor` reports, so `verify --deep` can return 7/7.
5. **Accumulate 2-4 weeks of genuine usage** (`HANDOFF.md:93-123`) before the
   first real `tune --apply`; then watch `logs/tuning/decisions.jsonl` for
   `accepted` vs `reverted` outcomes. Do not raise `MAX_DELTA` to force today's
   0.715 description delta through — the refusal is the intended safety behaviour.
6. **Then proceed to Phase 6** (`docs/implementation-plan.md:45`): replace the
   FNV-1a n-gram embeddings with a pre-trained local model (ONNX transformer,
   e.g. all-MiniLM-L6-v2) and benchmark hybrid against the frozen 92.31% BM25
   baseline. Note this adds a runtime dependency and a model file, which
   conflicts with the current "no external dependencies" constraint in
   `docs/ai-context.md:612` — that trade-off needs an explicit decision.
7. **Phase 7 prerequisites**: add log rotation/disk monitoring for the new log
   families, and re-run the full 52-suite verification before tagging.

---

## 11. Commands executed in this reporting session

```
# Pre-flight reads
read docs/ai-context.md, docs/implementation-plan.md, docs/current-state.md
read .zcode/workflow-drafts/phase-5-adaptation-loop.dwf.ts, HANDOFF.md, CHANGELOG.md, docs/reports/phase-4-final-report.md

# Corpus
find-walk of SKILL.md under data/skills and router-skills           -> 54 + 6 = 60
read data/skill-index.json                                           -> 60 docs, {"project":60}, 6 router-*
read data/baseline.json, data/weights.json

# Tests (each file run as its own process, exit code captured)
for f in $(find tests -name "*.test.mjs" | sort); do node "$f"; done  -> 46 files, 1299 passed, 1 failed
node tests/hook-edge-cases.mjs                                        -> 17 passed, 0 failed
node tests/e2e/full-pipeline.mjs                                      -> 80 passed, 0 failed
node tests/e2e/idempotency.mjs                                        -> 27 passed, 0 failed
node tests/e2e/orphan-cleanup.mjs                                     -> 50 passed, 0 failed
node tests/e2e/hook-process.mjs                                       -> 144 passed, 0 failed
node tests/e2e/full-loop.mjs                                          -> 33 passed, 0 failed

# CLI + benchmarks
node bin/skill-router.mjs health                                     -> 7 pass / 1 warn, exit 1
node bin/skill-router.mjs verify --deep                              -> 3 pass / 4 fail, exit 1
node bin/skill-router.mjs deploy --dry-run                            -> 0 changes, exit 0
node bin/skill-router.mjs doctor                                      -> exit 0
node bin/skill-router.mjs feedback --outcomes                         -> 300 positive / 0 negative / 0 unknown, exit 0
node bin/skill-router.mjs tune --status                               -> exit 0
node bin/skill-router.mjs tune --analyze                              -> exit 0
node bin/skill-router.mjs tune --auto --dry-run                       -> guardrail refuse, exit 0
node bin/skill-router.mjs tune --apply --dry-run                      -> guardrail refuse, exit 0
node bin/skill-router.mjs tune --report                               -> "No tuning decisions logged yet.", exit 0
node bin/skill-router.mjs tune --rollback                             -> "No snapshots found", exit 1
node tests/run-benchmark.mjs --mode bm25                              -> Top-1 0.9231, Recall@3 0.8923, p50 3 ms, p95 4 ms
node tests/two-mode-benchmark/runner.mjs --mode all                   -> 40/40 overall, p50 3 ms

# Defect reproduction
node --input-type=module -e "correlateFromLogs(d) vs correlateFromLogs(d,{logDir:'logs'})"
                                                                 -> {positive:300} vs {positive:196,negative:99,unknown:5}

git status --short, git log --oneline -30
```

**Not run in this session:** `npm test` / `npm run benchmark` (AGENTS.md records
that npm is not on the subprocess PATH on this machine; every script was invoked
with `node <file>` instead), any live ZCode UI test, and any `git commit` or
`git push`.
