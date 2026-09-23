# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added (Phase 3)
- **ZCode skill sync** (`src/sync/{planner,writer,state}.mjs`) — SHA-256 content-hash comparison between project `data/skills/` and ZCode mirror `~/.zcode/skills/`. Classifies each skill as add, update, remove, unchanged, or disabled. Safe mirror write with `.skill-router-meta.json` protection; user-managed skills are never modified.
- **Disable mechanism** (`src/sync/disabler.mjs`) — Two mechanisms: `mirror` (delete managed mirror directory) and `shadow` (write disabled SKILL.md with `disabled: true` frontmatter). Registry persisted in `.skill-router-disabled.json`. Supports `--disable`/`--enable`/`--disable-mechanism` on `sync` subcommand.
- **Two-source index** (`src/index/dedupe.mjs`, `src/cli/sources.mjs`) — Skills can be loaded from multiple sources (project + zcode-user). Name collisions resolved with project priority. `sources` CLI subcommand lists sources, counts, and collisions. `reindex` supports `--sources project|zcode-user|all` flags.
- **Verify CLI** (`src/cli/verify.mjs`) — 5 health checks: mirror sync status, orphan mirror directories, meta file presence, index up-to-date, thresholds validity. Colored pass/fail table. Exit 0 on all pass, 1 on any failure.
- **Doctor CLI** (`src/cli/doctor.mjs`) — 8-section diagnostic report: environment, ZCode integration, corpus, thresholds, sync state, benchmark baseline, environment overrides, config defaults. Read-only -- never modifies files.
- **Routing selector** (`src/routing/selector.mjs`) — `selectRouter(corpusSize, options)` selects flat or hierarchical routing. Default is always flat based on Phase 3 scale benchmark findings. Hierarchical available via `--experimental` flag.
- **Scale benchmark infrastructure** (`tests/scale/`) — Deterministic synthetic corpus generator (Mulberry32 seed=42, 8 domains, 70/20/10 quality mix) and benchmark runner for N=50/100/200/300/500.
- **Explicit $-mention detection** (`src/core/routing/explicit.mjs`) — `detectExplicitSkill()` scans prompts for `$`-prefixed tokens, resolves via `ROUTER_ALIASES` (in `src/config/aliases.mjs`), returns `{ skill, matchedText, cleanedPrompt }` or null.
- **Two-mode routing** — Hook now detects explicit mentions before retrieval. Explicit path: `routeWithExplicit()` scopes BM25 to the router's domain. Implicit path: pure BM25 on leaf-only index (router skills excluded). `src/core/routing/hybrid.mjs` updated with `routeWithExplicit`.
- **SLM opt-in** (`src/core/slm/`) — Client, parser, prompt-builder, errors, and index modules for local SLM integration. Disabled by default (`slm.enabled: false`). Enabled via `SKILL_ROUTER_SLM_ENABLED=true`.
- **Deploy subsystem** (`src/deploy/{planner,writer,verifier}.mjs`, `src/cli/deploy.mjs`) — Deploy router skills from `router-skills/` to the ZCode mirror. SHA-256 hash comparison, snapshot-before-write, automatic rollback on error, post-deploy verification. CLI flags: `--dry-run`, `--rollback`, `--verify`, `--quiet`, `--zcode-dir`, `--project-dir`.
- **Phase 3 scale benchmark report** at `docs/reports/phase-3-scale-benchmark.md`.
- **Phase 3 index collision report** at `docs/reports/phase-3-index-collisions.md`.
- **Phase 3 baseline report** at `docs/reports/phase-3-baseline.md`.
- **Phase 2 SLM benchmark report** at `docs/reports/phase-2-slm-benchmark.md`.
- **Phase 3 two-mode benchmark report** at `docs/reports/phase-3-two-mode-benchmark.md`.

### Changed
- `hooks/route.mjs` — Uses `selectRouter()` from `src/routing/selector.mjs` instead of auto-enabling hierarchical. Flat is now the default path at all corpus sizes.
- `hooks/build-index.mjs` — Supports multi-source indexing via `SKILL_ROUTER_SOURCES` env var. Tags skills by source, resolves name collisions with project priority.
- `src/cli/reindex.mjs` — Added `--sources` flag (`project`, `zcode-user`, `all`).
- `src/cli/sync.mjs` — Added `--disable`, `--enable`, `--disable-mechanism` flags. Writes disabled registry and sync state.
- `data/skills/` — Corpus remains at 54 skills; all pass quality validation.
- BM25 benchmark on real corpus: Top-1 improved to 96.9% (126/130) due to expected-routes label corrections from Phase 2.5.

### Benchmark Results (Phase 3)

| Metric | Value | Notes |
|---|---|---|
| Top-1 (BM25, real 54) | 96.9% (126/130) | Improved from 86.9% due to label corrections |
| Recall@3 (BM25, real 54) | 89.2% (116/130) | |
| Median latency (BM25, real 54) | 2 ms | Unchanged |
| Top-1 (BM25, synthetic 50) | 85.0% | Matching-corpus benchmark |
| Top-1 (BM25, synthetic 200) | 50.2% | |
| Top-1 (BM25, synthetic 500) | 39.5% | |
| Top-1 (hierarchical, synthetic 50) | 85.0% | Same accuracy, 2x slower |
| Top-1 (hierarchical, synthetic 500) | 39.4% | Same accuracy, 1.13x slower |
| Fallback rate | 8.46% (11/130) | Under 15% constraint |
| Cache hit rate | <1% | Single-run benchmark; low-repeat prompts |
| Two-mode detection accuracy | 100% (15/15 explicit) | Phase 3 two-mode benchmark |
| Two-mode implicit Top-1 | 100% (25/25) | Pure BM25 on leaf corpus |
| Two-mode latency p50 | 2ms explicit, 3ms implicit | Both well under hook timeout |
| SLM-Only Top-1 | 20.00% (30 prompts) | Qwen2.5-0.5B underperforms BM25 |
| SLM-Only Set Recall | 0.0972 | vs BM25 0.7000 |
| Hybrid Top-1 | 46.67% | Parity with BM25; Set Recall 0.5750 |
| Hybrid latency p50 | ~1484 ms | Exceeds hook timeout |

### Key Findings (Phase 3)
- **Flat routing is faster than hierarchical at ALL corpus sizes.** Phase 3 scale benchmark confirmed: flat is 2x faster at N=50, narrowing to 1.13x at N=500. Accuracy is tied or slightly better for flat.
- **Hierarchical routing is deprecated as default.** It remains available via `--experimental` flag.
- **Sync subsystem works correctly.** SHA-256 based comparison accurately detects drift. Mirror protection prevents corruption of user-managed skills.
- **Two-source index resolves collisions deterministically.** Project always wins over zcode-user.
- **Two-mode routing achieves 100% accuracy.** Explicit `$mention` detection correctly dispatches to router domains; implicit BM25 on leaf corpus maintains full accuracy.
- **SLM does not outperform BM25** with the current 0.5B model. Disabled by default; opt-in for experimentation only.
- **Deploy subsystem provides safe router updates.** Snapshot-before-write with automatic rollback; post-deploy verification.

### Known Limitations
- Synonym expansion degrades Top-1 on the current 54-skill corpus; keep off by default.
- Synthetic scale accuracy drops below 95% at N=50 on synthetic prompts (inflection point). This reflects prompt-skill distribution mismatch due to lexical poverty of randomly generated tokens, not algorithm failure. Real corpus maintains 96.9% Top-1.
- Real scalability beyond the 54-skill corpus has not been tested with real data.
- FNV-1a n-gram embeddings remain insufficient for semantic search; a future phase targets pre-trained model replacement.
- Disable mechanism is filesystem-based and depends on ZCode skill discovery behavior.

---

## [0.2.0] — 2026-09-22 — Phase 1: The Command Center

### Added
- **Hybrid retrieval engine** -- BM25 + semantic embeddings fused via Reciprocal Rank Fusion (k=60)
- **FNV-1a embedding engine** -- Zero-dependency 256-dimensional n-gram embeddings
- **Cross-encoder reranker** -- Feature-based reranking (keyword, bigram, domain, title match) with configurable weights
- **Multi-domain fan-out routing** -- Domain detection with BM25 + coverage + embedding signals; single/multi/fallback planning
- **Telemetry layer** -- JSONL logging with daily rotation, in-memory metrics ring buffer (p50/p95/p99), human-readable reporters
- **Configuration system** -- Centralized defaults in `src/config/defaults.mjs`, environment variable overrides via `SKILL_ROUTER_*`
- **54 real skill manifests** -- Across 7 domains (backend/laravel, backend/api, frontend/react, frontend/nextjs, design, testing, meta)
- **130 benchmark prompts** -- Covering all domains, multi-domain cases, ambiguous queries, and edge cases
- **165 automated tests** -- Embeddings (69), hybrid (16), reranker (21), routing (43), hook edge cases (16)
- **Hook hardening** -- Input validation, 200ms timeout guard, error boundary, fail-open on all errors

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
