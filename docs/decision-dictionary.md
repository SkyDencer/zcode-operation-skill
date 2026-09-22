# Decision Dictionary

Decisions made during the TedGram Skill Router project. Each entry is immutable once recorded.

## D1 — BM25 as the initial retrieval algorithm

- **Question:** Should the MVP use lexical (BM25) or semantic (vector) search?
- **Decision:** BM25 lexical search.
- **Rationale:** Zero external dependencies; deterministic; fast enough for < 200 skills; no embedding model required. Semantic search is reserved for a future phase if lexical recall proves insufficient.
- **Date:** 2026-09-20
- **Status:** Accepted

## D2 — No npm dependencies

- **Question:** Should we pull in a BM25 library or write our own?
- **Decision:** Write our own. The project forbids external dependencies (`"private": true`, no `dependencies` field). A custom BM25 implementation is ~150 lines and avoids version-lock risks.
- **Date:** 2026-09-20
- **Status:** Accepted

## D3 — JSONL structured logging

- **Question:** What log format to use?
- **Decision:** One compact JSON object per line (JSONL), rotated daily into `logs/YYYY-MM-DD.jsonl`. Machine-parseable, append-only, easy to stream.
- **Date:** 2026-09-20
- **Status:** Accepted

## D4 — Confidence thresholds are fixed constants

- **Question:** Should confidence thresholds be configurable?
- **Decision:** Hard-coded at `0.35` (low), `0.60` (medium), `0.85` (high) for the MVP. Configurable thresholds can be added in Phase 5+ if user feedback demands it.
- **Date:** 2026-09-20
- **Status:** Accepted

## D5 — Index is a build artifact, not runtime-generated

- **Question:** Should the index be built on every hook call or cached?
- **Decision:** Build once via `npm run build-index` and persist to `data/skill-index.json`. The hook reads the cached index. This avoids recomputing on every authoring event and keeps the hook fast (< 50 ms target).
- **Date:** 2026-09-20
- **Status:** Accepted

## D6 — Mock skill fixtures live in `data/mock-skills/`

- **Question:** Where do sample skill manifests go?
- **Decision:** `data/mock-skills/*.json`, one file per skill, named `<slug>.json`. This is the canonical test corpus for benchmarks and index building.
- **Date:** 2026-09-20
- **Status:** Accepted

## D7 — Phase-gated progression enforced by documentation, not tooling

- **Question:** How do we prevent agents from skipping phases?
- **Decision:** `AGENTS.md` mandates reading `docs/current-state.md` and `docs/implementation-plan.md` before any change. The project manager reviews progress at each phase boundary. No automated gate exists yet (Phase 0 spike).
- **Date:** 2026-09-20
- **Status:** Accepted

## D8 — Results returned to ZCode are a shortlist, not a full ranking

- **Question:** Should we return all matching skills or a capped shortlist?
- **Decision:** Return `topK` (default 5) results. Full ranking is computationally cheap but UX prefers a concise shortlist. The `meta.totalMatched` field preserves visibility into total hit count.
- **Date:** 2026-09-20
- **Status:** Accepted

## D9 — Modular layering: core / config / utils split

- **Question:** How should the codebase be organized for future extensibility?
- **Decision:** Group logic by concern: `src/core/` for domain engines (retriever, reranker, embeddings, routing, telemetry), `src/config/` for tunable parameters and env overrides, `src/utils/` for cross-cutting helpers (text, fs, time). `src/index.mjs` serves as the single public API surface. This lets future phases swap out individual engines (e.g. embeddings) without touching others.
- **Date:** 2026-09-21
- **Status:** Accepted

## D10 — Environment-variable configuration for all tunables

- **Question:** How should runtime constants be made configurable without code changes?
- **Decision:** All BM25, embedding, reranker, routing, confidence, and hook parameters are exposed as `SKILL_ROUTER_*` env vars with validated ranges. `src/config/env.mjs` merges overrides into defaults at import time. This satisfies the constraint of zero-config defaults while allowing tuning in production.
- **Date:** 2026-09-21
- **Status:** Accepted

## D11 — Zero-dependency embedding via character + word n-gram hashing

- **Question:** How to implement semantic embeddings without external ML dependencies?
- **Decision:** Use FNV-1a feature hashing to map character 2-grams, 3-grams, word tokens, and word bigrams into a 256-dimensional Float32Array. Vector is normalized to unit length; cosine similarity equals dot product. This approach is deterministic, O(n) in text length, requires no training data, and adds zero dependencies.
- **Rationale:** Phase 1.2 targets "local, zero-dependency" embeddings. Learned embeddings (e.g., sentence-transformers) would violate the zero-deps constraint. Feature hashing achieves reasonable lexical/semantic discrimination on small corpora (< 200 skills) at 2–3 ms per query.
- **Date:** 2026-09-21
- **Status:** Accepted

## D12 — Hybrid retrieval uses RRF with BM25 tiebreaker

- **Question:** How to fuse BM25 and embedding scores without losing BM25 precision?
- **Decision:** Reciprocal Rank Fusion (k=60) over both source rankings. When RRF scores tie (within 1e-10), prefer the result with the higher BM25 rank. The embedding component provides semantic recall; BM25 precision is preserved by the tiebreaker.
- **Rationale:** Pure RRF can promote embeddings-only results that out-rank strong BM25 matches. The tiebreaker ensures BM25 remains the primary signal while gaining semantic recall from embeddings (19/20 → 95% vs 18/20 → 90% on Phase 0 set).
- **Date:** 2026-09-21
- **Status:** Accepted

## D13 — Embeddings persisted to data/skill-embeddings.json

- **Question:** Where to persist pre-computed embeddings?
- **Decision:** `npm run build-index` writes both `data/skill-index.json` (skill objects) and `data/skill-embeddings.json` (name → Float32Array as JSON array). The hybrid retriever builds the Map in-memory from SKILL.md files if no pre-built index is passed.
- **Rationale:** Keeps the index self-contained; embedding build takes 3–5 ms for the full corpus (10 skills). Persisting avoids redundant recomputation at runtime.
- **Date:** 2026-09-21
- **Status:** Accepted
