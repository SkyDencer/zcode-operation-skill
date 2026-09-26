# Phase 6 Final Report — The Foundation

- **Date:** 2026-09-26
- **Scope:** Sub-Phases 6.1 – 6.12 (Parts A – D of the Phase 6 mission)
- **Commits:** 44 Phase 6 commits, `f799d99`..`6ca4a82`, plus this report's commit — 158 files, +19,518/−774. Two pushes: the first in Sub-Phase 6.3 (`84317a6`) and the final push in Sub-Phase 6.12, after which local `HEAD` matches `origin/main`.

## 1. Status

**Complete.** All twelve sub-phases are committed. The Sub-Phase 6.12
verification run passed: the `package.json` test chain — 73 entries, 1 benchmark
plus 72 test files — reported 0 failures, and `health`, `verify --deep`,
`feedback --outcomes`, `tune --status` and both real-corpus benchmarks all
exited 0. This reporting pass did not re-run the chain; §6 gives the figures with
their provenance.

The headline result is a **negative** one, recorded deliberately: the ONNX
embedding provider did **not** beat plain BM25 on this corpus, so the default
provider stays FNV-1a and the semantic RRF weight stays `0.0`. The provider is
implemented, benchmarked, and available behind
`SKILL_ROUTER_EMBEDDING_PROVIDER=onnx`.

**Provenance rule.** Every benchmark number in §5 was re-measured in this pass (§7 lists the
commands); everything else names the sub-phase that measured it.

## 2. Summary of the twelve sub-phases

| # | Sub-phase | Outcome | Commits |
|---|-----------|---------|---------|
| 6.1 | Fix the two critical bugs | `feedback --outcomes` passed no `logDir` (fixed at `src/cli/feedback.mjs:97`, defaulted at `src/telemetry/outcomes.mjs:171`); the optimizer tuned the 60-entry index while the hook searches 54 leaves — leaf-only is now canonical | `f799d99`, `feb7270` |
| 6.2 | Logical commits for Phases 4/5 | Residual staged work split into auditable commits, carrying the C1/C2 fixes and the first static-audit report | `a0c1f7b` |
| 6.3 | Push to GitHub | Secret and personal-path scan; 27 occurrences redacted across ten files; **the first push happened here** | `01ccdd4`, `84317a6`, `ffb8424` |
| 6.4 | Static code audit + security remediation | 4 Critical fixed with regression tests, including **two arbitrary-file-write path traversals**; 19 High recorded as `P6-H-001`–`019` | `30a7968`, `2c3bb87`, `6eeabea`, `642357b` |
| 6.5 | Documentation consistency audit | 20 code-to-doc mismatches and 10 stale examples fixed; 33 links / 0 broken; subcommand count corrected 20 → 18; 6 new open items | `8b1fd50`, `f264a8e` |
| 6.6 | Test coverage audit + gap closing | 6 regression/edge-case suites (190 assertions); the coverage runner rewritten (basename keying and max-of-percentages aggregation both fixed) | `5224c2c`, `a013aee`, `a5d658c`, `b82b105`, `b113341` |
| 6.7 | Provider abstraction | `createProvider(type, options)` over a uniform interface; `Fnv1aProvider` delegates to the Phase 1 engine so output stays byte-identical; `OnnxProvider` stub; typed errors | `35e0913`, `8c54c3b`, `b772194` |
| 6.8 | ONNX provider | `@huggingface/transformers` 4.3.0 + `Xenova/all-MiniLM-L6-v2` (384-dim). Three defects found on re-verification: `downloadModel()` downloaded nothing (lazy pipeline), failures were not graceful, `options.cacheDir` was cosmetic | `0a1f9f0`, `54c766b`, `05117cd` |
| 6.9 | Hybrid retrieval rebuilt | Weighted RRF (k=60, math extracted to `src/core/retriever/rrf.mjs`), `embeddingSimilarity` reranker feature, runtime-configurable weights, fail-open provider fallback. A review pass then fixed two blocking findings: no relevance floor, and shipped weights that were the worst setting tested | `a1eb4cf`, `9056d9a`, `2906e04`, `f0b4ff1`, `23a7abc`, `73bc730`, `1784d47` |
| 6.10 | Embedding benchmark | `--router` / `--provider` implemented (both were parsed and ignored before) and Set Recall@5 added. **Decision: default stays FNV-1a** | `9f9ab49`, `8ed91a9`, `d231ebd` |
| 6.11 | Adaptation loop revalidated | Fixtures regenerated from the live default and drift-gated; `data/baseline.json` re-frozen with both corpora; the simulated tuning cycle was **correctly refused** by the guardrail | `80ee011`, `0b7e9dd` |
| 6.12 | Final verification + this report | Four failing checks fixed (disabled-registry name, deploy planner path, shadow-mode directory, `verify` orphan/hook checks) and a fifth (the `health` llama-server check warned in both branches) | `780cc19`, `1c24577`, `6ca4a82` |

## 3. Part A — Bug fixes

Four Critical findings from the 6.4 audit, each with a regression test verified to
fail before the fix:

1. **Fractional BM25 field weights crashed retrieval.** Field weights went into
   `Array(n * w)` / `String.repeat(w)`, so any fractional value in
   `data/weights.json` raised `RangeError: Invalid array length`; the hook caught it
   and exited 0 without writing `output.json`, so routing silently stopped. Test:
   `tests/retriever/field-weight-safety.test.mjs` (19).
2. **`require()` inside ESM modules** broke `add` (empty domain registry, so every
   valid skill was rejected) and `doctor` (the mirror always reported
   non-writable). Test: `tests/cli/esm-require.test.mjs` (5).
3. **Path traversal, import/add path (security).** The destination directory was
   built from the untrusted frontmatter `name`, so a skill named
   `backend-../../../../pwned` passed `validateSkill()` and wrote `SKILL.md`
   outside `data/skills`; the existing `hasTraversal()` guard could not fire
   because it ran on an already-`resolve()`d path and on `candidate.sourcePath`,
   never on the name. Fixed with `isSafeName()` / `isWithinRoot()` in
   `src/utils/fs.mjs` and a containment re-check before every write.
4. **Path traversal, disable/sync path (same class, independent instance).**
   `entry.path` from `.skill-router-disabled.json` was joined onto the mirror root
   unchecked: shadow mode wrote outside it, mirror mode `rmSync`-ed a sibling.

The two security regressions reproduced **19 failing assertions before the fix and
0 after**, adding **30 new assertions** in
`tests/security/path-traversal.test.mjs` (20) and
`tests/security/cli-path-traversal.test.mjs` (10), both including
legitimate-name cases that prove the guards are not over-broad.

From Part C, two further defects were found by execution rather than review: the
FNV-1a fallback was unreachable (`createProvider('onnx')` does not throw; `embed()`
does, so the hook exited 0 with **no output.json at all**), and the hook did not
`await hybridRetrieve()`. The review pass then found the default path had **no
relevance floor**, so every prompt received skill context (Top-1 0.4846 against
the 0.9231 BM25 baseline), and that `extractFeatures` returns a Promise for an
async provider which the reranker read synchronously — a silent no-op under ONNX.
Tests: `tests/hooks/embedding-provider-fallback.test.mjs` (26),
`tests/retriever/relevance-floor.test.mjs` (19) and
`tests/reranker/async-provider.test.mjs` (23).

## 4. Part B — Audit findings

The three reports are the primary artefacts; the summaries are pointers.

- **Static code audit (6.4)** — `docs/reports/phase-6-static-audit.md`. Three
  read-only passes over the 82 `src/` modules plus `hooks/` and `bin/`, merged
  with a verification pass that re-read every cited file and re-ran every quoted
  check. **4 Critical (C1–C4, all fixed in this phase) and 19 High items open**
  (`P6-H-001`–`P6-H-019`), plus 20 Medium and 48 Low. Three High items are
  silent destructive failures: `P6-H-014` (deploy rollback trusts a
  possibly-empty snapshot), `P6-H-015` (an unreadable project tree plans a mass
  removal) and `P6-H-016` (any non-`ENOENT` error turns the whole outcome corpus
  `positive`).
- **Documentation audit (6.5)** — `docs/reports/phase-6-doc-audit.md`. 46
  hand-written documents against the code, in two passes: pass one fixed 8 issues,
  pass two **20 code-to-doc mismatches and 10 stale examples**, opening
  `P6-H-020`–`P6-H-025`. Notable finds: no subcommand implements `--help`, and
  `deploy --help` is destructive because hook registration defaults to on; the
  documented "inverted index" schema did not exist; the subcommand count was
  stated as 20 in four places and is **18**. Final state: 33 links, 0 broken; all
  93 `.mjs` modules under `src/`, `hooks/`, `bin/` and `scripts/` documented.
- **Test coverage audit (6.6)** — `docs/reports/phase-6-test-audit.md`. A static
  import map over all 61 test files, cross-checked against a runtime load graph
  built with a temporary `--experimental-loader` hook. **80 of 86 modules
  reachable by at least one test (93.0%); 6 unreachable**; 214 exported symbols,
  90 (42.1%) imported by a test. Determinism: 61 targets × 3 runs = 183 runs,
  4884 assertions, **0 failures, 0 non-deterministic**. It also found three
  defects in the coverage tooling itself, all fixed in 6.6.

## 5. Part C — Embedding benchmark and the default-provider decision

**What was built.** A provider abstraction (`createProvider`) with two
implementations: `Fnv1aProvider`, which delegates to the Phase 1 engine and so
produces byte-identical 256-dim output, and `OnnxProvider`, which runs
`Xenova/all-MiniLM-L6-v2` through `@huggingface/transformers` 4.3.0 for 384-dim
mean-pooled, L2-normalised vectors. Selection is by
`SKILL_ROUTER_EMBEDDING_PROVIDER` or `hooks/build-index.mjs --provider`; ONNX is
opt-in. `hooks/route.mjs` resolves it through a fail-open resolver that probes
availability on the filesystem without loading a model, falls back to FNV-1a
with a stderr warning, and degrades to pure BM25 when nothing is usable.

**The decision rule was fixed before measuring:** switch to ONNX only if it
improves Set Recall by more than 5 percentage points over FNV-1a **and** latency
stays under 100 ms. Full report: `docs/reports/phase-6-embedding-benchmark.md`.
Numbers below re-measured in this pass (§7), 130-prompt corpus, 60-entry index.

| Mode | Top-1 | Recall@3 | Set Recall@5 (116 skill prompts) | Median | P95 |
|------|-------|----------|----------------------------------|--------|-----|
| Flat (BM25), shipped | 0.9231 (120/130) | 0.8923 (116/130) | 1.0000 (116) | 5 ms | 6.6 ms |
| Hybrid, FNV-1a, shipped weights | 0.9231 (120/130) | 0.8923 (116/130) | 1.0000 (116) | 3 ms | 4.0 ms |
| Hybrid, ONNX, shipped weights | 0.9231 (120/130) | 0.8923 (116/130) | 1.0000 (116) | 3 ms | 4.0 ms |
| Hybrid, FNV-1a, semantic on | 0.1846 (24/130) | 0.6077 (79/130) | 0.8534 (99) | 33 ms | 42 ms |
| Hybrid, ONNX, semantic on | 0.7615 (99/130) | 0.7769 (101/130) | 0.9052 (105) | 1212 ms | 1462 ms |

The first three rows are identical because with `semantic = 0.0`
`hybridRetrieve()` returns before a provider is ever constructed
(`src/core/retriever/hybrid.mjs:137`) — the providers are not in the path, not
measured as equal. The last two rows are the real comparison (weights 0.4/0.6).

**Decision: the default provider stays FNV-1a and the semantic weight stays `0.0`.**
Recorded as **D28** in `docs/decision-dictionary.md`, and in
`src/config/defaults.mjs` (with the measurement table), `README.md` and
`docs/embeddings.md`.

ONNX beats FNV-1a by **+5.18 pp Set Recall@5** (0.9052 vs 0.8534), clearing the
accuracy half of the rule by a thin margin, and fails the latency half by an
order of magnitude: **1212 ms median** against a 100 ms budget, and six times the
hook's own 200 ms `hook.timeoutMs`. Both semantic-on configurations are also
**worse than the pure-BM25 configuration that ships** (Set Recall@5 1.0000) — the
6.9 weight sweep found the semantic signal to be a net negative at every weight
and with both providers. Promoting ONNX would trade a working default for a
regression, plus 591 MB of packages and a 122 MB model cache.

**Cost, measured in 6.10:** ONNX cold embed 469 ms (model load), warm 5.92 ms
median, `buildIndex(60)` 1407 ms; FNV-1a 0.470 ms cold, 0.079 ms warm, `buildIndex(60)`
51.0 ms. Disk: `node_modules` 591 MB (`onnxruntime-node` 288, `onnxruntime-web` 141,
`@huggingface` 135) plus a 122 MB model cache, of which 35 MB is a stale partial
download — the earlier "~254 MB total" estimate was wrong by 337 MB. The retriever rebuilds all 60 vectors per prompt, which is where
ONNX spends its 1.2 s; caching them is the lever if the decision is revisited.

**The real reason the answer is negative is the corpus, not the model:** 60 short,
keyword-rich manifests over a fixed technology vocabulary give BM25 almost nothing
to lose, and 116 of 130 prompts name concepts the manifests also name.

**Regression evidence from 6.10** (not re-measured here): two-mode routing 40/40,
100% mode detection / router selection / implicit Top-1, p50 2 ms; SLM `--mode
hybrid` 30 prompts Top-1 0.4667, Set Recall 0.7000, p50 3 ms.

## 6. Part D — Test count, coverage, and what they do not prove

**Test chain.** 73 entries in `package.json`'s `test` script — 1 benchmark plus 72
test files (`test:cli` 11, `test:e2e` 5). It held 43 steps at Sub-Phase 6.2, so
**30 test files were added during the phase and none removed**.
The Sub-Phase 6.12 verification run reported **0 failures across all 73
steps**. A concurrent 6.12 reporting pass re-ran the chain step by step,
each as its own `node <file>` process, and summed **2024 assertions**; that pass's
figures are recorded in `HANDOFF.md` and `docs/current-state.md` and were not
independently verified here. The **1746 assertions across 60 files** figure below
is the Sub-Phase 6.6 coverage run, measured when the chain was 30 steps shorter.

**Coverage.** **80 of 86 modules are reachable by at least one test (93.0%)** —
the test audit's own figure (§4). Six are unreachable: `src/logger.mjs`,
`src/analytics/reporter.mjs` and
`src/cli/{analytics,benchmark,remove,sources}.mjs`. The two denominators in play
are different measurements and are not reconciled: 86 is the count of *modules a
test can reach*; 91 is the count of *modules the instrumented runner observed
loading*. The only coverage report in the tree is
`logs/coverage-2026-09-25.json` (`generatedAt` 2026-09-25T19:17:51Z), written by
the 6.6 run: **mean line 87.55%, branch 68.70%, function 83.23%**, 91 modules
tracked, 23 at 100% line coverage. It is a snapshot of the tree at 6.6, not at
6.12; the 6.12 pass left no report artifact and used a different invocation of
`tests/run-coverage.mjs`, so its output cannot be cited. **Line/branch/function
coverage was not re-measured in this pass** and should be before that figure is
quoted again, including the 13 test files the audit found registered to no
script.

**No Phase 0–5 bug lacks a regression test.** Audit items 7–9 are covered; items
10–13 (open Phase 4–5 defects) carry tests labelled `CHARACTERISATION ... Invert
this assertion when the defect is fixed`, so a suite cannot be green by asserting
behaviour the code does not have.

## 7. Commands run for this report

```
node tests/run-benchmark.mjs --corpus real --router flat
node tests/run-benchmark.mjs --corpus real --router hybrid
node tests/run-benchmark.mjs --corpus real --router hybrid --provider fnv1a
node tests/run-benchmark.mjs --corpus real --router hybrid --provider onnx
```

All four exited 0; the last two were run with
`SKILL_ROUTER_RRF_BM25_WEIGHT=0.4 SKILL_ROUTER_RRF_SEMANTIC_WEIGHT=0.6` set. The
ONNX run reproduced 6.10's accuracies exactly (0.7615 / 0.9052); only the timings
differ (1212 ms median here against 1445 ms and 947 ms in 6.10's two runs),
consistent with those runs' own finding that the ranking is deterministic and the
timings move with load. The flat run's median was 5 ms here against 3 ms in
6.10's measurement. **Not run in this pass:** the full test chain and
`node tests/run-coverage.mjs` (both excluded by the reporting ask; the run script
gates on them), the two-mode and SLM benchmark runners (their 6.10 numbers
are quoted in §5 and labelled), and `git push` (the run script pushes in 6.3 and
6.12).

## 8. Known limitations

1. **27 open findings** in `docs/problems.md`: 21 High, 6 Medium
   (`P6-H-001`–`P6-H-027`), including the raw-prompt privacy invariant
   (`P6-H-003`, which contradicts `docs/ai-context.md`), the three silent
   destructive failures (`P6-H-014`, `P6-H-015`, `P6-H-016`), and `P6-H-027`
   (a runner-generated report that reintroduces a personal path after 6.3).
2. **The semantic path is inert by default.** The semantic RRF weight is `0.0`, so
   the ONNX provider is implemented, benchmarked and opt-in but never constructed
   on the default path — proven capability and a reproducible benchmark, not a
   shipped improvement.
3. **The reranker weights do not generalise** (`P6-H-026`): held-out R² −4.58
   against in-sample 0.079, and `--rerank on` scores 102/130 against 120/130 with
   it off. `data/reranker-weights.json` was deliberately not regenerated. This is a
   weak training signal, not a result.
4. **The benchmark ranks 60 index entries; the hook searches 54 leaves.** Four of
   the seven BM25 Top-1 misses are a `router-*` winning the top slot. The same 130
   prompts against the 54-leaf corpus give Top-1 0.9692 (126/130) with Set Recall
   unchanged. Both numbers are recorded separately in `data/baseline.json`; the
   harness gap itself is unfixed.
5. **`deploy --help` deploys** (`P6-H-020`) and rewrites
   `~/.zcode/cli/config.json`. A safety defect, not a documentation one.
6. **The live `feedback --outcomes` count is a function of the clock**
   (`P6-H-025`): every documented reading (0/0/300, 293/0/7, 196/99/5) describes
   one instant. The proof that the 6.1 `logDir` fix works is the fixed-clock replay
   in `tests/telemetry/outcomes.test.mjs` section 8, not the CLI number.
7. **`health` exit codes changed inside 6.12.** Through `780cc19` it exited 1 on a
   clean tree because the optional SLM was not running (7 passed, 1 warning);
   `6ca4a82` scopes that check by `slm.enabled`, so it now reports 8 passed and
   exits 0.
8. **The ONNX cost figures are machine-specific** (this Windows host), the ONNX
   path has no timeout guard, and no live ZCode test has run since Phase 0.5b —
   the disable mechanism is still a best guess.
9. **Files over the 300-line cap**, all pre-existing and flagged rather than split:
   `src/cli/health.mjs` (463), `hooks/route.mjs` (393),
   `src/sync/disabler.mjs` (300), and nine documents (`docs/cli-reference.md` 707,
   `src/deploy/writer.mjs` 503, …).
10. **The adaptation loop has still never run against real user data** — every
    signal on disk is test-generated and ages past the 10-minute stale window,
    which is why `feedback --outcomes` legitimately reports zero negatives.

## 9. Recommendation for Phase 7

Phase 7 should be **hardening and corpus truth**, not new retrieval capability.
In priority order:

1. **Close the three silent destructive failures** — `P6-H-014`, `P6-H-015`,
   `P6-H-016`. Each turns one unreadable directory into a mass deletion or a
   wholesale misclassification, and each has a characterisation test ready to be
   inverted.
2. **Make the two corpora one.** Either the benchmark ranks the 54-leaf index the
   hook actually searches, or it declares the 60-entry gap as a measured constant.
   Right now the frozen baseline guards a corpus production never uses.
3. **Decide the reranker's fate** (`P6-H-026`): retrain on the held-out split, or
   disable the stage by default. Shipping weights that lose 18 prompts is worse
   than shipping no reranker.
4. **Settle the hook shortlist policy** — `P6-H-001` together with the E2E
   expectations it contradicts — and stop persisting raw prompts and prompt
   prefixes (`P6-H-003`).
5. **Make `--help` real** (`P6-H-020`) and close the smaller CLI gaps: no `~`
   expansion (`P6-H-021`), ignored `tune --json` (`P6-H-022`).
6. **Make `getConfig()` the single config source** (`P6-H-007`, `P6-H-011`,
   `P6-H-017`), fix the Windows snapshot paths (`P6-H-005`), and delete the dead
   modules `src/logger.mjs` and `src/retriever.mjs` (`P6-H-019`, `P6-H-018`) —
   which also retires two of the six unreachable modules.
7. **Re-measure coverage** from scratch, including the 13 test files the audit
   found unregistered, and replace the 6.6 snapshot in §6. Re-run the embedding
   decision against a paraphrase test set only if the corpus grows enough for
   BM25 to have something to lose; do not re-litigate the provider choice on the
   current corpus, where the measurement is unambiguous.

Do **not** raise `MAX_DELTA` to make tuning apply. The 6.11 refusal (a proposed
description weight of +0.715 against a 0.5 per-field cap) is the guardrail
working. Adapting before real corrective signals exist would be fitting noise.

**Next: Phase 7 — Hardening and Corpus Truth.**
