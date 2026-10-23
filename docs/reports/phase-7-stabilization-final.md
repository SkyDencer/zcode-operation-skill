# Phase 7.14 — Stabilization Final Check

> **Date:** 2026-10-23
> **Purpose:** The `chore: final stability check` gate for the v1.0.1
> stabilization pass. Confirms the full suite is green, the frozen baseline is
> unchanged, and the install is READY for the human end-to-end run.

## The Five Commands

Run from the repository root. `npm` is not on the subprocess PATH on this
host — invoke `node <file>` directly. Run the full suite **first and let it
finish** before the benchmark and readiness gate (see the caveat at the end).

```
1. node scripts/run-all-tests.mjs
2. node bin/skill-router.mjs health
3. node bin/skill-router.mjs verify --deep
4. node tests/run-benchmark.mjs --corpus real --router flat
5. node scripts/verify-e2e-ready.mjs
```

## Results (captured 2026-10-23)

### 1. Full test suite — `node scripts/run-all-tests.mjs`

```
Total: passed=2898, failed=0        (exit 0)
```

90 OK test files; 28 SKIPs, all "no summary found" — these are benchmark
runners, corpus generators, and the SLM client tests that print no
`Passed:`/`Failed:` block, so the runner (which scrapes that summary) treats
them as skips rather than failures. **No FAIL, no ERR lines.**

### 2. Health — `node bin/skill-router.mjs health`

```
8 passed  (8 total)          (exit 0)
```

All eight checks pass: plugin dir, hook registered, index fresh (258 skills),
6 routers installed, hook invocable, llama-server (optional — SLM disabled),
no forbidden files, thresholds valid (high=0.85, medium=0.60).

### 3. Verify (deep) — `node bin/skill-router.mjs verify --deep`

```
6 passed · 1 failed  (7 total)   (exit 1)
```

| Check | Result |
|-------|--------|
| Mirror sync status | FAIL — mirror has drift (4 stale leaf copies) |
| Orphan mirror directories | PASS |
| Meta files in mirror | PASS (210 managed dirs) |
| Index up to date | PASS (258 match) |
| Thresholds file | PASS |
| Hook registered | PASS |
| Hook invocable | PASS |

The single failure is **pre-existing, non-blocking leaf-mirror drift**: four
leaf copies in the ZCode mirror are stale. This does not affect routing —
leaf skills are disabled for routing (only the 6 routers route) and the hook
drives decisions from the in-project index, not the mirror. `deploy` refreshes
the mirror. `verify --deep` exits 1 because it counts that check, but it is not
a readiness blocker (the gate in step 5 treats it as a non-blocking note).

### 4. Frozen BM25 baseline — `node tests/run-benchmark.mjs --corpus real --router flat`

```
Index size: 258 skills
Top-1 Accuracy:    0.6462  (84/130)
Recall@3:          0.7077  (92/130)
No-Skill Rate:     0.0615  (8/130)
```

**Baseline unchanged:** the frozen Top-1 (0.6462 / 84-130) on the 258-entry
index is identical to the value recorded at v1.0.0 and through Phase 7. None of
the D-block changes moved it.

### 5. E2E readiness — `node scripts/verify-e2e-ready.mjs`

```
✓ health: 8/8 checks pass
✓ hook registered in the ZCode CLI config
✓ 6 router skill(s) installed in the mirror
✓ 252 leaf skill(s) on disk, all 252 indexed in data/skill-index.json
△ mirror sync: mirror has drift — 4 stale (non-blocking: leaves are disabled for routing)

READY FOR HUMAN E2E          (exit 0)
```

## Verdict

**READY FOR HUMAN E2E.** The full suite is green, the frozen baseline is
unchanged, and all four routing-critical readiness conditions hold. The only
open item is the pre-existing, non-blocking leaf-mirror drift, which the human
clears by running `deploy` as E2E step 1.

## Caveats

- **Run the suite to completion before the benchmark and the readiness gate.**
  `tests/hooks/perf.test.mjs` exercises the 1000-skill fixture and transiently
  writes `data/skill-index.json` to 1000 entries while it runs; a benchmark or
  readiness check executed *concurrently* with the suite will read that
  transient index and report a wrong size (observed: a benchmark run during an
  in-flight suite reported "Index size: 1000 skills / Top-1 0.0692"). The
  index is restored to 258 when the suite finishes. This report's numbers were
  captured with no suite running.
- **ONNX is machine-state dependent.** The ONNX-vs-FNV-1a test is gated on
  in-process model availability; the ONNX model happens to be cached on this
  host, so the full check runs. On a machine without the model it is skipped
  with a documented note, and the suite is still green.
