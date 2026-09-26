# Implementation Plan

## Phase Table

| Phase | Title | Description | Ordering Rationale |
|-------|-------|-------------|-------------------|
| 0 | Spike -- Feasibility Check | Read ZCode docs, confirm hook contract, verify BM25 viability on small corpus | Foundation -- nothing else proceeds without this gate |
| 1 | Skeleton & Infrastructure | Project scaffolding, module structure, Logger baseline, hybrid retriever, reranker, multi-domain routing, telemetry, 54 skills | Required before any real logic can be tested |
| 2 | Scale & Tooling | Hierarchical routing, quality validator, CLI tool, threshold tuning, synonym expansion, query cache, budget manager, analytics, import pipeline, scale benchmarks | Builds on Phase 1; all features are independent modules |
| 3 | Sync & Infrastructure | ZCode skill sync, disable mechanism, two-source index, verify/doctor CLIs, routing selector (flat default), scale benchmark validation | Depends on Phase 2 stability; implements production operations tooling |
| 4 | Log Rotation & Cleanup | Implement 30-day log rotation, disk-space monitoring, stale cache eviction | Maintenance; can run in parallel with Phase 5 |
| 5 | Feedback Loop | Collect implicit user corrections (dismissed/selected skills); adjust field weights from feedback | Depends on Phase 4 (clean logs) and production usage data |
| 6 | Semantic Embedding Upgrade | Replace FNV-1a n-gram embeddings with pre-trained local model (ONNX transformer or tiny-BERT) | Depends on having clean production data; highest-impact remaining research item |
| 7 | Hardening and Corpus Truth | Edge-case hardening, error recovery, one benchmark corpus, re-measured coverage, comprehensive documentation, final benchmark sweep | Final cleanup after all functionality is verified; Phase 6 left 27 open findings, three of them silent destructive failures |

## Phase 6 Outcome

Phase 6 delivered the embedding work **and** three audits, and its central
result is negative: the pre-trained model did not beat plain BM25 on this
corpus, so it ships opt-in rather than as the default.

- The ONNX provider (`Xenova/all-MiniLM-L6-v2`, 384-dim) is implemented,
  benchmarked and available behind `SKILL_ROUTER_EMBEDDING_PROVIDER`. With the
  semantic channel on it costs 1445 ms median against a 100 ms budget and scores
  0.9052 Set Recall@5 where the shipped pure-BM25 configuration scores 1.0000.
  "Opt-in" describes the *provider*; the 591 MB install is not opt-in, because
  `@huggingface/transformers` sits in `dependencies`.
- **The default provider therefore stays FNV-1a and the semantic RRF weight
  stays 0.0**, which also keeps the default path free of a 469 ms model load.
- Three audits ran: static code (4 Critical fixed, 19 High open), documentation
  (two passes, 30 issues fixed), and test coverage (80 of 86 modules reachable
  *as of the 6.5/6.6 tree* -- the shipping tree holds 94 modules under `src/`,
  `hooks/` and `bin/`, so that figure needs re-measuring rather than restating;
  0 non-deterministic tests across 183 runs).
- The test chain grew from 43 to 73 steps; the 6.12 verification run reported 0
  failures across all 73. The assertion total was not recounted in the 6.12
  reporting pass: **2024** is the 73-step chain's figure, while **1746** is a
  different measurement -- Sub-Phase 6.6's coverage run, over the 60 test files
  its own file list resolved to. A 43-step chain cannot produce 60 files. That
  coverage run also recorded 2 failing test files, so its percentages are
  understated.

Final report: `docs/reports/phase-6-final-report.md`. Release triage for the 27
open findings: `docs/reports/phase-6-finding-triage.md`. What an independent
reader found wrong in the final report, and how each point was corrected:
`docs/reports/phase-6-report-corrections.md`.

## Ordering Rationale

1. **Phase 0** must come first -- it is the feasibility gate. If ZCode does not expose the authoring hook or the contract differs from assumptions, the entire project scope changes.
2. **Phase 1** establishes the directory layout, logging, hybrid retrieval, and mock data so that Phases 2+ have something concrete to operate on.
3. **Phase 2** adds production-grade tooling (CLI, validation, caching, budgeting, analytics, import) on top of the Phase 1 core. All Phase 2 modules are independently testable.
4. **Phase 3** addresses production operations needs: syncing skills to the ZCode mirror, disabling skills without deleting them, supporting multiple skill sources, and providing health checks. Phase 3 also validated that flat routing is superior to hierarchical routing at all scales, which simplified the default behavior.
5. **Phase 4** is maintenance infrastructure -- log rotation and cache cleanup -- that keeps the system healthy in long-running deployments.
6. **Phase 5** builds on clean logs (Phase 4) and production usage data to create a feedback loop that adjusts retrieval parameters from user behavior.
7. **Phase 6** addresses the known weakness of FNV-1a embeddings by integrating a pre-trained model. This is the highest-impact remaining research item but depends on production data and infrastructure being stable. It was the right thing to try and the answer turned out to be negative: the model is integrated and left opt-in, and Phase 6 also absorbed the three audits that Phase 7 would otherwise have had to schedule.
8. **Phase 7** is restorative rather than additive -- no new retrieval capability, only
   hardening, one benchmark corpus, and documentation polish. Phase 6 absorbed the
   three audits that Phase 7 would otherwise have had to schedule.

## Definition of Done (all phases)

See `AGENTS.md` for the universal four-criteria DoD. Each phase additionally requires:

- A corresponding entry in `docs/current-state.md`.
- Any new decisions recorded in `docs/decision-dictionary.md`.
- No open issues in `docs/problems.md` that are specific to the phase's scope.

## Phase Status Summary

| Phase | Status | Notes |
|-------|--------|-------|
| 0 | Complete | Hook contract confirmed, BM25 viability proven (90% Top-1 on 20 prompts) |
| 1 | Complete | Hybrid retrieval, reranker, routing, telemetry, 54 skills, 130 prompts, 165 tests |
| 2 | Complete | Hierarchical routing, quality validator, CLI, threshold tuning, synonym expansion, query cache, budget, analytics, import, SLM integration |
| 3 | Complete | Sync, disable, two-source index, verify, doctor, flat routing default, scale benchmark, two-mode routing, deploy subsystem |
| 4 | Complete | Hook registration fix, health CLI, feedback CLI, structured decision logging, E2E hook tests, troubleshooting guide |
| 5 | Complete | Implicit feedback signal collection, outcome correlation, BM25 field attribution, adaptive weight adjustment with guardrails, tune CLI (6 subcommands), docs/tuning.md |
| 6 | Complete | Provider abstraction plus the ONNX MiniLM-L6-v2 backend (384-dim); decision D28 to keep FNV-1a as the default and the semantic channel at weight 0.0, because ONNX gains only +5.18 pp Set Recall@5 and costs 1212-1445 ms median against a 100 ms budget. Plus three audits, two path-traversal security fixes, 30 new test files, and the Phase 6 final report |
| 7 | Planned | Hardening and Corpus Truth: the 27 open findings, one benchmark corpus, re-measured coverage, documentation polish |

## Phase 7 Roadmap

Phase 7 is restorative. No new retrieval capability. In priority order:

1. **Close the three silent destructive failures** -- `P6-H-014` (deploy rollback
   trusts an empty snapshot), `P6-H-015` (an unreadable project tree plans a mass
   removal), `P6-H-016` (any non-`ENOENT` read error turns the whole outcome
   corpus `positive`). Each has a characterisation test ready to be inverted.
2. **Settle the hook shortlist policy** (`P6-H-001`) together with the E2E
   expectations it contradicts, and stop persisting raw prompts and prompt
   prefixes (`P6-H-003`).
3. **Make `--help` real** (`P6-H-020`). `deploy --help` currently deploys.
4. **Make `getConfig()` the single config source** (`P6-H-007`, `P6-H-011`,
   `P6-H-017`) and close the smaller CLI gaps: no `~` expansion (`P6-H-021`),
   ignored `tune --json` (`P6-H-022`).
5. **Fix Windows deploy snapshot paths** (`P6-H-005`) and the dead symlink
   containment checks (`P6-H-010`).
6. **Delete the dead modules** `src/logger.mjs` and `src/retriever.mjs`
   (`P6-H-019`, `P6-H-018`) after repointing the analytics CLI and the health
   file list.
7. **Re-measure coverage from scratch**, including the 13 test files the audit
   found registered to no script, and reconcile the two denominators (86
   reachable modules vs 91 instrumented).
8. **Split the nine oversized documents and nine code files** over 300 lines.
9. **Re-run the embedding decision only against a paraphrase test set**, and only
   if the corpus grows enough for BM25 to have something to lose. Do not
   re-litigate the provider choice on the current corpus.

Explicitly not on the list: raising `MAX_DELTA` so tuning applies. The refusal
recorded in Sub-Phase 6.11 (description delta 0.715 against a 0.5 cap) is the
guardrail working; adapting before real corrective signals exist would fit noise.

## Current Focus

Phase 6 is complete. The project is ready for human review of the Phase 6
changes, followed by Phase 7 planning. Phase 6 commits are local and not pushed.

Phase 6 added the embedding provider abstraction with an opt-in ONNX backend,
rebuilt hybrid retrieval on weighted RRF with a relevance floor, and ran three
audits (static code, documentation, test coverage). The default embedding
provider is unchanged -- FNV-1a -- because the benchmark showed the pre-trained
model scoring below pure BM25 on this corpus. The BM25 baseline remains at
92.31% Top-1 (120/130), and the test chain is 73 steps, all passing.

