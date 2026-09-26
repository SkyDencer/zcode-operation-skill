# Phase 6 Final Report — The Foundation

- **Date:** 2026-09-26, revised the same day from independent reader feedback. Every change is logged in
  `docs/reports/phase-6-report-corrections.md`.
- **Scope:** Sub-Phases 6.1 – 6.12 (Parts A – D of the Phase 6 mission)
- **Commits:** 44 Phase 6 commits, `f799d99`..`6ca4a82` — **155 files, +18,673/−767** (`git diff
  --shortstat f799d99 6ca4a82`). Four documentation-only commits landed after that (`78d33d0`, `7d9a722`,
  `f6d7377`, `10c910b`), taking the range to **156 files, +19,264/−823** at `10c910b`. Two pushes: the
  first in Sub-Phase 6.3 (`84317a6`), the final push in Sub-Phase 6.12, after which `HEAD` and
  `origin/main` are both `10c910b`.

## 1. Status

**Complete.** All twelve sub-phases are committed. The Sub-Phase 6.12 verification run passed: the
`package.json` test chain — 73 entries, 1 benchmark plus 72 test files — reported 0 failures, and
`health`, `verify --deep`, `feedback --outcomes`, `tune --status` and both real-corpus benchmarks all
exited 0. This reporting pass did not re-run the chain; §6 gives every figure with its provenance.

**On the four commits after that run:** all four are documentation, and one edits this report's own §6.
`git diff --stat 6ca4a82..HEAD -- src hooks bin tests scripts data router-skills .zcode-plugin` is
**empty**, so no source, test, fixture or manifest changed after the verification run and its result still
describes the shipping tree. The chain itself was **not** re-run — an open gap, not a cleared one.

**Provenance rule.** Every benchmark number in §5 was re-measured in this pass (§7 lists the commands);
everything else names the sub-phase that measured it.

The headline result is a **negative** one, recorded deliberately: the ONNX embedding provider did **not**
beat plain BM25 on this corpus, so the default provider stays FNV-1a and the semantic RRF weight stays
`0.0`. The provider is implemented, benchmarked, and available behind
`SKILL_ROUTER_EMBEDDING_PROVIDER=onnx`.

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

Four Critical findings from the 6.4 audit, each with a regression test verified to fail before the fix.
Full text in `docs/reports/phase-6-static-audit.md`.

| # | Defect | Why it mattered | Test |
|---|--------|-----------------|------|
| C1 | Fractional BM25 field weights went into `Array(n * w)` / `String.repeat(w)` | Any fractional value in `data/weights.json` raised `RangeError`; the hook caught it and exited 0 **without writing `output.json`**, so routing silently stopped | `tests/retriever/field-weight-safety.test.mjs` (19) |
| C2 | `require()` inside ESM modules | Broke `add` (empty domain registry, every valid skill rejected) and `doctor` (the mirror always reported non-writable) | `tests/cli/esm-require.test.mjs` (5) |
| C3 | Path traversal, import/add path | The destination directory was built from the untrusted frontmatter `name`, so `backend-../../../../pwned` passed `validateSkill()` and wrote `SKILL.md` outside `data/skills`; `hasTraversal()` could not fire because it ran on an already-`resolve()`d path, never on the name | `tests/security/path-traversal.test.mjs` (20) |
| C4 | Path traversal, disable/sync path | `entry.path` from `.skill-router-disabled.json` joined onto the mirror root unchecked: shadow mode wrote outside it, mirror mode `rmSync`-ed a sibling | `tests/security/cli-path-traversal.test.mjs` (10) |

C3 and C4 reproduced **19 failing assertions before the fix and 0 after**, adding **30 new assertions**,
both files including legitimate-name cases that prove the guards are not over-broad. Both were fixed with
`isSafeName()` / `isWithinRoot()` in `src/utils/fs.mjs` plus a containment re-check before every write.

From Part C, two further defects were found by execution rather than review: the FNV-1a fallback was
unreachable (`createProvider('onnx')` does not throw; `embed()` does, so the hook exited 0 with **no
output.json at all**), and the hook did not `await hybridRetrieve()`. The review pass then found the
default path had **no relevance floor** (Top-1 0.4846 against the 0.9231 BM25 baseline) and that
`extractFeatures` returns a Promise for an async provider which the reranker read synchronously — a silent
no-op under ONNX. Tests: `tests/hooks/embedding-provider-fallback.test.mjs` (26),
`tests/retriever/relevance-floor.test.mjs` (19), `tests/reranker/async-provider.test.mjs` (23).

## 4. Part B — Audit findings

The three reports are the primary artefacts; the summaries are pointers.

- **Static code audit (6.4)** — `docs/reports/phase-6-static-audit.md`. Three read-only passes over the 82
  `src/` modules plus `hooks/` and `bin/`, merged with a verification pass that re-read every cited file
  and re-ran every quoted check. **4 Critical (C1–C4, all fixed in this phase) and 19 High open**
  (`P6-H-001`–`P6-H-019`), plus 20 Medium and 48 Low. Three High items are silent destructive failures:
  `P6-H-014`, `P6-H-015`, `P6-H-016`.
- **Documentation audit (6.5)** — `docs/reports/phase-6-doc-audit.md`. 46 hand-written documents against
  the code, in two passes: 8 issues, then **20 code-to-doc mismatches and 10 stale examples**, opening
  `P6-H-020`–`P6-H-025`. Notable: no subcommand implements `--help`, and `deploy --help` is destructive
  because hook registration defaults to on; the documented "inverted index" schema did not exist; the
  subcommand count was stated as 20 in four places and is **18**. Final state: 33 links, 0 broken.
- **Test coverage audit (6.6)** — `docs/reports/phase-6-test-audit.md`. A static import map over the test
  suite, cross-checked against a runtime load graph built with a temporary `--experimental-loader` hook.
  **80 of 86 modules reachable by at least one test (93.0%); 6 unreachable**; 214 exported symbols, 90
  (42.1%) imported by a test. Determinism: 61 targets × 3 runs = 183 runs, 4884 assertions, **0 failures,
  0 non-deterministic**. It also found three defects in the coverage tooling itself, all fixed in 6.6.
  **Its denominators are 6.5/6.6 figures, not shipping-tree figures** — see §6; 93.0% is a true statement
  about a suite 30 files and 8 modules smaller than the one shipping.

## 5. Part C — Embedding benchmark and the default-provider decision

**What was built.** A provider abstraction (`createProvider`) with two implementations: `Fnv1aProvider`,
which delegates to the Phase 1 engine and so produces byte-identical 256-dim output, and `OnnxProvider`,
which runs `Xenova/all-MiniLM-L6-v2` through `@huggingface/transformers` 4.3.0 for 384-dim mean-pooled,
L2-normalised vectors. Selection is by `SKILL_ROUTER_EMBEDDING_PROVIDER` or `hooks/build-index.mjs
--provider`; ONNX is opt-in. `hooks/route.mjs` resolves it through a fail-open resolver that probes
availability on the filesystem without loading a model, falls back to FNV-1a with a stderr warning, and
degrades to pure BM25 when nothing is usable.

**The decision rule was fixed before measuring:** switch to ONNX only if it improves Set Recall by more
than 5 percentage points over FNV-1a **and** latency stays under 100 ms. Full report:
`docs/reports/phase-6-embedding-benchmark.md`. Numbers below re-measured in this pass (§7), 130-prompt
corpus, 60-entry index.

**Read the rule with its third comparison in view.** The rule has two clauses and ONNX **passes the
accuracy clause** (+5.18 pp against a 5 pp bar); on those two clauses alone it says switch. What decided
against shipping is a comparison the rule does not contain: Set Recall@5 0.9052 is a **regression against
the incumbent BM25 configuration's 1.0000**. BM25 is what ships, so BM25 is the baseline the rule should
have named. A revision should compare a candidate against the incumbent, not the weakest alternative.

| Mode | Top-1 | Recall@3 | Set Recall@5 (116 skill prompts) | Median | P95 |
|------|-------|----------|----------------------------------|--------|-----|
| Flat (BM25), shipped | 0.9231 (120/130) | 0.8923 (116/130) | 1.0000 (116) | 5 ms | 6.6 ms |
| Hybrid, FNV-1a, shipped weights | 0.9231 (120/130) | 0.8923 (116/130) | 1.0000 (116) | 3 ms | 4.0 ms |
| Hybrid, ONNX, shipped weights | 0.9231 (120/130) | 0.8923 (116/130) | 1.0000 (116) | 3 ms | 4.0 ms |
| Hybrid, FNV-1a, semantic on | 0.1846 (24/130) | 0.6077 (79/130) | 0.8534 (99) | 33 ms | 42 ms |
| Hybrid, ONNX, semantic on | 0.7615 (99/130) | 0.7769 (101/130) | 0.9052 (105) | 1212 ms | 1462 ms |

The first three rows are identical because with `semantic = 0.0` `hybridRetrieve()` returns before a
provider is ever constructed (`src/core/retriever/hybrid.mjs:137`) — the providers are not in the path,
not measured as equal. The last two rows are the real comparison (weights 0.4/0.6).

**Decision: the default provider stays FNV-1a and the semantic weight stays `0.0`.** Recorded as **D28**
in `docs/decision-dictionary.md`, and in `src/config/defaults.mjs` (with the measurement table),
`README.md` and `docs/embeddings.md`.

ONNX beats FNV-1a by **+5.18 pp Set Recall@5** (0.9052 vs 0.8534) and misses the latency budget by an
order of magnitude: **1212 ms median** against 100 ms, and about six times `hook.timeoutMs` (200,
`src/config/defaults.mjs:153`). That 200 ms is the **internal race timer**, not ZCode's budget for the
hook: the hook is registered with `"timeoutMs": 3500` at `hooks/hooks.json:12`, so a 1212 ms median would
fit inside 3500 ms. The guard is real — `hooks/route.mjs:196-201` races `hybridRetrieve()` against
`setTimeout(..., timeoutMs)` and `:203-205` degrades to `rankSkills()` on catch — and it is *why* a slow
ONNX prompt costs accuracy rather than stalling the hook. Both semantic-on configurations are also **worse
than the pure-BM25 configuration that ships** (1.0000); the 6.9 weight sweep found the semantic signal a
net negative at every weight and with both providers. Promoting ONNX would trade a working default for a
regression, plus 591 MB of packages and a 122 MB model cache.

**The 591 MB is not opt-in.** `package.json` declares `dependencies: {"@huggingface/transformers":
"^4.3.0"}`, with no `devDependencies` and no `optionalDependencies`, so every consumer pays the install
whether or not ONNX is ever selected. "Opt-in" describes the *provider*, not the dependency.

**Cost, measured in 6.10:** ONNX cold embed 469 ms (model load), warm 5.92 ms median, `buildIndex(60)`
1407 ms; FNV-1a 0.470 ms cold, 0.079 ms warm, `buildIndex(60)` 51.0 ms. Disk: `node_modules` 591 MB
(`onnxruntime-node` 288, `onnxruntime-web` 141, `@huggingface` 135) plus a 122 MB model cache, of which 35
MB is a stale partial download — the earlier "~254 MB total" estimate was wrong by 337 MB. The stale file
is
`node_modules/@huggingface/transformers/.cache/Xenova/all-MiniLM-L6-v2/onnx/model.onnx.tmp.11568.v47mjq`
(36,658,315 bytes, 2026-09-25 23:15); it is untracked by git and **safe to delete** — the live
`model.onnx` is a separate file. The retriever rebuilds all 60 vectors per prompt, which is where ONNX
spends its 1.2 s; caching them is the lever if the decision is revisited. The negative answer is the
**corpus**, not the model: 60 short, keyword-rich manifests over a fixed technology vocabulary give BM25
almost nothing to lose, and 116 of 130 prompts name concepts the manifests also name.

**Regression evidence from 6.10** (not re-measured here): two-mode routing 40/40, 100% mode detection /
router selection / implicit Top-1, p50 2 ms; SLM `--mode hybrid` 30 prompts Top-1 0.4667, Set Recall
0.7000, p50 3 ms.

## 6. Part D — Test count, coverage, and what they do not prove

**Test chain.** 73 entries in `package.json`'s `test` script — 1 benchmark plus 72 test files (`test:cli`
11, `test:e2e` 5). It held 43 steps at Sub-Phase 6.2, so **30 test files were added during the phase and
none removed**. The Sub-Phase 6.12 verification run reported **0 failures across all 73 steps**. A
concurrent 6.12 reporting pass re-ran the chain step by step, each as its own `node <file>` process, and
summed **2024 assertions**; recorded in `HANDOFF.md` and `docs/current-state.md`, not independently
verified here.

**Two other assertion figures exist and neither is the chain's.** The earlier one, **1746 assertions
across 60 files**, is the Sub-Phase 6.6 *coverage* run, and 60 is the number of test files that run's own
file list resolved to — not a chain length. Quote **2024** for the 73-step chain and **1746** only when
naming the 6.6 artefact.

**Coverage.** **80 of 86 modules are reachable by at least one test (93.0%)** — the test audit's own
figure (§4), measured on the 6.5/6.6 tree. Six are unreachable: `src/logger.mjs`,
`src/analytics/reporter.mjs` and `src/cli/{analytics,benchmark,remove,sources}.mjs`. Three denominators
are in play and **none is current**: 86 is the count of *modules a test could reach* at 6.5; 91 is the
count of *modules the instrumented runner observed loading*; and `find src hooks bin -name "*.mjs"` now
returns **94**, so 8 modules sit outside both historical figures. The audit's "61 test files" is likewise
6.5/6.6: the tree now holds **75 `.test.mjs` files** behind the 72-file chain, with **9** still registered
to no script.

The only coverage report in the tree is `logs/coverage-2026-09-25.json` (`generatedAt`
2026-09-25T19:17:51Z), written by the 6.6 run: **mean line 87.55%, branch 68.70%, function 83.23%**, 91
modules tracked, 23 at 100% line coverage. **That run was not green:** the same file records
`testFilesRun: 60` and **`testFilesFailed: 2`** — `tests/embeddings/provider.test.mjs` (2 assertions) and
`tests/hybrid-provider.test.mjs` (1), both failing standalone without instrumentation
(`docs/current-state.md:22`). The percentages are therefore *understated* and the 1746 total **excludes
those two files**. It is a snapshot of the tree at 6.6, not at 6.12; the 6.12 pass left no report artifact
and used a different invocation of `tests/run-coverage.mjs`, so its output cannot be cited.
**Line/branch/function coverage was not re-measured in this pass** and should be before that figure is
quoted again, together with the 9 unregistered test files.

**No Phase 0–5 bug lacks a regression test.** Audit items 7–9 are covered; items 10–13 (open Phase 4–5
defects) carry tests labelled `CHARACTERISATION ... Invert this assertion when the defect is fixed`, so a
suite cannot be green by asserting behaviour the code does not have.

## 7. Commands run for this report

```
node tests/run-benchmark.mjs --corpus real --router flat
node tests/run-benchmark.mjs --corpus real --router hybrid
node tests/run-benchmark.mjs --corpus real --router hybrid --provider fnv1a
node tests/run-benchmark.mjs --corpus real --router hybrid --provider onnx
```

All four exited 0; the last two were run with `SKILL_ROUTER_RRF_BM25_WEIGHT=0.4
SKILL_ROUTER_RRF_SEMANTIC_WEIGHT=0.6` set, and **the first two must be run with those two variables
unset** — that is the whole reason rows 1–3 of the §5 table are identical. The ONNX run reproduced 6.10's
accuracies exactly (0.7615 / 0.9052); only the timings differ (1212 ms median here against 1445 ms and 947
ms in 6.10's two runs), consistent with those runs' own finding that the ranking is deterministic and the
timings move with load. The flat run's median was 5 ms here against 3 ms in 6.10's measurement. **Not run
in this pass:** the full test chain and `node tests/run-coverage.mjs` (both excluded by the reporting ask;
the run script gates on them), the two-mode and SLM benchmark runners (their 6.10 numbers are quoted in §5
and labelled), and `git push`.

## 8. Known limitations

1. **27 open findings** in `docs/problems.md`: 21 High, 6 Medium (`P6-H-001`–`P6-H-027`, contiguous),
   including the raw-prompt privacy invariant (`P6-H-003`, which contradicts `docs/ai-context.md`), the
   three silent destructive failures (`P6-H-014`, `P6-H-015`, `P6-H-016`), and `P6-H-027` (a
   runner-generated report that reintroduces a personal path after 6.3). **"Should I ship this?" is
   answered in `docs/reports/phase-6-finding-triage.md`**, which sorts all 27 into release-blocking,
   ship-with-caveat and defer.
2. **The semantic path is inert by default.** The semantic RRF weight is `0.0`, so the ONNX provider is
   implemented, benchmarked and opt-in but never constructed on the default path — proven capability and a
   reproducible benchmark, not a shipped improvement.
3. **The reranker weights do not generalise** (`P6-H-026`): held-out R² −4.58 against in-sample 0.079, and
   `--rerank on` scores 102/130 against 120/130 with it off. `data/reranker-weights.json` was deliberately
   not regenerated. This is a weak training signal, not a result.
4. **The benchmark ranks 60 index entries; the hook searches 54 leaves.** Top-1 0.9231 is 120/130, so the
   BM25 configuration has **10** Top-1 misses, not seven — "four of the seven" is an error inherited from
   `docs/reports/phase-6-embedding-benchmark.md:170` and `docs/current-state.md:13`, neither of which
   reconciles it. Four of the ten are a `router-*` winning the top slot (`router-next` ×2,
   `router-laravel`, `router-test`), consistent with the leaf result: 10 − 4 = 6 leaf misses, and the leaf
   run scores 126/130. `data/baseline.json` `corpora` records only `indexSize` and `top1` for the leaf
   corpus — **the leaf Set Recall@5 is not in that file**. The harness gap itself is unfixed.
5. **`deploy --help` deploys** (`P6-H-020`) and rewrites `~/.zcode/cli/config.json`. A safety defect, not
   a documentation one.
6. **The live `feedback --outcomes` count is a function of the clock** (`P6-H-025`): every documented
   reading (0/0/300, 293/0/7, 196/99/5) describes one instant. The proof that the 6.1 `logDir` fix works
   is the fixed-clock replay in `tests/telemetry/outcomes.test.mjs` section 8, not the CLI number.
7. **`health` exit codes changed inside 6.12.** Through `780cc19` it exited 1 on a clean tree because the
   optional SLM was not running (7 passed, 1 warning); `6ca4a82` scopes that check by `slm.enabled`, so it
   now reports 8 passed and exits 0.
8. **The ONNX cost figures are machine-specific** (this Windows host), and no live ZCode test has run
   since Phase 0.5b — the disable mechanism is still a best guess. On the timeout: the semantic branch
   **is** guarded, by `Promise.race` against `hook.timeoutMs` at `hooks/route.mjs:196-201` with a BM25
   fallback at `:203-205`. An earlier draft of this report called it unguarded; that was wrong. The real
   residual is that the guard degrades to *lower accuracy* rather than failing, and that its 200 ms budget
   is the race timer, not the 3500 ms ZCode grants the hook.
9. **Files over the 300-line cap**, all pre-existing and flagged rather than split: `src/cli/health.mjs`
   (463 lines), `hooks/route.mjs` (393), `src/sync/disabler.mjs` (301), `src/deploy/writer.mjs` (502) —
   the last was previously mislisted as a document — and, among the documents, `docs/cli-reference.md`
   (711 lines). Counts are `wc -l` as of this revision.
10. **The adaptation loop has still never run against real user data** — every signal on disk is
    test-generated and ages past the 10-minute stale window, which is why `feedback --outcomes`
    legitimately reports zero negatives.

## 9. Recommendation for Phase 7

Phase 7 should be **hardening and corpus truth**, not new retrieval capability. In priority order:

1. **Close the three silent destructive failures** — `P6-H-014`, `P6-H-015`, `P6-H-016`. Each turns one
   unreadable directory into a mass deletion or a wholesale misclassification, and each has a
   characterisation test ready to be inverted.
2. **Make the two corpora one.** Either the benchmark ranks the 54-leaf index the hook actually searches,
   or it declares the 60-entry gap as a measured constant. Right now the frozen baseline guards a corpus
   production never uses.
3. **Decide the reranker's fate** (`P6-H-026`): retrain on the held-out split, or disable the stage by
   default. Shipping weights that lose 18 prompts is worse than shipping no reranker.
4. **Settle the hook shortlist policy** — `P6-H-001` together with the E2E expectations it contradicts —
   and stop persisting raw prompts and prompt prefixes (`P6-H-003`).
5. **Make `--help` real** (`P6-H-020`) and close the smaller CLI gaps: no `~` expansion (`P6-H-021`),
   ignored `tune --json` (`P6-H-022`).
6. **Make `getConfig()` the single config source** (`P6-H-007`, `P6-H-011`, `P6-H-017`), fix the Windows
   snapshot paths (`P6-H-005`), and delete the dead module `src/logger.mjs` (`P6-H-019`) — which retires
   **one** of the six unreachable modules. `src/retriever.mjs` (`P6-H-018`) is a separate job: the audit
   lists it as *covered* (by subprocess) and `src/analytics/analyzer.mjs:18` imports it, so deleting it
   changes the analytics CLI's scorer; it does not shrink the unreachable set.
7. **Re-measure coverage** from scratch, including the 9 test files still registered to no script, and
   replace the 6.6 snapshot in §6 — which came from a run with 2 failing files, against a 91-module
   denominator, in a tree that now holds 94 modules. Re-run the embedding decision against a paraphrase
   test set only if the corpus grows enough for BM25 to have something to lose; do not re-litigate the
   provider choice on the current corpus, where the measurement is unambiguous.
8. **Make the ONNX dependency genuinely optional** — move `@huggingface/transformers` to
   `optionalDependencies` behind a lazy `import()`, so "opt-in" describes the install and not only the
   provider (§5).

Do **not** raise `MAX_DELTA` to make tuning apply. The 6.11 refusal (a proposed description weight of
+0.715 against a 0.5 per-field cap) is the guardrail working. Adapting before real corrective signals
exist would be fitting noise.

**Next: Phase 7 — Hardening and Corpus Truth.**
