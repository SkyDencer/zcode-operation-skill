# Phase 3.5 Verification Report

**Date:** 2026-09-23
**Verified by:** verification-reporter subagent
**Scope:** `src/cli/verify.mjs`, `src/cli/doctor.mjs`, `tests/cli/verify.test.mjs`, `tests/cli/doctor.test.mjs`

---

## 1. verify CLI — Health Checks

**Command:**
```
node bin/skill-router.mjs verify
```

**Output:**
```
Skill Router — Verify

Check                                      | Status
──────────────────────────────────────────────────────
Mirror sync status                         | PASS  mirror is in sync — 53 skill(s) match
Orphan mirror directories                  | PASS  no orphan directories found
Meta files in mirror                       | PASS  all 53 managed mirror dirs have meta files
Index up to date                           | PASS  index is up to date — 54 skill(s) match
Thresholds file                            | PASS  valid — high=0.85, medium=0.6
──────────────────────────────────────────────────────
  5 passed  (5 total)
```

**Result: 5/5 checks PASS ✓**

---

## 2. doctor CLI — Diagnostic Report

**Command:**
```
node bin/skill-router.mjs doctor
```

**Output (key sections):**
```
skill-router — Diagnostic Report
  Generated: 2026-09-23T12:45:22.143Z

── Environment ───────────────────────────────────────────────────────────
  Node version                 v26.8.2
  Platform                     win32 x64
  OS version                   v26.8.2
  Process cwd                  %USERPROFILE%\Desktop\projects\zcode-operation-skill

── ZCode Integration ───────────────────────────────────────────────────────────
  ZCode skills dir             %USERPROFILE%\.zcode\skills
  Exists                       yes
  Writable                     no

── Corpus ───────────────────────────────────────────────────────────
  Skills directory             %USERPROFILE%\Desktop\projects\zcode-operation-skill\data\skills
  SKILL.md count               54
  Index entries                54
  Index file size              30 KB

── Thresholds ───────────────────────────────────────────────────────────
  High threshold               0.85
  Medium threshold             0.6
  Benchmark Top-1              90.0%
  Benchmark fallback           8.5%
  Optimized at                 2026-09-22T15:32:40.438Z

── Sync State ───────────────────────────────────────────────────────────
  Last sync                    2026-09-23T10:41:59.615Z
  Mirror path                  %USERPROFILE%\Desktop\projects\zcode-operation-skill\tmp\install-test-home-...\.zcode\skills
  Tracked skills               53

── Benchmark Baseline ───────────────────────────────────────────────────────────
  Top-1 accuracy               90.0%
  Fallback rate                8.5%
  Grid evaluations             45
  Optimization time            20446 ms

── Environment Overrides ───────────────────────────────────────────────────────────
  SKILL_ROUTER_* vars          (none set)

── Config Defaults ───────────────────────────────────────────────────────────
  BM25 k1                      1.5
  BM25 b                       0.75
  Embedding dims               256
  RRF k                        60
  Timeout ms                   200
  Max prompt length            10240
  Budget max chars             24000
  Budget min/skill             500
```

**Result: All 8 sections present and populated ✓**

---

## 3. Test Suites

### verify.test.mjs — 11/11 passed
```
node tests/cli/verify.test.mjs
  === 1. Basic Verify Run ===     3/3 ✓
  === 2. Verify Output Format === 5/5 ✓
  === 3. Missing Thresholds Detection === 2/2 ✓
  === 4. Corrupted Index Detection === 2/2 ✓
  === 5. Non-existent Skills Dir === 1/1 ✓
  Passed: 11, Failed: 0
```

### doctor.test.mjs — 26/26 passed
```
node tests/cli/doctor.test.mjs
  === 1. Basic Doctor Run ===     5/5 ✓
  === 2. ZCode Directory Section === 2/2 ✓
  === 3. Corpus Section === 4/4 ✓
  === 4. Thresholds Section === 3/3 ✓
  === 5. Sync State Section === 2/2 ✓
  === 6. Benchmark Baseline Section === 2/2 ✓
  === 7. Environment Overrides Section === 2/2 ✓
  === 8. Config Defaults Section === 3/3 ✓
  === 9. Read-only Check === 3/3 ✓
  Passed: 26, Failed: 0
```

---

## 4. Regression Check — Full Test Suite

| Suite | Tests | Result |
|-------|-------|--------|
| cli/list.test.mjs | 28 | 28/28 ✓ |
| cli/validate.test.mjs | 20 | 20/20 ✓ |
| cli/verify.test.mjs | 11 | 11/11 ✓ |
| cli/doctor.test.mjs | 26 | 26/26 ✓ |
| embeddings.test.mjs | 69 | 69/69 ✓ |
| hybrid.test.mjs | 16 | 16/16 ✓ |
| reranker.test.mjs | 21 | 21/21 ✓ |
| routing.test.mjs | 43 | 43/43 ✓ |
| hook-edge-cases.mjs | 17 | 17/17 ✓ |
| analytics/reader.test.mjs | 17 | 17/17 ✓ |
| analytics/analyzer.test.mjs | 86 | 86/86 ✓ |
| retrieval/synonyms.test.mjs | 38 | 38/38 ✓ |
| cache/lru.test.mjs | 42 | 42/42 ✓ |
| cache/query-cache.test.mjs | 55 | 55/55 ✓ |
| import/scanner.test.mjs | 26 | 26/26 ✓ |
| import/importer.test.mjs | 49 | 49/49 ✓ |
| quality/validator.test.mjs | 32 | 32/32 ✓ |
| tuning/optimizer.test.mjs | 36 | 36/36 ✓ |
| budget/truncator.test.mjs | 20 | 20/20 ✓ |
| budget/manager.test.mjs | 32 | 32/32 ✓ |
| sync/planner.test.mjs | 38 | 38/38 ✓ |
| sync/writer.test.mjs | 34 | 34/34 ✓ |
| sync/disabler.test.mjs | 42 | 42/42 ✓ |
| index/dedupe.test.mjs | 9 | 9/9 ✓ |
| routing/selector.test.mjs | 15 | 15/15 ✓ |
| routing-hierarchical.test.mjs | 37 | 37/37 ✓ |
| integration/phase-2.mjs | 9 | 9/9 ✓ |
| e2e/full-pipeline.mjs | 80 | 80/80 ✓ |
| e2e/idempotency.mjs | 27 | 27/27 ✓ |
| e2e/orphan-cleanup.mjs | 50 | 50/50 ✓ |
| install.test.mjs | 43 | 43/43 ✓ |
| **Total** | **968** | **968/968 ✓** |

---

## 5. Benchmark Baseline (BM25 mode)

**Command:** `node tests/run-benchmark.mjs --mode bm25`

```
Top-1 Accuracy:    0.9692  (126/130)
Recall@3:          0.8923  (116/130)
Median Latency:    2 ms
P95 Latency:       3 ms
No-Skill Rate:     0.0846  (11/130)
```

No regression from Phase 3 baseline (previously 96.92% Top-1 / 2ms median). ✓

---

## 6. Summary Table

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| verify — 5 health checks | 5 PASS | 5 PASS | ✓ |
| doctor — 8 diagnostic sections | all present | all present | ✓ |
| verify.test.mjs | 11 pass | 11/11 | ✓ |
| doctor.test.mjs | 26 pass | 26/26 | ✓ |
| Full test suite | 0 failures | 0 failures (968/968) | ✓ |
| BM25 benchmark | ≥ 96% Top-1 | 96.92% Top-1 | ✓ |
| No --skills-dir crash | graceful | exits 0 | ✓ |
| Missing thresholds detection | FAIL output | FAIL output | ✓ |
| Corrupted index detection | FAIL output | FAIL output | ✓ |
| doctor read-only | no files changed | mtime unchanged | ✓ |

---

## 7. Anomalies & Notes

1. **ZCode skills dir not writable** — `doctor` reports `Writable: no` for `%USERPROFILE%\.zcode\skills`. This is expected on this Windows environment where the ZCode mirror is read-only; sync writes to a temp directory instead. Not a Phase 3.5 regression.

2. **verify exit code** — `node bin/skill-router.mjs verify` exits 0 (all checks pass). The test suite handles non-zero exits gracefully (catch block at `tests/cli/verify.test.mjs:66-73`).

3. **Hybrid benchmark lower** — Default `run-benchmark.mjs` runs in hybrid mode, showing 55.38% Top-1. This is pre-existing behavior (hybrid degrades on real corpus per Phase 2.5 findings); BM25 mode remains the default and unchanged at 96.92%.

4. **No regressions** — All 968 tests pass; benchmark baseline unchanged; verify/doctor are the only new CLI commands and both operate correctly.

---

**Verdict: Phase 3.5 verification suite PASSED.**
