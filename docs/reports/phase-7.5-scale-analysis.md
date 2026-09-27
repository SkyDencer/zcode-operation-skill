# Phase 7.5 — Scale Analysis: Threshold Decision on the 252-Skill Corpus

**Date:** 2026-09-27
**Sub-phase:** Phase 7.5 (Real-World Validation and Operational Readiness)
**Agent:** impl-7-5
**Input:** `docs/reports/phase-7-scale-results.json` (the Sub-Phase 7.4 measured scale run, dated 2026-09-26)

---

## 1. Measured scale numbers (quoted from the JSON)

`docs/reports/phase-7-scale-results.json` records: `fullLeafCount: 252`,
`promptCount: 204`, `promptsPath: tests/scale-benchmark/prompts.json`,
`sizes: [54, 200, 500, 1000]`, one `bm25` mode, zero timeouts at every size.

| Size | Skills sampled | Top-1 | Recall@3 | Set Recall | Set Recall (skill) | Median ms | P95 ms | Fallback |
|------|---------------|-------|----------|-----------|--------------------|-----------|--------|----------|
| 54   | 54            | 0.2794 (27.94 %) | 0.2745 | 0.3235 | 0.2938 | 5  | 7.85 | 0.0441 |
| 200  | 199           | 0.6667 (66.67 %) | 0.7598 | 0.8088 | 0.8093 | 21 | 28   | 0.0392 |
| 500  | 247           | 0.7843 (78.43 %) | 0.8627 | 0.9265 | 0.9330 | 29 | 44   | 0.0392 |
| 1000 | 247           | 0.7843 (78.43 %) | 0.8627 | 0.9265 | 0.9330 | 29 | 53   | 0.0392 |

JSON excerpts (verbatim, `runs[]` entries):

- `{"size":54,"mode":"bm25","skillsSampled":54,"top1":0.2794,"recall3":0.2745,"setRecall":0.3235,"setRecallSkill":0.2938,"medianMs":5,"p95Ms":7.849999999999994,"fallbackRate":0.0441,"promptCount":204,"timeoutCount":0}`
- `{"size":200,"mode":"bm25","skillsSampled":199,"top1":0.6667,"recall3":0.7598,"setRecall":0.8088,"setRecallSkill":0.8093,"medianMs":21,"p95Ms":28,"fallbackRate":0.0392,...}`
- `{"size":500,"mode":"bm25","skillsSampled":247,"top1":0.7843,"recall3":0.8627,"setRecall":0.9265,"setRecallSkill":0.933,"medianMs":29,"p95Ms":44,"fallbackRate":0.0392,...}`
- `{"size":1000,"mode":"bm25","skillsSampled":247,"top1":0.7843,"recall3":0.8627,"setRecall":0.9265,"setRecallSkill":0.933,"medianMs":29,"p95Ms":53,"fallbackRate":0.0392,...}`

**The corpus-size ceiling has been reached.** The full leaf corpus is 252
skills; the stratified sampler (seed 42) caps a "500" or "1000" draw at 247
skills (stratum floors plus proportional allocation, then slice truncation —
`tests/scale-benchmark/corpus-sampler.mjs:104-149`). The 500 and 1000 rows
therefore measure the *same* 247-skill corpus: all deterministic metrics are
byte-identical, only latency differs (a timing re-measurement, not a
corpus difference). A true 500- or 1000-skill measurement is impossible on
this corpus — the ceiling, not a size, is what the top rows report.

## 2. Where each target is crossed (answers with evidence)

**At what corpus size does Top-1 drop below 90 %?** It is already below
90 % at the *smallest* measured size and never climbs back above it:
27.94 % at N=54, 66.67 % at N=200, 78.43 % at the 247-skill ceiling. The
trend on this prompt set is upward with corpus size (the 204 prompts name
skills that exist in the corpus, so a larger sample contains more of the
expected skills), not downward — "drop" does not apply; the honest statement
is that **no measured size reaches the 90 % Top-1 target, including the
corpus ceiling (78.43 %)**.

**At what corpus size does Set Recall drop below 85 %?** Below 85 % at
N=54 (32.35 %) and N=200 (80.88 %); at or above 85 % from N=500 onward
(92.65 % at the ceiling). So Set Recall only breaks the 85 % bar at the
200-skill row and below; **the 85 % target is met at the ceiling**.

**Latency.** Median 5 ms (N=54) -> 21 ms (N=200) -> 29 ms (ceiling); p95
7.85 -> 28 -> 44 ms. All well inside the 100 ms hook budget and the 5 000 ms
per-prompt timeout (zero timeouts at every size). Fallback stays flat at
~3.9-4.4 % across all sizes.

**Net reading.** The corpus-size ceiling *has* been reached (twice: the 500
and 1000 rows are the same 247-skill draw). At that ceiling, Set Recall is
healthy (92.65 %) but Top-1 is 78.43 % — an 11.57-point gap to the 90 %
target. That is a real result about this corpus and prompt mix, not a
measurement limit: 10 of the 204 prompts are expected to abstain (ids
101-110, `expected: null` in `tests/scale-benchmark/expected.json`), the
runner counts 3 of them as Top-1 hits (`null === null` at ids 105/106/107,
where the prompt tokenizes to nothing), and the skill-prompt-only Top-1 is
157/194 = 80.93 % — the distance to 90 % is the ranking quality on the
194 skill prompts, not a prompt-mix artifact.

## 3. Threshold decision — before/after numbers

The brief's trigger condition holds: **accuracy (Top-1 0.7843) is below
90 % at the 500-skill row**, so the existing optimizer was run against the
500-skill corpus.

Guardrails read before running, in `src/tuning/optimizer.mjs`:
- grid: `high` in [0.70, 0.95] step 0.05, `medium` in [0.40, 0.75] step 0.05,
  `medium < high` strictly (lines 17-25, 130-131);
- objective: maximize Top-1 subject to fallback rate < 15 % (line 136);
- tie-breakers: lower fallback, then closeness to the 0.85/0.60 defaults
  (lines 150-162).

Run (existing module, called against the 500-skill corpus = the 247-skill
seed-42 sample, with the 204 scale prompts + `tests/scale-benchmark/expected.json`):

```
optimizer: high=0.85 medium=0.6 top1=0.7843 fallback=0.0392 grid=45 elapsed=319942ms
```

**The tuned thresholds are high = 0.85, medium = 0.60 — identical to the
pre-tune values.** That is not a coincidence and it is the decision: on this
corpus the objective is *threshold-invariant*. `rankSkills` normalizes the
top score to 1.0 whenever anything matches and 0.0 when nothing does
(`src/core/retriever/bm25.mjs:95-102`), and every grid cell's medium value
sits strictly between 0 and 1 — so the fallback classification (and Top-1,
which the optimizer counts ranking-only) is the same at every one of the 45
cells. Verified directly: spot checks at (0.85, 0.60), (0.95, 0.40) and
(0.70, 0.75) all return Top-1 0.7843 and fallback 8/204. With all cells
tied, the optimizer's tie-breakers select the pair closest to the defaults,
i.e. the defaults themselves.

`data/thresholds.json` was written from that result (same schema the
optimizer CLI writes, `src/tuning/optimizer.mjs:219-231`); its `benchmark`
block now describes the 500-corpus tuning run (`top1` 0.7843,
`fallbackRate` 0.0392, `noSkill` 8/204) instead of the stale
130-prompt-corpus block. The *values* shipped by `src/config/defaults.mjs`
are unchanged.

**Re-run of the scale benchmark (before/after):** re-running
`runScaleBenchmark()` after writing the tuned thresholds gives, per size:

| Size | Top-1 before -> after | Recall@3 before -> after | Set Recall before -> after | Fallback before -> after | Median before -> after | P95 before -> after |
|------|----------------------|--------------------------|----------------------------|--------------------------|------------------------|---------------------|
| 54   | 0.2794 -> 0.2794     | 0.2745 -> 0.2745         | 0.3235 -> 0.3235           | 0.0441 -> 0.0441         | 5 -> 5                 | 7.85 -> 6           |
| 200  | 0.6667 -> 0.6667     | 0.7598 -> 0.7598         | 0.8088 -> 0.8088          | 0.0392 -> 0.0392         | 21 -> 21               | 28 -> 25            |
| 500  | 0.7843 -> 0.7843     | 0.8627 -> 0.8627         | 0.9265 -> 0.9265          | 0.0392 -> 0.0392         | 29 -> 31               | 44 -> 55.4          |
| 1000 | 0.7843 -> 0.7843     | 0.8627 -> 0.8627         | 0.9265 -> 0.9265          | 0.0392 -> 0.0392         | 29 -> 28               | 53 -> 32            |

**No deterministic metric moved.** That is the expected outcome, for two
independent reasons: (a) the runner grades ranking-based metrics
(Top-1/Recall@3/Set Recall) plus a fallback gate pinned to 0.60 in
`tests/scale-benchmark/runner.mjs:187`, so threshold changes are invisible
to it; and (b) the tuned values equal the previous ones. Only the latency
columns re-measured. `docs/reports/phase-7-scale-results.json` and `.md`
were rewritten by the re-run (deterministic metrics identical; the JSON
snapshot from before the re-run is preserved at `tmp/scale-results-before-7.5.json`
until tmp cleanup and is otherwise recoverable from git HEAD).

## 4. Hierarchical routing: measured assessment, no re-enablement

Measured on the 247-skill corpus with the 204 scale prompts
(`routeHierarchical` from `src/core/routing/hierarchical.mjs` vs
`rankSkills`):

| Mode | Top-1 | Domain-scoped prompts | Flat fallback path |
|------|-------|-----------------------|--------------------|
| flat BM25 | 0.7843 (160/204) | — | — |
| hierarchical | 0.7598 (155/204) | 15/204 | 189/204 (93 %) |

Hierarchical is **2.45 points worse** at the corpus ceiling, and it is
structurally handicapped here: only 54 of the 247 skills carry domain tags
(the 198 imported third-party skills have none), and the domain-scoped stage
(`src/core/routing/hierarchical.mjs:111-118`) can only surface skills
*inside* the matched domains — the 193 untagged skills are reachable solely
through the flat fallback path the router took on 189 of 204 prompts. Five
prompts that flat ranked correctly were missed by the hierarchical top slot.
This matches Phase 3's own benchmark (docs/reports/phase-3-scale-benchmark.md),
where flat was equal-or-better on Top-1 and strictly faster at every N=50-500,
and decision D24 (hierarchical deprecated as default).

**Recommendation: keep the flat default; do not re-enable hierarchical
routing.** No default was changed, per the brief's instruction — there is no
measured evidence supporting the change, and the one new measurement taken
in this sub-phase argues against it. Conditions under which it should be
revisited: the corpus becomes predominantly domain-tagged (today 21.9 %), or
domain metadata is auto-derived for the 198 untagged skills at index-build
time, and a re-measurement at this scale shows hierarchical beating flat by
more than the 1.0 pp tune-guard tolerance.

## 5. Frozen baseline for the new corpus (`data/baseline.json`)

`data/baseline.json` was re-frozen (per the brief) as the 258-entry-corpus
baseline. Guardrail thresholds are re-derived from it:

- `benchmark` (from a fresh `node tests/run-benchmark.mjs --mode bm25`,
  full 258-entry index, 130 prompts): **Top-1 0.6462 (84/130)**,
  Recall@3 0.7077, Set Recall@5 0.8538 all-prompts / 0.8879 skill-only
  (103/116), no-skill 0.0615, median 32 ms, p95 39.1 ms — the deterministic
  figures match the 7.3/7.4 records exactly.
- `thresholds`: high 0.85 / medium 0.60 — the tuned values this sub-phase
  wrote to `data/thresholds.json`.
- `scale`: the frozen scale-ceiling block — 247-skill sample (seed 42,
  target 500), 204 prompts, Top-1 0.7843 / Recall@3 0.8627 /
  Set Recall@5 0.9265 / fallback 0.0392, with a note that the 500 and 1000
  rows are the same corpus.
- `guardrails` (re-derived): `minTop1` 0.6462, `minScaleTop1` 0.7843,
  `minRecallAt3Scale` 0.8627, `minSetRecallScale` 0.9265,
  `maxFallbackRate` 0.15 (the optimizer's hard constraint,
  `src/tuning/optimizer.mjs:136`), `accuracyTolerancePp` 1.0 (tune-guard's
  tolerance, `src/cli/tune-guard.mjs:19`), and the optimizer's grid bounds
  pinned as `thresholdBounds` (high [0.70, 0.95], medium [0.40, 0.75]).

`src/cli/tune-guard.mjs:26-40` (`loadBaseline()`) reads
`benchmark.top1`/`weights`/`baselineAt` from this file, so the guardrail
floor the tune CLI enforces is now the new corpus's 0.6462, not the stale
60-entry 0.9231. The superseded 0.9231/0.9692 figures remain on record in
the `docs/current-state.md` entry log (rows 6.11, 7.1-7.4).

## 6. Regression guard: `tests/tuning/scale-guard.test.mjs`

New test (191 lines, JSDoc header, no new dependency) asserting the tuned
thresholds do not regress below the new baseline:

1. **Files agree:** thresholds.json parses; high/medium numeric, medium <
   high; both equal `baseline.thresholds`.
2. **Guardrail bounds:** thresholds sit inside the pinned grid bounds; the
   tuned run's fallback (0.0392) is under `maxFallbackRate` 0.15.
3. **Scale ceiling:** re-measures the 247-skill sample x 204 prompts with
   the same loop as `tests/scale-benchmark/runner.mjs:159-197` and floors
   Top-1 / Recall@3 / Set Recall@5 at `baseline.scale` (0.7843 / 0.8627 /
   0.9265) and `baseline.guardrails`; fallback under the shipped medium
   threshold (0.60) stays under 0.15.
4. **Frozen benchmark:** re-measures the 130-prompt BM25 Top-1 on the full
   index with the *exact* counting rule of `tests/run-benchmark.mjs:173`
   (a negative prompt counts as a hit when the router abstains — the 5
   zero-scored negative prompts ids 121/124/128/129/130 are decided by that
   clause; a strict name-only count reads 0.6077 instead of the frozen
   0.6462) and floors it at `baseline.guardrails.minTop1`.

The test deliberately does *not* re-run the 45-cell optimizer grid (~5.3
minutes; it would exceed the suite's 120 s per-file budget and add no new
decision given the documented threshold invariance) — it verifies the
*outcome* of the tuning run instead. Measured in this sub-phase:
**`node tests/tuning/scale-guard.test.mjs` -> 21 passed, 0 failed, exit 0,
~15 s.**

## 7. Execution-side findings (defects found while doing this sub-phase)

1. **The scale runner's CLI guard is a silent no-op on Windows.**
   `tests/scale-benchmark/runner.mjs:240` and
   `tests/scale-benchmark/corpus-sampler.mjs:153` gate their CLI blocks on
   `import.meta.url === 'file://${process.argv[1]}'`. On Windows
   `process.argv[1]` carries backslashes while `import.meta.url` is a
   forward-slash `file:///` URL, so the comparison is false and
   `node tests/scale-benchmark/runner.mjs` prints nothing, writes nothing,
   and exits 0. Verified in this sub-phase: the invocation produced no
   output and `cmp` showed the JSON report byte-identical to the pre-run
   snapshot. The 7.4 JSON was therefore not produced by that literal
   command on this machine; the 7.5 re-run called the exported
   `runScaleBenchmark()` and replicated the CLI's write block. `src/tuning/optimizer.mjs:195`
   and `report.mjs:101` use a `resolve()`-based comparison that *does*
   fire. Recommended fix: compare via `fileURLToPath(import.meta.url) ===
   resolve(process.argv[1])`. Not fixed here (out of this sub-phase's
   scope; flagged).
2. **The 500/1000 rows are one measurement.** Both sample the identical
   247-skill set; the row pair's latency difference is noise. Future scale
   work should add size points *beyond* the corpus (which requires a larger
   corpus; the 390 valid-but-excluded skills from 7.3 are reproducible from
   the recorded commits).
3. **Two negative prompts surface skills at the ceiling.** Of the 10
   null-expected prompts at N=500: ids 105/106/107 (empty or
   untokenizable) abstain correctly; 101/104/108/109/110 score 0 and fall
   back; but id 102 ("Tell me a joke about programming") surfaces
   `r-oop` at 1.0 and id 103 ("The quick brown fox jumps over the lazy
   dog") surfaces `scientific-visualization` at 1.0. This is the 7.3
   headline finding (relevance floor does not scale — the normalized top
   score is 1.0 whenever anything matches) reproducing on the new corpus,
   and it is the main accuracy loss the 90 % Top-1 target cannot reach
   while normalization-by-max is in place.
4. **Suite timing flake.** `tests/routing.test.mjs` timed out (120 s
   per-file budget) in the pre-change run and passed in the post-change
   run; the ETIMEDOUT set is load-sensitive. The failing-*file* set, not
   the raw total, is the regression criterion (see section 8).

## 8. Checks run in this sub-phase (exact commands and outcomes)

All `node <file>`; npm is not on this machine's PATH.

| Check | Command | Result |
|-------|---------|--------|
| Pre-change full suite | `node scripts/run-all-tests.mjs` | passed=2476, failed=9 (9 file-level ERRs: analytics/analyzer ETIMEDOUT, 3 untracked e2e tmp-* leftovers, routing.test ETIMEDOUT, run-coverage ETIMEDOUT, scale/run-synthetic-benchmark missing argument, tuning/adaptation-regression ETIMEDOUT, tuning/optimizer ETIMEDOUT); zero assertion failures |
| Optimizer on 500 corpus | `node tmp/run-optimizer-scale.mjs` (calls `optimizeThresholds()` from `src/tuning/optimizer.mjs` over the 247-sample, 204 prompts) | high=0.85, medium=0.60, Top-1 0.7843, fallback 0.0392, grid 45, 320 s |
| Flat vs hierarchical | `node tmp/run-hier-compare.mjs` | flat 0.7843 vs hierarchical 0.7598; fallback path 189/204 |
| Frozen benchmark | `node tests/run-benchmark.mjs --mode bm25` | Top-1 0.6462 (84/130), R@3 0.7077, SR@5 0.8538, no-skill 0.0615, median 32 ms / p95 39.1 ms |
| Scale re-run (after thresholds write) | `node tmp/rerun-scale.mjs` (calls `runScaleBenchmark()`, replicates the CLI write block) | all deterministic metrics identical to pre-run; reports rewritten |
| New guard test | `node tests/tuning/scale-guard.test.mjs` | 21 passed, 0 failed, exit 0 |
| Post-change full suite | `node scripts/run-all-tests.mjs` | passed=2540, failed=8 — failing files are a strict subset of the pre-change set (routing.test recovered from its ETIMEDOUT); the new scale-guard file passes under the sweep; **zero new failures** |

The pre-existing-failures contract (`logs/pre-existing-failures.json`,
"C: 1 assertion(s) failing") was not worsened: no file that passed before
fails after, and no assertion-failing file exists in either run — all 8
post-change failures are the pre-existing file-level ERRs.

## 9. Files touched

- `data/thresholds.json` — rewritten from the 7.5 optimizer run (values
  unchanged: 0.85/0.60; benchmark block now the 500-corpus figures).
- `data/baseline.json` — re-frozen for the 258-entry corpus with the
  `scale` and re-derived `guardrails` blocks (section 5).
- `tests/tuning/scale-guard.test.mjs` — new, 191 lines, 21 assertions.
- `docs/reports/phase-7-scale-results.json` / `.md` — rewritten by the 7.5
  re-run (deterministic metrics unchanged).
- `docs/reports/phase-7.5-scale-analysis.md` — this file.
- `docs/current-state.md` — entry log line for 7.5.
- `docs/decision-dictionary.md` — D37 (threshold re-tune + re-freeze) and
  D38 (hierarchical stays deprecated).
- Sweep churn in `docs/reports/phase-2-slm-benchmark.md`,
  `phase-3-scale-benchmark.md`, `phase-3-two-mode-benchmark.md` and
  `tests/integration/phase-2-results.json` was reverted to HEAD per the
  6.9/6.10/6.12/7.2/7.3 convention.

No new npm dependency. No file added exceeds 400 lines. Not committed.

## 10. Future work suggested

1. **Fix the relevance floor** (7.3 finding B1, confirmed in section 7.3
   above): an absolute-score floor or runner-up-margin test in
   `src/core/retriever/hybrid.mjs:112-114` so the two false-surfaced
   negative prompts abstain; until then the 90 % Top-1 target is
   unreachable at this corpus size.
2. **Grow the corpus past the ceiling** (the 390 excluded valid skills,
   reproducible from the recorded commits in `data/corpus-sources.json`)
   and add size points beyond 252 so the 500/1000 rows measure something
   new; add matching prompts so Top-1 has signal at those sizes.
3. **Fix the Windows CLI guard** in `tests/scale-benchmark/runner.mjs:240`
   and `tests/scale-benchmark/corpus-sampler.mjs:153` (`fileURLToPath`
   comparison) so `node <file>` runs the CLI block instead of no-oping
   silently — a silent no-op is exactly the class of failure this project
   rules out.
4. **Domain-tag the imported corpus** (build-time derivation, labelled as
   derived) to make the hierarchical path testable in good faith; revisit
   D38 only with a measured win over flat.
5. **Speed the optimizer test**: `tests/tuning/optimizer.test.mjs`
   re-runs the full 45-cell grid on the 252-leaf corpus (~12 min, blows
   the suite's 120 s per-file budget and is a standing ETIMEDOUT); sample
   the prompt set or shrink the grid in the test.
