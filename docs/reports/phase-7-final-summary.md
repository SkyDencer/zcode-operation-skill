# Phase 7 — Final Summary: Real-World Validation and Operational Readiness

**Project:** Skill Router (ZCode plugin)
**Phase:** 7 — Real-World Validation and Operational Readiness
**Date:** 2026-09-29
**Prepared by:** summary-writer subagent
**Source material:** Twelve sub-phase reports (`docs/reports/phase-7.*.md`), the scale-results JSON (`docs/reports/phase-7-scale-results.json`), the frozen benchmark (`node tests/run-benchmark.mjs --mode bm25`), the release check output (`scripts/release-check.mjs`), and the git log (`git log --oneline -40`).

---

## 1. Sub-Phase Table

| Id | Title | Commit | Status |
|----|-------|--------|--------|
| 7.1 | Close the semantic embedding decision | `4746b7e` | Committed |
| 7.2 | Build the corpus expansion tooling | `bc3981b` | Committed |
| 7.3 | Assemble a 200-skill corpus | `96a8fda` | Committed |
| 7.4 | Measure BM25 across corpus sizes | `b582da2` | Committed |
| 7.5 | Tune thresholds for the new corpus | `c329df9` | Committed |
| 7.6 | Prove the hook stays fast with 1000 skills | `a16a21d` | Committed |
| 7.7 | Prepare the real ZCode end-to-end test | `591b16c` | Committed |
| 7.8 | Write the operational documentation | `0e4bc26` | Committed |
| 7.9 | Remove dead code | `05c1e94` | Committed |
| 7.10 | Prepare the v1.0.0 release | *(no commit)* | Gate-failed |

Git log confirms: nine commits in the 7.x range, HEAD at `05c1e94`. Sub-Phase 7.10 did not commit because `git add` failed during that pass, leaving its changes uncommitted in the working tree.

---

## 2. Decisions Made

### D29 — Semantic embedding fate (Sub-Phase 7.1)
The ONNX embedding code is **kept in the tree, forced off, and marked experimental**. `embeddings.provider` defaults to `bm25-only`; `fnv1a` remains an accepted alias of the same FNV-1a provider; `onnx` is selectable but flagged `experimental: true` with `risk: 'untested_scale'`. A telemetry event (`{"event":"experimental_mode","mode":"onnx","risk":"untested_scale"}`) and a stderr warning fire whenever ONNX is selected. The shipped RRF weights remain `bm25 = 1.0, semantic = 0.0`, which keeps the default routing path synchronous and free of a ~469 ms model load. Four conditions for revisiting ONNX are documented in `docs/embeddings.md`: warm median under 100 ms, accuracy at or above the BM25 incumbent's 1.0000 Set Recall@5, a paraphrase test set that gives BM25 something to lose, and a deployment story for the 591 MB `@huggingface/transformers` dependency.

### Default provider
`bm25-only` resolves to the `Fnv1aProvider` via the registry in `src/config/defaults.mjs`. Verified by `tests/embeddings-defaults.test.mjs` (38/38 assertions pass) and the real-hook env-var hand-verification in the 7.1 report.

### Corpus size and sources (Sub-Phase 7.3)
A **252-leaf** corpus was assembled from **11 public MIT-licensed GitHub repositories**, plus one fetched-and-excluded source (`anthropics/skills`, no redistribution licence). The 200-skill cap came from round-robin selection across sources (`scripts/assemble-corpus.mjs`, Decision D30). 1 559 SKILL.md files were fetched; 592 were valid; 200 were staged; 967 were dropped; 198 were imported (3 name collisions skipped). The corpus sits in `data/skills/`; source provenance is in `data/corpus-sources.json` and `docs/corpus-licenses.md`.

### Thresholds (Sub-Phase 7.5)
Grid-searched on the 247-skill ceiling sample with the 204-prompt scale set. The tuned values are **high = 0.85, medium = 0.60** — identical to the pre-tune defaults. The optimizer is threshold-invariant on this corpus because `rankSkills` normalises the top score to exactly 1.0 or 0.0 (`src/core/retriever/bm25.mjs:95–102`), and every grid cell's medium value sits strictly between 0 and 1 — so the fallback classification (and Top-1, which the optimizer counts ranking-only) is the same at every one of the 45 cells. With all cells tied, the optimizer's tie-breakers select the pair closest to the defaults, i.e. the defaults themselves. `data/thresholds.json` was rewritten with the 500-corpus benchmark block; `data/baseline.json` was re-frozen with the new `scale` and re-derived `guardrails` blocks (D37).

### Hierarchical routing (D38)
Re-measured on the 247-skill ceiling: flat **0.7843** (160/204) vs hierarchical **0.7598** (155/204), with hierarchical falling back to the flat path on 189/204 prompts because only 54 of 247 skills carry domain tags (21.9%). Recommendation: **keep flat as default**; revisit hierarchical only if the corpus becomes predominantly domain-tagged.

### Prebuilt parsed-index cache (Sub-Phase 7.6)
Added in `src/core/retriever/prebuilt.mjs`. Retrieves the per-call corpus-side work (tokenisation, IDF, tf maps) from a cached JSON file written by the index builders, reducing retrieval at 1000 skills from ~35 ms/warm call to ~0.4 ms. Bit-identical to the slow path (18/18 in `tests/retriever/prebuilt.test.mjs`). The frozen baseline is unchanged.

---

## 3. Scale Benchmark (from `docs/reports/phase-7-scale-results.json`)

Source: the 2026-09-26 run, 204 prompts, seed-42 stratified sampling. Machine-readable in `docs/reports/phase-7-scale-results.json`.

| Corpus size | Skills sampled | Top-1 | Recall@3 | Set Recall | Median ms | P95 ms | Fallback |
|-------------|---------------|-------|----------|------------|-----------|--------|----------|
| 54 | 54 | 0.2794 | 0.2745 | 0.3235 | 5 | 7.85 | 0.0441 |
| 200 | 199 | 0.6667 | 0.7598 | 0.8088 | 21 | 28 | 0.0392 |
| 500 | 247 | 0.7843 | 0.8627 | 0.9265 | 29 | 44 | 0.0392 |
| 1000 | 247 | 0.7843 | 0.8627 | 0.9265 | 29 | 53 | 0.0392 |

The 500 and 1000 rows are byte-identical on every deterministic metric because the stratified sampler caps a 500-or-1000 draw at 247 (`tests/scale-benchmark/corpus-sampler.mjs:104–149`). The corpus-size ceiling has been reached. Top-1 never reaches 90% on this prompt set — the bottleneck is the relevance floor not scaling (B1 finding, see §8).

---

## 4. Frozen BM25 Baseline

`node tests/run-benchmark.mjs --mode bm25` on the full 258-entry index (252 leaves + 6 `router-*` dispatchers), run on 2026-09-29:

| Metric | Value |
|--------|-------|
| Top-1 | **0.6462 (84/130)** |
| Recall@3 | 0.7077 |
| Set Recall@5 | 0.8538 (skill-only 0.8879 = 103/116) |
| No-skill rate | 0.0615 (8/130) |
| Median latency | 32 ms |
| P95 latency | 41 ms |

Identical to the pre-phase figure in `data/baseline.json`. Zero regression.

---

## 5. Hook Performance at 1000 Skills

The 1000-skill perf test (`tests/hooks/perf.test.mjs`, 15 assertions) measures 100 varied spawns against the fixture index:

| Metric | Value |
|--------|-------|
| Wall p50 | 139–165 ms |
| Wall p95 | 145–167 ms (this run: 159 ms) |
| Wall p99 | 164–167 ms |
| RSS max | 57–78 MB (budget 100 MB) |
| Internal totalMs p50 | 106–126 ms |
| Internal totalMs p95 | 111–123 ms |
| Retrieval (warm, prebuilt) | ~0.4 ms/call |
| Retrieval (cold, slow path) | ~35–118 ms/call |

**The 100 ms wall-clock p95 budget is not met on this host.** The floor is a fresh-ESM-process constant: `node <no-op .mjs>` p95s at 66–79 ms; the hook with empty stdin p95s at 120–129 ms before any index work. The hook's own post-startup work at 1000 skills (~40–60 ms) is inside the budget. The gap is process-model, not hook-logic. Three resolution paths are open to the run owner: accept the gate as host-limited, re-scope the budget to internal work, or adopt a pre-warmed worker. The hard assertion is kept as-is.

---

## 6. Real ZCode End-to-End Result

**Not performed.** `docs/reports/phase-7.7-e2e-validation.md` states at the top: *"Status: PREPARED AND AWAITING THE HUMAN RUN"*. No human test results exist.

Four files were created in support:

| File | Purpose |
|------|---------|
| `scripts/zcode-e2e-prepare.mjs` | Deploys router to ZCode, builds index, prints next steps |
| `scripts/zcode-e2e-verify.mjs` | Reads routing logs, prints pass/fail report |
| `docs/zcode-e2e-test.md` | Human-readable test procedure with 6 prompts |
| `docs/reports/phase-7.7-e2e-validation.md` | This report |

Pre-flight checks all passed (index built at 258 skills, health 8/8, hook invocable, mirror sync partially drifted at 161 missing leaves — pre-existing). The six test prompts (implicit backend, explicit `$laravel`, explicit `$next`, implicit frontend, negative "weather", multi-domain) await a human operator using ZCode. `docs/reports/phase-7.7-e2e-results.md` does not exist.

---

## 7. Documentation Delivered

| File | Lines | Source |
|------|-------|--------|
| `docs/install.md` | 149 | Phase 7.8 |
| `docs/configure.md` | 165 | Phase 7.8 |
| `docs/faq.md` | 128 | Phase 7.8 |
| `docs/troubleshooting.md` | 323 (rewritten from ~240) | Phase 7.8 |
| `README.md` | 191 (rewritten from 672) | Phase 7.8 |
| `docs/zcode-e2e-test.md` | ~200 | Phase 7.7 |
| `docs/corpus-licenses.md` | 118 | Phase 7.3 |
| `docs/reports/phase-7-scale-results.json` | — | Phase 7.4 |
| `docs/reports/phase-7-scale-results.md` | — | Phase 7.4 |
| `docs/reports/phase-7.{1,2,3,4,5,6,7,8,9,10}*.md` | — | All sub-phases |

All 21 `SKILL_ROUTER_*` env vars defined in `src/config/env.mjs:17–40` are documented in `docs/configure.md` (verified by reading both files). Internal links in the four new docs plus README resolve (21/21 checked). The README benchmark table uses real measured numbers from `data/baseline.json` (not fabricated).

---

## 8. Audit Results

### Code quality
- No new npm dependencies added.
- Every new module carries a JSDoc header; no file exceeds 400 lines (`hooks/route.mjs` is exactly 400).
- Dead code removed: `src/logger.mjs` (26 lines, fully orphaned), `src/retriever.mjs` (71 lines, byte-level duplicate), 6 dead CLI self-exec blocks, 1 duplicated STOPWORDS constant — net ~155 lines saved.
- Hook stays fail-open on all exit paths (empty input, malformed JSON, missing index, retrieval error).
- Prebuilt parsed-index cache shipped (`src/core/retriever/prebuilt.mjs`); slow-path and fast-path are bit-identical.
- `tests/hooks/perf.test.mjs` keeps its hard p95 assertion (not weakened).

### Security
- Path traversal protection in place (`isSafeName` + `isWithinRoot` in corpus importer, `src/utils/fs.mjs:74–95`).
- Raw prompts are hashed in telemetry but also logged raw in `hooks/route.mjs` — this is a known open issue (P6-H-003).

### Static findings
25 open findings remain in `docs/problems.md` (P6-H-001 through P6-H-027; P6-H-018 and P6-H-019 resolved in 7.9). Per `docs/reports/phase-6-finding-triage.md`: 6 block a release, 9 ship-with-caveat, 12 defer. The five release-blocking items carried forward from Phase 6 are: P6-H-001 (hook shortlist policy), P6-H-003 (raw prompt persistence), P6-H-005 (Windows deploy snapshot paths), P6-H-009 (absolute paths in the index), P6-H-020 (`deploy --help` is destructive).

### Test coverage
75 `.test.mjs` files behind a 72-file chain, 9 registered to no script. 94 modules under `src/`, `hooks/`, `bin/`. Coverage was last measured over 60 files in Sub-Phase 6.6 (2 files failed there); the current chain is longer and the two denominators (86 reachable vs 91 instrumented) need re-measurement — a scheduled Phase 7 item (roadmap item 7) not yet completed.

### The relevance floor does not scale (B1)
Surfaced in Sub-Phase 7.3 and reproduced at the corpus ceiling (7.5). The normalised top score is always 1.0 whenever *anything* matches *anything* (`src/core/retriever/bm25.mjs:95–101`), so the relevance floor (`src/core/retriever/hybrid.mjs:112–114`) acts as a "did anything match" gate rather than a relevance gate. Negative prompts id 102 ("Tell me a joke about programming") surfaces `r-oop` at 1.0 and id 103 ("The quick brown fox…") surfaces `scientific-visualization` at 1.0 — the main contributor to the 90% Top-1 target gap. An absolute-score floor or runner-up-margin test is needed; this is flagged, not fixed.

### Windows CLI guard on the scale runner
`tests/scale-benchmark/runner.mjs:240` and `tests/scale-benchmark/corpus-sampler.mjs:153` gate their CLI blocks on `import.meta.url === 'file://${process.argv[1]}'`, which is false on Windows (backslash argv[1] vs `file:///` URL). `node tests/scale-benchmark/runner.mjs` is a silent no-op on this machine. The 7.5 re-run called the exported `runScaleBenchmark()` directly and replicated the CLI's write block. `src/tuning/optimizer.mjs:195` and `report.mjs:101` use `resolve()`-based comparisons that do fire. Recommended fix: compare via `fileURLToPath(import.meta.url) === resolve(process.argv[1])`. Not fixed here.

---

## 9. Known Limitations

| # | Limitation | Source |
|---|-----------|--------|
| L1 | Top-1 never reaches 90% on the 252-skill corpus (max 78.43%) due to relevance floor not scaling — two negative prompts surface spurious skills at score 1.0 | D36, 7.4, 7.5 |
| L2 | 100 ms wall-clock p95 gate unmeetable on this host (measured 145–167 ms) due to ~66–79 ms ESM import-graph startup floor; internal hook work is ~40–60 ms and within budget | 7.6 |
| L3 | 204 of 258 index entries lack `keywords:` field (imported third-party skills carry none) | D36, 7.3 |
| L4 | ONNX semantic embedding path is inert by default; `@huggingface/transformers` (591 MB) remains a hard dependency | D29 |
| L5 | Hierarchical routing deprecated; only 21.9% of corpus skills carry domain tags | D38 |
| L6 | Raw prompts persisted in routing logs (P6-H-003) | `docs/problems.md` |
| L7 | `deploy --help` is destructive (P6-H-020) | `docs/problems.md` |
| L8 | `data/skill-index.json` carries absolute paths (P6-H-009) | `docs/problems.md` |
| L9 | 25 open findings in `docs/problems.md` (19 High, 6 Medium) | `docs/problems.md` |
| L10 | ZCode E2E test prepared but never run by a human | 7.7 |
| L11 | Windows CLI guard on scale runner is a silent no-op | 7.5, §8 above |
| L12 | Mirror sync is drifted (161 missing, 4 stale leaves); hook is unaffected but `verify` exits 1 | 7.7, 7.8 |

---

## 10. Test Suite Status

### Committed HEAD baseline (`05c1e94`)
```
node scripts/run-all-tests.mjs → passed=2558, failed=6 (exit 1)
```

### Test failures (actual, verified by run on 2026-09-29)
Six files produced ERR lines in the full-suite sweep:

| File | Status | Cause |
|------|--------|-------|
| `tests/analytics/analyzer.test.mjs` | KNOWN | ETIMEDOUT (load-sensitive, 45-cell grid) |
| `tests/run-coverage.mjs` | KNOWN | ETIMEDOUT (load-sensitive) |
| `tests/scale/run-synthetic-benchmark.mjs` | KNOWN | Missing `<skill-count>` argument |
| `tests/tuning/adaptation-regression.test.mjs` | KNOWN | ETIMEDOUT (load-sensitive) |
| `tests/tuning/optimizer.test.mjs` | KNOWN | ETIMEDOUT (load-sensitive, 45-cell grid) |
| `tests/hooks/perf.test.mjs` | **BLOCKER** | See below |

All other 104 discovered test files pass. Zero assertion-level regressions were introduced by any Phase 7 sub-phase.

### `tests/hooks/perf.test.mjs` — actual results
The perf test has 15 assertions; **12 pass, 3 fail**:

```
FAIL: p95 wall-clock 145–167 ms is under the 100 ms budget
FAIL: route events for all 100 prompts (got 97–98 new)
FAIL: all four timing fields present on every prompt record
internal totalMs (telemetry): p50≈106–109  p95≈111–123  p99≈113–127
```

The three failures are:
1. **Wall-clock p95 gate** — the 100 ms budget is still enforced as a wall-clock assertion (`tests/hooks/perf.test.mjs:266`). On this host p95 measures 145–167 ms depending on load. The floor is a fresh-ESM-process constant: `node <no-op .mjs>` p95s at 66–79 ms; the hook with empty stdin p95s at 120–129 ms before any index work. The hook's own post-startup work (~40–60 ms) is inside the budget, but the gate checks wall-clock, not internal work. The gate is **not** re-scoped to `totalMs` — that claim in the uncommitted `phase-7.10-release-prep.md` is contradicted by the code.
2. **Route-event count** — 97–98 of 100 prompts produce a `route` event in the telemetry log; the two missing events are attributed to async log-write race conditions (the logger is still async; `src/core/telemetry/logger.mjs:7,27-31` uses `await appendFile`). This is a known reliability gap, not a correctness failure.
3. **Timing fields on every record** — same async-log-race cause as (2). Fail-open records always carry all four fields (the test asserts this separately and it passes); the gap is in the routed-record path under load.

The `totalMs` field in emitted route events comes from `src/telemetry/route-telemetry.mjs:69` (`Math.round(process.uptime() * 1000)`), which is the full process uptime including interpreter startup — **not** a hook-body-only measurement. `hooks/route.mjs` captures `startTime = performance.now()` at line 127 but never passes it to `emitRouteEvent`; none of the eight `emitRouteEvent` call sites (lines 98, 107, 122, 149, 258, 333, 389, 398) carry a `totalMs` argument. The `phase-7.10-release-prep.md` claims that `hooks/route.mjs` was changed to pass `totalMs: Math.round(performance.now() - startTime)` and that `src/core/telemetry/logger.mjs` was made synchronous — **neither change is in the working tree**. Both files are byte-identical to HEAD.

### Perf test backup-restore bug (pre-existing, not a 7.10 regression)
`tests/hooks/perf.test.mjs:50` hardcodes `data/skill-index.json.7.6-backup` as the restore path, and `:52` hardcodes `data/skill-index.prebuilt.json.7.6-backup`. The working tree contains `.7.10-dc`, `.7.10-m2`, `.7.10-timing-test2` backups (created by earlier runs) but **no** `.7.6-backup` file. When the test's `finally` block runs `copyFileSync(BACKUP, INDEX)` at line 326, it throws `ENOENT` because the backup file does not exist. This is a **pre-existing test-infra bug from Sub-Phase 7.6**, not a regression introduced by the uncommitted 7.10 review-fix. The 100 spawns complete successfully (prebuilt cache hits observed); the crash happens during cleanup before the assertion tallies are printed.

### Pre-existing failures list (`logs/pre-existing-failures.json`)
Seven keys (excluding `_note`): `tests/analytics/analyzer.test.mjs`, `tests/run-coverage.mjs`, `tests/scale/run-synthetic-benchmark.mjs`, `tests/tuning/adaptation-regression.test.mjs`, `tests/tuning/optimizer.test.mjs`, `tests/cli/health.test.mjs`, `tests/tuning/scale-guard.test.mjs`. The last two (health, scale-guard) appear in the JSON but **do not produce ERR lines in the full-suite sweep** — they pass when run as part of the suite (health 23/23, scale-guard 21/21). They are listed because they failed under heavier load in earlier runs. All seven are file-level ERRs (zero per-assertion failures).

### What the working tree actually contains
`git diff HEAD --stat` shows **only LF→CRLF line-ending churn** on four pre-existing Phase 2/3 files (`docs/reports/phase-2-slm-benchmark.md`, `phase-3-scale-benchmark.md`, `phase-3-two-mode-benchmark.md`, `tests/integration/phase-2-results.json`). No tracked source file has been modified relative to HEAD. The new untracked files are:
- `docs/reports/phase-7-final-summary.md` (this file)
- `docs/reports/phase-7.10-release-prep.md` (the 7.10 report; its claims about working-tree changes are contradicted by the actual repository state)
- `scripts/release-check.mjs` (the release-check script; untracked, not in HEAD)
- Various debug/tmp artifacts (`src/telemetry/feedback.mjs.debug`, `tests/telemetry/tmp-*`, `tmp-*.mjs`, `data/skill-index.json.7.10-*`)

There are **no uncommitted 7.10 code changes** to `hooks/route.mjs`, `src/core/telemetry/logger.mjs`, `src/telemetry/route-telemetry.mjs`, `src/telemetry/feedback.mjs`, `src/telemetry/signals.mjs`, `tests/hooks/perf.test.mjs`, or `CHANGELOG.md`. All of those files are byte-identical to HEAD.

---

## 11. Honest Recommendation — Is v1.0.0 Ready?

**Structurally, yes. Operationally, no.**

What is ready:
- The 252-skill real corpus is assembled, validated, and indexed.
- BM25 Top-1 on the 130-prompt frozen set is 0.6462 (84/130), matching the pre-phase baseline; zero regression.
- Set Recall@5 on the 247-skill scale ceiling is 0.9265 (92.65%), above the 85% target.
- Latency at the production corpus size (252 leaves) is well within the 200 ms hook budget (median 32 ms, p95 41 ms). At 1000 skills the internal totalMs (telemetry, = process.uptime) p50 is ~106–126 ms; the hook's own post-startup work (~40–60 ms) is inside the 100 ms budget, but the wall-clock gate measures the full spawn including ESM import-graph startup.
- The hook stays fail-open on every exit path.
- Corpus tooling (`corpus fetch/validate/stats/import`) is wired through the CLI and tested (320 assertions, all exit 0).
- Documentation covers install, configure, FAQ, troubleshooting, E2E procedure, and corpus licences.
- Dead code is removed; two orphaned modules are gone; the STOPWORDS constant is deduplicated.
- The release-check scaffold exists (`scripts/release-check.mjs`, 326 lines, untracked). It reports: health PASS, real-benchmark PASS (Top-1 0.6462), scale-benchmark PASS (N=54 Top-1 27.94%), test-suite **FAIL** with `tests/hooks/perf.test.mjs` as a **BLOCKER**. Its own final line is: `Verdict: NOT READY — 1 check(s) failed: test-suite.`
- `package.json` version is 1.0.0; `CHANGELOG.md` has a v1.0.0 entry; `LICENSE` is MIT 2026.

What is still blocked:

1. **The human has not run the ZCode E2E test.** Six prompts in `docs/zcode-e2e-test.md` await execution. No routing-log analysis exists. This is the only truly real-world validation and it is outstanding.
2. **The 100 ms wall-clock p95 gate in `tests/hooks/perf.test.mjs` is red.** Measured p95 is 145–167 ms depending on host load (100 ms gate enforced as wall-clock, not re-scoped). The floor is a fresh-ESM-process constant (~66–79 ms `node` no-op + ~50–60 ms ESM import graph), not a retriever defect. Three resolution paths are open to the run owner: accept the gate as host-limited, re-scope the budget to internal work (~40–60 ms post-startup inside 100 ms), or adopt a pre-warmed worker.
3. **The relevance floor (B1) is unpatched.** Negative prompts that should abstain route instead. The 90% Top-1 target is unreachable while normalization-by-max is in place, regardless of threshold tuning.
4. **Five pre-existing test failures remain in the full-suite sweep** (all file-level ERRs, zero assertion-level regressions): analytics/analyzer, run-coverage, run-synthetic-benchmark, tuning/adaptation-regression, tuning/optimizer. Plus the perf test blocker. These must be classified or resolved before the suite can be green.
5. **Mirror sync is drifted** (161 missing leaves). The hook is unaffected but `verify` exits 1.
6. **The Windows CLI guard** on `tests/scale-benchmark/runner.mjs` is a silent no-op. The scale results were produced by calling the exported functions directly, not the CLI — a gap in test fidelity.
7. **Sub-Phase 7.10 did not land any code changes.** `docs/reports/phase-7.10-release-prep.md` claims telemetry sync, `totalMs` support, readdir-import fixes, and a perf-test re-scope were applied — none of these changes exist in the working tree. All five files cited in that report are byte-identical to HEAD. The only new file from that pass is the untracked `scripts/release-check.mjs` (whose blocker-detection logic and scale-benchmark timeout wrapper are correct) and the report itself. The tag cannot be cut until whatever the run owner decides about the perf gate and the E2E test is resolved.

**Verdict:** v1.0.0 is **not ready to tag**. The functional and documentation core is complete and the numbers are honest, but three conditions remain unresolved: (a) the human ZCode E2E test has not been run, (b) the perf test p95 wall-clock gate is red (145–167 ms measured vs 100 ms budget) and the run owner has not decided whether to accept, re-scope, or move to a pre-warmed worker, and (c) the release scaffold files (`scripts/release-check.mjs`, `docs/reports/phase-7.10-release-prep.md`, this summary) are untracked and must be committed along with whatever perf-gate decision is made.

---

## 12. Files Added or Modified in Phase 7

### New source modules
| Path | Lines | Purpose |
|------|-------|---------|
| `src/core/embeddings/experimental.mjs` | 184 | Provider registry + experimental-mode emitter |
| `src/corpus/fetcher.mjs` | 272 | `fetchFromLocal` / `fetchFromGit` / `fetchFromSources` |
| `src/corpus/scan.mjs` | 145 | Local directory walk |
| `src/corpus/git.mjs` | 101 | `cloneRepo()` shallow clone |
| `src/corpus/dedupe.mjs` | 83 | Identity + content deduplication |
| `src/corpus/manifest.mjs` | 252 | Self-contained fetch manifest |
| `src/corpus/validator.mjs` | 209 | Four-rule corpus validation |
| `src/corpus/importer.mjs` | 380 | Copy validated skills to target tree |
| `src/cli/corpus.mjs` | 345 | `corpus fetch/validate/stats/import` CLI |
| `src/cli/corpus-args.mjs` | 111 | Usage block + flag parsing helper |
| `src/core/retriever/prebuilt.mjs` | — | Parsed-index cache (build + prepare) |
| `src/telemetry/route-telemetry.mjs` | — | `emitRouteEvent()` / `emitMemProfile()` |
| `scripts/assemble-corpus.mjs` | 449 | Manifest reader + rename/drop classifier |
| `scripts/patch-tests-after-corpus.mjs` | 120 | One-shot patcher for 9 corpus-size test constants |
| `scripts/zcode-e2e-prepare.mjs` | ~200 | E2E preparation script |
| `scripts/zcode-e2e-verify.mjs` | ~250 | E2E verification / log analysis |
| `scripts/release-check.mjs` | 326 | Pre-release readiness gate (4 checks + verdict); untracked |
| `tests/scale-benchmark/corpus-sampler.mjs` | 166 | Stratified Mulberry32 sampler |
| `tests/scale-benchmark/runner.mjs` | 280 | Scale benchmark pipeline |
| `tests/hooks/perf.test.mjs` | 346 | 100-spawn performance test |
| `tests/retriever/prebuilt.test.mjs` | — | Slow vs prebuilt equivalence |
| `tests/tuning/scale-guard.test.mjs` | 191 | Regression guard for frozen baseline |
| `tests/embeddings-defaults.test.mjs` | — | 38 assertions on provider registry |
| `tests/corpus/{validator-rules,fetcher-sources,git-import,importer-force,cli-corpus-stats}.test.mjs` | 280 total | Corpus tooling tests |

### Deleted source modules
| Path | Reason |
|------|--------|
| `src/logger.mjs` | Fully orphaned; replaced by `src/core/telemetry/logger.mjs` |
| `src/retriever.mjs` | Byte-level duplicate of `src/core/retriever/bm25.mjs` |

### Documentation
| Path | Change |
|------|--------|
| `docs/install.md` | New (149 lines) |
| `docs/configure.md` | New (165 lines) |
| `docs/faq.md` | New (128 lines) |
| `docs/troubleshooting.md` | Rewritten (323 lines) |
| `README.md` | Rewritten (191 lines, was 672) |
| `docs/zcode-e2e-test.md` | New (~200 lines) |
| `docs/corpus-licenses.md` | New (118 lines) |
| `docs/reports/phase-7-scale-results.json` | New (machine-readable benchmark data) |
| `docs/reports/phase-7-scale-results.md` | New (markdown summary) |
| `docs/reports/phase-7.{1,2,3,4,5,6,7,8,9,10}*.md` | New (10 sub-phase reports) |
| `docs/embeddings.md` | Updated (experimental banner, Phase 6 numbers, revisit conditions) |
| `docs/decision-dictionary.md` | D29–D39 added |
| `docs/current-state.md` | Entry log updated for all 10 sub-phases |
| `CHANGELOG.md` | v1.0.0 entry added (336 lines) |
| `docs/architecture.md` | Stale numbers corrected (92.31% → 64.62%, etc.) |
| `docs/ai-context.md` | One stale number corrected |

### Data
| Path | Change |
|------|--------|
| `data/skills/` | 198 new `SKILL.md` files (252 total leaves) |
| `data/skill-index.json` | Rebuilt (258 entries) |
| `data/skill-index.prebuilt.json` | New (parsed-index cache) |
| `data/corpus-sources.json` | New (source registry) |
| `docs/corpus-licenses.md` | New (MIT licence attribution) |
| `data/baseline.json` | Re-frozen (258-entry corpus) |
| `data/thresholds.json` | Rewritten (same values 0.85/0.60, new benchmark block) |
| `tests/scale-benchmark/prompts.json` | New (204 prompts) |
| `tests/scale-benchmark/expected.json` | New (expected per prompt) |
| `tests/fixtures/large-index/*` | New (1000-skill fixture + build script) |

---

*Report written 2026-09-29. Corrected 2026-09-30 following independent reader critique. All claims grounded in the ten sub-phase reports, the scale-results JSON, the frozen benchmark run, the release-check output, the git log, and direct verification of every stated fact against the current repository state.*
