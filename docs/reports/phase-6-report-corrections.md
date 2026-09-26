# Phase 6 Final Report — Corrections Log

<!--
  Purpose: record every change made to `docs/reports/phase-6-final-report.md`
  in the Sub-Phase 6.12 revision pass, 2026-09-26, after an independent reader
  reviewed it and found wrong or unverifiable claims.
  Method: each entry below was checked against the tree in this pass; the
  command or file:line that decided it is named. The report carries the
  corrected fact; this file carries the reasoning.
  Author: 6.12 revision pass.
-->

## Scope

13 findings from the reader, all accepted. Nothing was rejected. The reader's own
report is summarised in each entry; where the reader said a check was *not* run,
that is repeated here so the corrected claim inherits the same caveat.

## Corrections

### 1. §9.6 claimed two unreachable modules are retired; one is

`src/retriever.mjs` is **not** one of the six unreachable modules.
`docs/reports/phase-6-test-audit.md:36` lists it in the *covered* column
(`retriever.mjs (subprocess)`), `docs/problems.md:31` records that
`src/analytics/analyzer.mjs:18` imports it, and
`grep -rn "retriever.mjs" tests/ --include=*.mjs` returns no hits — consistent
with subprocess-only reach, not unreachability. Only `src/logger.mjs`
(`P6-H-019`) is on the unreachable list. Report §9.6 and §4 corrected; the
triage file states the same distinction.

### 2. §6 quoted a coverage run that had 2 failing files

`logs/coverage-2026-09-25.json` records `testFilesRun: 60` and
**`testFilesFailed: 2`**, with `meanLineCoverage` 87.55, `meanBranchCoverage`
68.7, `meanFuncCoverage` 83.23, `totalModulesTracked` 91, `fullyCoveredModules`
23. The two files are `tests/embeddings/provider.test.mjs` (2 assertions) and
`tests/hybrid-provider.test.mjs` (1), named in `docs/current-state.md:22` as
failing standalone. The percentages are understated and the 1746-assertion total
excludes those two files. Report §6 now says so.
**Not run in this pass:** `node tests/run-coverage.mjs` — the reader also did not
run it, and the reporting ask excludes it. The JSON was read, not regenerated.

### 3. §8.8 said the ONNX path has no timeout guard; it does

`hooks/route.mjs:196-201` wraps `hybridRetrieve()` in `Promise.race` with
`setTimeout(() => reject(new Error('embedding retrieval timeout')), timeoutMs)`,
and `:203-205` falls back to `rankSkills(query, idx)` on catch. The comment at
`:191-194` states the intent. §8.8 was the most consequential error a reader
could carry away, and it contradicted §5's own latency argument; both are
corrected.

### 4. §5 called 200 ms "the hook's own timeout"

`src/config/defaults.mjs:153` sets `hook.timeoutMs: 200`, but that value is
destructured at `hooks/route.mjs:36` and consumed as the race timer at `:199`.
The timeout the hook is **registered** under is `"timeoutMs": 3500` at
`hooks/hooks.json:12`. Against 200 ms, 1212 ms would blow the budget; against
3500 ms it would not. §5 now names both numbers and what each one governs.

### 5. §6's assertion provenance was arithmetically impossible

"The 1746 assertions across 60 files figure below is the Sub-Phase 6.6 coverage
run, measured when the chain was 30 steps shorter" merges two histories. 43 steps
(73 − 30) cannot yield 60 files, because `tests/run-coverage.mjs:47-48` builds
its file list from `package.json`'s `test` script. The real chain sizes are in
`docs/reports/phase-6-test-audit.md:225-227`: 48 steps for the load graph, 52
for the determinism pass. 43 is the Sub-Phase **6.2** figure. §6 now separates
2024 (73-step chain) from 1746 (6.6 coverage run) and names 60 as a file count,
not a chain length.

### 6. §6 contained a dangling reference

"The 1746 assertions across 60 files figure **below**" was never used again. The
coverage paragraph that followed quoted percentages only. Removed with the §6
rewrite.

### 7. §4's "all 61 test files" is a 6.5/6.6 figure

Verified in this pass: `package.json` `test` splits into **73** entries
(1 benchmark + 72 test files), `test:cli` = 11, `test:e2e` = 5. Walking
`tests/` finds **75 `.test.mjs` files**, of which **9** are registered to no
chain: `tests/deploy/planner.test.mjs`, `tests/deploy/writer.test.mjs`,
`tests/hooks/hybrid-output.test.mjs`, `tests/routing/explicit.test.mjs`,
`tests/routing/hybrid.test.mjs`, `tests/routing-hierarchical.test.mjs`,
`tests/scale/scale-benchmark.test.mjs`, `tests/slm/client.test.mjs`,
`tests/slm/prompt-builder.test.mjs`. (66 registered `.test.mjs` plus 6 chain
entries not named `.test.mjs` — `tests/hook-edge-cases.mjs` and the five
`tests/e2e/*.mjs` — makes the 72.) The audit's 61 = 52 chain steps + 13
unregistered. §4 and §6 now state the current counts and mark 93.0% as a 6.5/6.6
measurement. The same pass replaced "13 unregistered" with 9 in the report's
Phase 7 item 7.

### 8. §6's two denominators are both stale and the current one was missing

`find src hooks bin -name "*.mjs" | wc -l` → **94** in this tree. The report
reconciled 86 (audit, modules a test can reach) against 91 (instrumented runner,
modules observed loading) but never said 8 modules are outside both. §6 now
gives all three.

### 9. §8.4's "seven BM25 Top-1 misses" contradicts the report's own table

0.9231 = 120/130, so there are **10** misses. The phrase is inherited from
`docs/reports/phase-6-embedding-benchmark.md:170-171` and
`docs/current-state.md:13`; neither reconciles it. The second half of the same
sentence claimed "Both numbers are recorded separately in `data/baseline.json`",
but `data/baseline.json` `corpora.leaf` records only `{"indexSize":54,
"top1":0.9692, "note":...}` — **there is no leaf Set Recall in the file**. §8.4
now says ten, names the four `router-*` wins, and states that the leaf Set
Recall@5 lives in 6.10 report prose rather than in the frozen artefact.

### 10. The header diffstat did not match the tree

| Claim in the header | Measured |
|---|---|
| `git rev-list --count 6ca4a82 ^f799d99^` → 44 | 44, correct |
| 158 files, +19,518/−774 | `git diff --shortstat f799d99 6ca4a82` → **155 files, +18,673/−767**; `git diff --shortstat f799d99 HEAD` → **156 files, +19,264/−823** |
| "plus this report's commit" | `git rev-list --count 6ca4a82..HEAD` → **4** (`78d33d0`, `7d9a722`, `f6d7377`, `10c910b`) |
| "HEAD matches origin/main" | Correct: both `10c910b` |

The header now gives both ranges and names the four commits.

### 11. §8.9 misfiled a source file as a document and miscounted

`wc -l` in this pass: `src/cli/health.mjs` 463 (report said 463, correct),
`hooks/route.mjs` 393 (correct), `src/sync/disabler.mjs` **301** (report said
300), `src/deploy/writer.mjs` **502** (report said 503, and listed it among "nine
documents" though it is source), `docs/cli-reference.md` **711** (report said
707). §8.9 now lists four source files and one document with measured counts and
says they are `wc -l` figures as of this revision.

### 12. The report never said the 591 MB is a hard install dependency

`package.json` declares `dependencies: {"@huggingface/transformers": "^4.3.0"}`;
`devDependencies` and `optionalDependencies` are both absent. §5's "ONNX is
opt-in" was true of the *provider*, not of the install. §5 and §9 item 8 now say
so, and Phase 7 gets a priority for making the dependency genuinely optional.
The reader's own measurement agrees with the report's: `du -sm node_modules` →
591 MB, `du -sm node_modules/@huggingface/transformers/.cache` → 122 MB.

### 13. The decision rule as written would have recommended the switch

§5 fixed the rule as "more than 5 pp over FNV-1a **and** under 100 ms". ONNX
clears the accuracy clause at +5.18 pp. The actual argument against shipping is a
third comparison the rule does not contain — 0.9052 against the incumbent BM25
1.0000 — which the report made at :150-153 while leaving the reader with "the
accuracy test passed". §5 now carries an explicit paragraph telling the reader to
evaluate the rule with the incumbent comparison attached.

## Three claims the reader did not name, found while checking

- The same 200 ms / 3500 ms misidentification (finding 4) and the same
  "installs nothing" claim (finding 12) had propagated into three more files
  that a reader is as likely to act on as the report. All corrected:
  `README.md:289` ("7x the hook's own 200 ms timeout", plus the missing
  incumbent comparison and the dependency note), `docs/decision-dictionary.md`
  D28's rationale ("six times the hook's own 200 ms `hook.timeoutMs`", with a new
  **Rule caveat** bullet recording that the rule compares against the weakest
  alternative and would have recommended the switch on its accuracy clause), and
  `docs/architecture.md:5` ("the default retrieval path still installs nothing").
  The `architecture.md` sentence also carried a duplicated "Phase 5 added ...
  Phase 6 added ..." clause; the duplicate went with the correction.
  `HANDOFF.md:110`'s "FNV-1a (256-dim, default, zero dependency)" was true of
  that provider and misleading about the install; it now says which is which.
- `docs/current-state.md:105` and `HANDOFF.md:129` stop the open-findings range at
  `P6-H-026`; the range is `P6-H-001`–`P6-H-027` (27 rows, 21 High, 6 Medium,
  verified by parsing `docs/problems.md`). Both documents corrected.
- The report's own "reader questions" gap — no answer to "was the verification
  re-run after the four post-6.12 commits?" — is now answered in §1:
  `git diff --stat 6ca4a82..HEAD -- src hooks bin tests scripts data
  router-skills .zcode-plugin` is **empty**, so no source, test, fixture or
  manifest changed after the run. The chain was still not re-run, which the
  report now states as a gap rather than implying it is cleared.

## Not changed, and why

`docs/reports/phase-6-embedding-benchmark.md:170` and
`docs/current-state.md:13` both still say "seven BM25 Top-1 misses". They are
historical records of what those passes measured and reported, not living
claims; rewriting an entry log would falsify it. The correction is carried in
this report and in `docs/problems.md`'s successors. Flagged here so the next
reader does not treat the two as current.

`docs/problems.md` statuses were left untouched: closing a finding needs a code
change, and this pass changed no code.

## Checks run in this pass

Documentation-only pass; no `node` test was run, and none was asked for. The
commands run were read-only:

```
find src hooks bin -name "*.mjs" | wc -l                                  # 94
wc -l src/cli/health.mjs hooks/route.mjs src/sync/disabler.mjs \
      src/deploy/writer.mjs docs/cli-reference.md                          # 463 393 301 502 711
git rev-list --count 6ca4a82 ^f799d99^                                    # 44
git diff --shortstat f799d99 6ca4a82                                      # 155 files, 18673/767
git diff --shortstat f799d99 HEAD                                         # 156 files, 19264/823
git rev-list --oneline 6ca4a82..HEAD                                      # 4 commits
git rev-parse --short HEAD ; git rev-parse --short origin/main             # 10c910b 10c910b
git diff --stat 6ca4a82..HEAD -- src hooks bin tests scripts data \
      router-skills .zcode-plugin                                          # empty
grep -rn "retriever.mjs" tests/ --include=*.mjs                            # no hits
du -sm node_modules node_modules/@huggingface/transformers/.cache          # 591, 122
find node_modules/@huggingface/transformers/.cache -name "model.onnx.tmp.*" # the 36,658,315-byte stale file
```

Plus a walk of `tests/` comparing every `.test.mjs` path against the `test`,
`test:cli` and `test:e2e` chains (75 files, 9 unregistered) and a read of
`logs/coverage-2026-09-25.json`.

**Not run in this pass:** the 73-step test chain, `node tests/run-coverage.mjs`,
the two-mode and SLM benchmark runners, and the four §7 benchmark commands. The
run script gates on the first two.
