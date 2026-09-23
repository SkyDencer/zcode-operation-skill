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
| 7 | Polishing | Edge-case hardening, error recovery, comprehensive documentation, final benchmark sweep | Final cleanup after all functionality is verified |

## Ordering Rationale

1. **Phase 0** must come first -- it is the feasibility gate. If ZCode does not expose the authoring hook or the contract differs from assumptions, the entire project scope changes.
2. **Phase 1** establishes the directory layout, logging, hybrid retrieval, and mock data so that Phases 2+ have something concrete to operate on.
3. **Phase 2** adds production-grade tooling (CLI, validation, caching, budgeting, analytics, import) on top of the Phase 1 core. All Phase 2 modules are independently testable.
4. **Phase 3** addresses production operations needs: syncing skills to the ZCode mirror, disabling skills without deleting them, supporting multiple skill sources, and providing health checks. Phase 3 also validated that flat routing is superior to hierarchical routing at all scales, which simplified the default behavior.
5. **Phase 4** is maintenance infrastructure -- log rotation and cache cleanup -- that keeps the system healthy in long-running deployments.
6. **Phase 5** builds on clean logs (Phase 4) and production usage data to create a feedback loop that adjusts retrieval parameters from user behavior.
7. **Phase 6** addresses the known weakness of FNV-1a embeddings by integrating a pre-trained model. This is the highest-impact remaining research item but depends on production data and infrastructure being stable.
8. **Phase 7** is purely restorative -- no new functionality, only hardening and documentation polish.

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
| 2 | Complete | Hierarchical routing, quality validator, CLI, threshold tuning, cache, budget, analytics, import |
| 3 | Complete | Sync, disable, two-source index, verify, doctor, flat routing default, scale benchmark |
| 4 | Planned | Log rotation, disk monitoring, cache eviction |
| 5 | Planned | Implicit feedback collection, field weight adjustment |
| 6 | Planned | Pre-trained embedding model integration |
| 7 | Planned | Hardening, error recovery, documentation polish |

## Current Focus

Phase 3 is complete. The project is ready for human review of Phase 3 changes, followed by planning for Phase 4 (log rotation and cleanup) or Phase 5 (feedback loop), depending on whether production usage data is available.
