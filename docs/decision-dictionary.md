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
