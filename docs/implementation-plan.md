# Implementation Plan

## Phase Table

| Phase | Title                        | Description                                                                                          | Ordering Rationale                                          |
|-------|------------------------------|------------------------------------------------------------------------------------------------------|-------------------------------------------------------------|
| 0     | Spike — Feasibility Check    | Read ZCode docs, confirm hook contract, verify BM25 viability on small corpus                        | Foundation — nothing else proceeds without this gate        |
| 1     | Skeleton & Infrastructure    | Project scaffolding, module structure, Logger baseline, mock skill fixtures                            | Required before any real logic can be tested                |
| 2     | Index Builder                | Implement `src/index.mjs` + `build-index.mjs` hook; produce `data/skill-index.json` from fixtures    | Retrieval depends on a built index                          |
| 3     | Retriever + Scorer           | Implement BM25 scoring in `src/retriever.mjs` and `src/scorer.mjs`; wired confidence policy          | Depends on index; independent of ZCode runtime integration  |
| 4     | Hook Integration             | Implement `hooks/skill-router.mjs`; validate against ZCode 3.14.1 authoring context payload          | Depends on retriever; final integration layer               |
| 5     | Benchmark Suite              | `tests/run-benchmark.mjs` covering correctness, latency, and confidence-threshold behaviour           | Can start in parallel with Phase 4; should finish before Phase 6 |
| 6     | Polish & Documentation       | Edge-case hardening, error recovery, README update, decision-dictionary entries                       | Final cleanup after all functionality is verified           |

## Ordering Rationale

1. **Phase 0** must come first — it is the feasibility gate. If ZCode does not expose the authoring hook or the contract differs from assumptions, the entire project scope changes.
2. **Phase 1** establishes the directory layout, logging, and mock data so that Phases 2–3 have something concrete to operate on.
3. **Phase 2** (Index) must precede **Phase 3** (Retriever) because the retriever consumes the index structure defined in Phase 2.
4. **Phase 4** (Hook) is the last integration step — it wraps the already-verified internal logic in the ZCode interface.
5. **Phase 5** (Benchmarks) validates everything built so far; it can overlap with Phase 4 but should conclude before Phase 6.
6. **Phase 6** is purely restorative — no new functionality, only hardening and documentation.

## Definition of Done (all phases)

See `AGENTS.md` for the universal four-criteria DoD. Each phase additionally requires:

- A corresponding entry in `docs/current-state.md`.
- Any new decisions recorded in `docs/decision-dictionary.md`.
- No open issues in `docs/problems.md` that are specific to the phase's scope.
