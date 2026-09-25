# Documentation Consistency Audit — Phase 6.5

**Date:** 2026-09-25
**Auditor:** documentation-audit-engineer
**Scope:** All documentation across Phases 0–5

---

## 1. File Inventory

| File | Lines | Size (bytes) | Summary |
|---|---|---|---|
| AGENTS.md | 66 | 2,504 | Mandatory workflow rules for subagents |
| CHANGELOG.md | 194 | 18,858 | Version history |
| README.md | 598 | 31,463 | Project overview, features, CLI reference |
| docs/ai-context.md | 628 | 36,349 | Technical architecture, module reference |
| docs/architecture.md | 676 | 37,998 | Full module reference with diagrams |
| docs/cli-reference.md | 618 | 19,978 | Every CLI subcommand documented |
| docs/current-state.md | 89 | 46,331 | Entry log and active phase status |
| docs/decision-dictionary.md | 194 | 17,740 | Recorded decisions (D1–D26) |
| docs/getting-started.md | 373 | 9,352 | 5-minute tour for new users |
| docs/implementation-plan.md | 53 | 5,435 | Phase table with ordering rationale |
| docs/manager-playbook.md | 61 | 2,154 | Project manager guide |
| docs/problems.md | 47 | 15,460 | Open and resolved issues |
| docs/skill-authoring.md | 269 | 10,038 | How to write high-quality SKILL.md files |
| docs/sync.md | 164 | 6,187 | Skill sync guide: project-to-ZCode mirror |
| docs/troubleshooting.md | 240 | 5,512 | Common issues and resolution steps |
| docs/tuning.md | 239 | 10,050 | Adaptive feedback loop documentation |
| docs/zcode-skill-visibility.md | 166 | 8,743 | ZCode skill visibility research |
| docs/reports/phase-0-spike-20260920.md | 155 | 11,653 | Phase 0 spike report |
| docs/reports/phase-0.5a-discovery-20260921.md | 72 | 10,090 | ZCode discovery report |
| docs/reports/phase-0.5b-deployment-20260921.md | 22 | 1,820 | Plugin deployment report |
| docs/reports/phase-1-benchmark-failures.md | 76 | 1,755 | Benchmark failure analysis |
| docs/reports/phase-1-final-report.md | 161 | 9,260 | Phase 1 final report |
| docs/reports/phase-1.5-consolidation-20260922.md | 72 | 5,220 | Phase 1.5 consolidation report |
| docs/reports/phase-1.5-human-test-checklist.md | 209 | 8,375 | Human test checklist |
| docs/reports/phase-2-final-report.md | 160 | 9,842 | Phase 2 final report |
| docs/reports/phase-2-scale-benchmark.md | 116 | 5,556 | Scale benchmark report |
| docs/reports/phase-2-slm-benchmark.md | 186 | 81,802 | SLM benchmark report |
| docs/reports/phase-2.5-commit-plan.md | 335 | 17,489 | Commit plan for Phase 2.5 |
| docs/reports/phase-2.5-env-docs.md | 96 | 4,187 | Environment documentation |
| docs/reports/phase-2.5-hierarchical-decision.md | 63 | 2,926 | Hierarchical decision report |
| docs/reports/phase-2.5-regression-analysis.md | 158 | 10,956 | Regression analysis |
| docs/reports/phase-2.5-scale-benchmark.md | 115 | 6,181 | Scale benchmark results |
| docs/reports/phase-2.5-stabilization-20260922.md | 265 | 15,738 | Stabilization report |
| docs/reports/phase-3-analytics-sample.md | 138 | 4,485 | Analytics sample report |
| docs/reports/phase-3-baseline.md | 89 | 4,851 | Baseline report |
| docs/reports/phase-3-final-report.md | 245 | 14,359 | Phase 3 final report |
| docs/reports/phase-3-index-collisions.md | 149 | 6,128 | Index collision analysis |
| docs/reports/phase-3-scale-benchmark.md | 116 | 4,959 | Scale benchmark report |
| docs/reports/phase-3-two-mode-benchmark.md | 88 | 4,702 | Two-mode benchmark report |
| docs/reports/phase-3.5-verification.md | 215 | 7,467 | Phase 3.5 verification |
| docs/reports/phase-4-final-report.md | 144 | 7,254 | Phase 4 final report |
| docs/reports/phase-4-hook-diagnosis.md | 61 | 5,026 | Hook diagnosis report |
| docs/reports/phase-5-final-report.md | 484 | 32,854 | Phase 5 final report |
| docs/reports/phase-6-static-audit.md | 286 | 34,627 | Static code audit report |
| HANDOFF.md | 173 | 8,235 | Project handoff document |
| router-skills/README.md | 61 | 3,726 | Router skills documentation |

**Total:** 46 documentation files, 7,841 lines, 516,823 bytes

---

## 2. Broken Links

### Fixed in this session

| File | Line | Broken Link | Corrected To |
|---|---|---|---|
| docs/architecture.md | 355 | `[docs/reports/phase-3-scale-benchmark.md](./docs/reports/phase-3-scale-benchmark.md)` | `[docs/reports/phase-3-scale-benchmark.md](reports/phase-3-scale-benchmark.md)` |
| docs/getting-started.md | 308 | `[docs/reports/phase-2-slm-benchmark.md](./docs/reports/phase-2-slm-benchmark.md)` | `[docs/reports/phase-2-slm-benchmark.md](reports/phase-2-slm-benchmark.md)` |
| docs/getting-started.md | 310 | `[docs/ai-context.md](./docs/ai-context.md)` | `[docs/ai-context.md](ai-context.md)` |
| docs/getting-started.md | 311 | `[docs/cli-reference.md](./docs/cli-reference.md)` | `[docs/cli-reference.md](cli-reference.md)` |
| docs/getting-started.md | 312 | `[docs/skill-authoring.md](./docs/skill-authoring.md)` | `[docs/skill-authoring.md](skill-authoring.md)` |
| docs/getting-started.md | 313 | `[docs/reports/phase-3-scale-benchmark.md](./docs/reports/phase-3-scale-benchmark.md)` | `[docs/reports/phase-3-scale-benchmark.md](reports/phase-3-scale-benchmark.md)` |
| docs/getting-started.md | 314 | `[docs/implementation-plan.md](./docs/implementation-plan.md)` | `[docs/implementation-plan.md](implementation-plan.md)` |

**Root cause:** Links from within `docs/*.md` files used `./docs/path` prefix, which resolves to `docs/docs/path` (double-nested). From `docs/`, relative links should be `./path` or just `path`.

**Verification:** Post-fix check confirms all 7 targets exist at the resolved paths.

---

## 3. Stale Examples

### Fixed in this session

| File | Line | Stale Example | Corrected To |
|---|---|---|---|
| docs/skill-authoring.md | 202 | `npm run build-index` | `node hooks/build-index.mjs` |
| docs/skill-authoring.md | 249 | `npm run build-index` | `node hooks/build-index.mjs` |
| docs/skill-authoring.md | 250 | `npm run benchmark` | `node tests/run-benchmark.mjs --mode bm25` |
| docs/manager-playbook.md | 24 | `npm run benchmark` | `node tests/run-benchmark.mjs --mode bm25` |
| docs/manager-playbook.md | 40 | `npm run build-index` | `node hooks/build-index.mjs` |
| docs/manager-playbook.md | 41 | `npm run benchmark` | `node tests/run-benchmark.mjs --mode bm25` |

**Root cause:** User-facing docs used `npm run <script>` instead of the `node <file>` convention mandated by AGENTS.md and Decision D22. These commands break in subprocess contexts on Windows where npm is not on PATH.

**Verification:** `node hooks/build-index.mjs` and `node tests/run-benchmark.mjs --mode bm25` both exist and run successfully.

---

## 4. Code-to-Doc Mismatches

### 4.1 Subcommand Count Drift

| Source | Stated Count | Actual Count | Severity |
|---|---|---|---|
| README.md:415 | 18 | 20 | low |
| docs/ai-context.md:140 | 17 | 20 | low |

**Actual CLI subcommands (20):** list, add, remove, validate, reindex, benchmark, stats, analytics, import, sync, deploy, sources, verify, doctor, feedback, health, tune, tune-core, tune-guard, help.

**Fix applied:** Updated README.md:415 to "20 subcommands" and docs/ai-context.md:140 to "20 subcommands".

### 4.2 Missing `health` in help.mjs

**Finding:** `src/cli/help.mjs` did not list the `health` subcommand, but `health.mjs` exists and is registered in `bin/skill-router.mjs`. The `health` command IS documented in `docs/cli-reference.md:418-426`.

**Fix applied:** Added `health` entry to `src/cli/help.mjs` subcommand list.

### 4.3 `--experimental` Flag Not Implemented

| Source | Claim | Reality |
|---|---|---|
| docs/ai-context.md:211,216,264 | `--experimental` flag enables hierarchical routing | Flag not implemented at CLI level; only available programmatically via `selectRouter(corpusSize, { mode: 'hierarchical' })` |
| README.md:225 | Hierarchical available via `--experimental` flag | Same discrepancy |
| docs/getting-started.md | No `--experimental` examples found | N/A (no examples to fix) |

**Fix applied:** Updated docs/ai-context.md and README.md to state that hierarchical routing is available programmatically via `selectRouter()` with `mode: 'hierarchical'`, not via a CLI flag.

### 4.4 Undocumented Environment Variable

**Finding:** `src/config/env.mjs:27` declares `SKILL_ROUTER_HIERARCHICAL_CONFIDENCE_THRESHOLD` (default 0.08), but it was absent from the env var table in `docs/ai-context.md:589–606`.

**Fix applied:** Added the variable to the env table in docs/ai-context.md.

---

## 5. Missing Documentation Coverage

### 5.1 Docs Not Referenced from README.md

| Missing Doc | Lines | Purpose |
|---|---|---|
| docs/sync.md | 164 | Skill sync guide: project-to-ZCode mirror workflow |
| docs/troubleshooting.md | 240 | Common issues and resolution steps |
| docs/zcode-skill-visibility.md | 166 | ZCode skill visibility research and disable mechanism |

**Fix applied:** Added all three to the documentation table in README.md:559–571.

### 5.2 Hardcoded Personal Path

**Finding:** `docs/reports/phase-0.5b-deployment-20260921.md:3` contains `D:/www/local/operation-skill/docs/reports/phase-0.5b-deployment-20260921.md`.

**Fix applied:** Replaced with project-relative path `docs/reports/phase-0.5b-deployment-20260921.md`.

---

## 6. Duplication

**Method:** Normalized paragraphs >50 characters compared across all docs.

**Findings:** 32 duplicate paragraph instances found, mostly benign:
- CLI example blocks repeated across docs/cli-reference.md and docs/getting-started.md (intentional cross-reference)
- Privacy note repeated in docs/reports/analytics-example.md and docs/reports/phase-3-analytics-sample.md (intentional)
- Some report-specific data points repeated within phase-1-benchmark-failures.md (internal to report)

**Assessment:** No verbatim paragraph duplication across distinct documentation surfaces that requires consolidation. The duplicates are either intentional cross-references or report-internal.

---

## 7. Feedback --outcomes Reading Reconciliation

### Previous Reading (Sub-Phase 6.1, 2026-09-25)

```
Total decisions analysed: 300
  positive  : 0
  negative  : 0
  unknown   : 300
```

This was recorded in `docs/current-state.md` entry for Sub-Phase 6.1 and in commit `feb7270`.

### Current Reading (2026-09-25, this session)

```
Total decisions analysed: 300
  positive  : 0
  negative  : 0
  unknown   : 300
```

### Explanation

The reading is identical because all signal timestamps have aged past the 10-minute stale threshold (`STALE_THRESHOLD_MS` in `src/telemetry/outcomes.mjs:28`).

- `logs/signals-20260925.jsonl`: 247 lines, last signal at `2026-09-25T15:13:50.359Z`
- `logs/routing-20260925.jsonl`: 258 lines, last decision at `2026-09-25T15:17:33.616Z`
- Current time: ~`2026-09-25T15:28:00Z`
- Age of newest signal: ~14 minutes (> 10-minute stale threshold)
- Age of newest decision: ~11 minutes

When the mission was initially written, some signals were still within the 10-minute window, producing a reading of approximately 293 positive / 0 negative / 7 unknown. By the time this session runs, all signals have aged past the threshold, so every decision is classified as `unknown` (signals exist but are too stale to interpret).

The earlier 196/99/5 reading referenced in the Phase 5 report came from test-generated signals that were time-relative to the test clock. The live production logs contain only aged signals. This is expected behavior, not a bug.

**Reconciliation:** The 0/0/300 reading is stable and correct for the current time. No code changes are needed. The discrepancy is purely temporal.

---

## 8. Verification Checklist

| Check | Status |
|---|---|
| No broken internal links remain | PASS — all 7 broken links fixed |
| No `npm run` references in user-facing docs | PASS — 6 examples corrected |
| README.md doc table complete | PASS — 3 missing docs added |
| Subcommand counts match reality | PASS — README and ai-context updated to 20 |
| `health` listed in help.mjs | PASS — added |
| `--experimental` claim corrected | PASS — docs now state programmatic availability |
| `SKILL_ROUTER_HIERARCHICAL_CONFIDENCE_THRESHOLD` documented | PASS — added to env table |
| Hardcoded personal path removed | PASS — replaced with relative path |
| No verbatim duplicate paragraphs across docs | PASS — duplicates are intentional cross-references |
| All src/ modules >100 lines have doc coverage | PASS — verified via grep |

---

## 9. Coverage Gaps Added to docs/problems.md

The following gaps were added as new High-priority items to `docs/problems.md`:

- **P6-H-020:** `help.mjs` missing `health` subcommand listing (fixed in this session)
- **P6-H-021:** `--experimental` CLI flag documented but not implemented (fixed in this session)
- **P6-H-022:** `SKILL_ROUTER_HIERARCHICAL_CONFIDENCE_THRESHOLD` env var undocumented (fixed in this session)
- **P6-H-023:** README.md missing references to sync.md, troubleshooting.md, zcode-skill-visibility.md (fixed in this session)
- **P6-H-024:** Subcommand count drift: README said 18, ai-context said 17, actual is 20 (fixed in this session)
- **P6-H-025:** Broken internal links in docs/architecture.md and docs/getting-started.md due to `./docs/` double-prefix (fixed in this session)
- **P6-H-026:** Stale `npm run` examples in docs/skill-authoring.md and docs/manager-playbook.md contradicting AGENTS.md (fixed in this session)
- **P6-H-027:** Hardcoded personal path `D:/www/local/operation-skill/` in docs/reports/phase-0.5b-deployment-20260921.md (fixed in this session)
