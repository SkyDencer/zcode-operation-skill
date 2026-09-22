## Phase 1 — The Command Center (2026-09-22)

### Added
- Modular architecture (`src/core/`, `src/config/`, `src/utils/`)
- BM25 retrieval engine (default, 0.9769 Top-1 on 130-prompt benchmark)
- 54 skills across 7 domains (backend, frontend, design, testing, meta)
- 130-prompt benchmark suite with per-domain reporting
- Multi-domain routing with structured RoutePlan output
- JSONL telemetry with p50/p95/p99 metrics
- Configuration system with `SKILL_ROUTER_*` env overrides
- Hook hardening: input validation, 200ms timeout, error boundary
- 165 tests, all passing

### Experimental
- Hybrid retrieval (BM25 + n-gram embeddings via RRF): underperforms BM25 on the current corpus (60.8% Top-1). Kept for Phase 2 experimentation.
- Feature-based reranker: opt-in, does not consistently improve Top-1.

### Known Limitations
- N-gram embeddings are weaker than transformer embeddings.
- Domain detection thresholds are tuned for the current 54-skill corpus.
- No pre-trained embedding model (Phase 2 roadmap).

---

# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.2.0] — 2026-09-22 — Phase 1: The Command Center

### Added
- **Hybrid retrieval engine** — BM25 + semantic embeddings fused via Reciprocal Rank Fusion (k=60)
- **FNV-1a embedding engine** — Zero-dependency 256-dimensional n-gram embeddings
- **Cross-encoder reranker** — Feature-based reranking (keyword, bigram, domain, title match) with configurable weights
- **Multi-domain fan-out routing** — Domain detection with BM25 + coverage + embedding signals; single/multi/fallback planning
- **Telemetry layer** — JSONL logging with daily rotation, in-memory metrics ring buffer (p50/p95/p99), human-readable reporters
- **Configuration system** — Centralized defaults in `src/config/defaults.mjs`, environment variable overrides via `SKILL_ROUTER_*`
- **54 real skill manifests** — Across 7 domains (backend/laravel, backend/api, frontend/react, frontend/nextjs, design, testing, meta)
- **130 benchmark prompts** — Covering all domains, multi-domain cases, ambiguous queries, and edge cases
- **165 automated tests** — Embeddings (69), hybrid (16), reranker (21), routing (43), hook edge cases (16)
- **Hook hardening** — Input validation, 200ms timeout guard, error boundary, fail-open on all errors

### Changed
- Reorganized `src/` into `core/`, `config/`, `utils/` subdirectories
- Updated `hooks/route.mjs` to use hybrid retrieval + routing + telemetry
- Updated `hooks/build-index.mjs` to scan `data/skills/` recursively
- Updated `tests/run-benchmark.mjs` with `--mode` and `--rerank` flags
- Updated all documentation to reflect Phase 1 architecture

### Performance
- BM25 mode: 97.7% Top-1, 97.7% Recall@3, 3ms median latency
- Hybrid mode: 60.8% Top-1, 83.1% Recall@3, 10ms median latency
- Routing overhead: <5ms over baseline retrieval
- All hook edge cases exit 0 with no crashes

### Removed
- None (all Phase 0 functionality preserved)

## [0.1.0] — 2026-09-20 — Phase 0: Spike

### Added
- BM25 retrieval engine (`src/scorer.mjs`, `src/retriever.mjs`)
- ZCode hook integration (`hooks/route.mjs`, `hooks/build-index.mjs`)
- Structured JSONL logger (`src/logger.mjs`)
- 10 mock skill manifests
- Benchmark suite (20 prompts)
- Plugin manifest (`.zcode-plugin/plugin.json`)

### Results
- Top-1 Accuracy: 90% (18/20)
- Recall@3: 100% (20/20)
- Median Latency: 3ms
- No-skill rate: 0%
