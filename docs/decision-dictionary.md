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
- **Decision:** Build once via `node hooks/build-index.mjs` and persist to `data/skill-index.json`. The hook reads the cached index. This avoids recomputing on every authoring event and keeps the hook fast (< 50 ms target).
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

## D14 — Optional synonym expansion via --expand flag

- **Question:** Should query expansion improve lexical recall by adding synonyms?
- **Decision:** Add optional synonym expansion via `--expand on|off` flag in the benchmark. Expansion is opt-in and defaults to off (no change to baseline BM25 behavior). The expander (`src/core/retrieval/expander.mjs`) applies IDF filtering (MIN_IDF_THRESHOLD=0.8), a cap of MAX_EXPANDED_TOKENS=3, and replicates original tokens 3x vs expanded tokens 1x in the BM25 query array.
- **Rationale:** Synonym expansion was evaluated against the 130-prompt real corpus. BM25 baseline remains 90% Top-1 with --expand off. With --expand on, Top-1 drops to 80% because low-IDF synonyms add noise that dilutes discriminative signal. The feature is preserved as an opt-in experiment; future work can tune thresholds or use edit-distance matching for more precise expansions. Curated synonym pairs live in `data/synonyms-curated.json` (54 entries across domain terms, abbreviations, and framework aliases).
- **Date:** 2026-09-22
- **Status:** Accepted

## D15 — Query cache keyed by index fingerprint

- **Question:** How to cache route plans without serving stale results after an index rebuild?
- **Decision:** Cache key = `{sha256(normalizedQuery)}:{indexFingerprint}` where the fingerprint is an FNV-1a 64-bit hash of the sorted skill name list. Any `build-index` call recomputes the fingerprint, causing `QueryCache.rebuild()` to invalidate all entries. TTL is 5 minutes as a secondary invalidation mechanism.
- **Rationale:** Simple string-keyed caching would serve stale results indefinitely after a rebuild. Fingerprint-based keying ensures correctness without requiring explicit cache-clear hooks. The 5-minute TTL handles the edge case where the index file is rebuilt while the process is still running but the fingerprint hasn't changed (e.g., same skills reordered).
- **Date:** 2026-09-22
- **Status:** Accepted

## D16 — Paragraph-safe context truncation

- **Question:** How to truncate skill content to fit a character budget without breaking readability?
- **Decision:** Use `truncateAtParagraph()` which splits on double-newline boundaries (`\n\n`). Never splits mid-paragraph. The budget manager (`fitWithinBudget`) distributes the total budget equally across selected skills with a per-skill floor of 500 characters. If the budget is tight, skills below the floor are kept at minimum and larger skills absorb the excess.
- **Rationale:** Hard character truncation mid-word produces garbled markdown that confuses the model. Paragraph-safe truncation preserves structural integrity of headings, code blocks, and prose. Equal distribution with a floor ensures every skill gets at least a usable minimum.
- **Date:** 2026-09-22
- **Status:** Accepted

## D17 — Analytics preserve privacy via SHA-256 hashing

- **Question:** Should raw prompts be stored in analytics logs?
- **Decision:** No. Raw prompts are hashed with SHA-256 before being stored or displayed in analytics reports. The hash is collision-resistant and irreversible, making it impossible to reconstruct the original prompt from the logged data. Top-10 most frequent prompt hashes are shown; no raw text appears anywhere.
- **Rationale:** Prompts may contain sensitive project information (API keys, proprietary logic, personal data). Hashing eliminates this risk while preserving the ability to detect recurring query patterns. This aligns with the project's zero-secrets principle and makes the plugin safe for public repos.
- **Date:** 2026-09-22
- **Status:** Accepted

## D18 — Adaptive thresholds loaded from data/thresholds.json

- **Question:** Should confidence thresholds be hardcoded or data-driven?
- **Decision:** Load thresholds from `data/thresholds.json` (produced by `src/tuning/optimizer.mjs`) at module load time in `src/config/defaults.mjs`. Fall back to hardcoded defaults (high=0.85, medium=0.60) if the file is absent or malformed. The optimizer runs a grid search over 45 (high, medium) pairs on the benchmark corpus and writes the optimal pair to the file.
- **Rationale:** Hardcoded thresholds work well for the initial corpus but will drift as skills are added or removed. Data-driven thresholds adapt to the current corpus distribution. The fallback ensures the system never starts with invalid thresholds even if the optimizer hasn't been run yet.
- **Date:** 2026-09-22
- **Status:** Accepted

## D19 — Domain registry auto-populated from skill corpus

- **Question:** Who maintains `data/domains/<name>/meta.json` files?
- **Decision:** `hooks/build-index.mjs` auto-populates domain metadata from the skill corpus during every index build. For each domain found in skills, it merges existing metadata with aggregates from the corpus (union of all keyword sets, combined descriptions, skill counts). If no `meta.json` exists, it creates one. Users can manually edit domain metadata; changes are preserved on rebuild unless a new skill changes the aggregated values.
- **Rationale:** Manual domain management is error-prone and doesn't scale. Auto-population ensures the hierarchical router always has current metadata without requiring users to maintain it separately. Manual edits are preserved, giving users control over domain descriptions and keyword priorities.
- **Date:** 2026-09-22
- **Status:** Accepted

## D20 — Quality validation enforced at import and build time

- **Question:** Should invalid skills be accepted into the corpus?
- **Decision:** No. The `import` CLI command runs `validateSkill()` on every candidate before copying it to `data/skills/`. Invalid skills are rejected with a detailed report. The `validate` CLI command can be run at any time to audit the entire corpus. Skills that fail validation are not indexed and do not appear in retrieval results. A fix script (`scripts/fix-skill-quality.mjs`) is provided to automatically correct common issues (name prefix, content padding).
- **Rationale:** Poor-quality skills degrade retrieval accuracy by introducing noise into the index. Enforcing validation at import time prevents bad data from entering the corpus. The fix script reduces the burden on skill authors by automating common corrections.
- **Date:** 2026-09-22
- **Status:** Accepted
## D21 — Windows npm PATH constraint

- **Date:** 2026-09-22
- **Context:** On this Windows machine, npm is not on the subprocess PATH. Automation scripts that spawn child processes cannot rely on npm test, npm run, or npx.
- **Decision:** All automation must use node <file> directly. Created scripts/run-all-tests.mjs as a replacement for npm test. Documented in AGENTS.md.
- **Rationale:** The ZCode plugin environment runs Node.js scripts directly; npm is a wrapper that depends on PATH resolution which behaves differently on Windows in subprocess contexts.
- **Status:** Active

## D23 — Skill disable via mirror directory removal (best-guess)

- **Question:** How should users disable individual skills in the ZCode mirror?
- **Decision:** Since ZCode has no documented per-skill disable API, implement a filesystem-based workaround: `disableSkill()` removes the managed mirror directory (or writes a shadow `SKILL.md` with `disabled: true` frontmatter). The skill disappears from ZCode's discovery because the `SKILL.md` is gone. Re-enable by re-copying from the project source. Registry persisted in `.skill-router-disabled.json` at the project root.
- **Rationale:** ZCode discovers skills purely by filesystem presence in configured scan paths (`~/.zcode/skills/`, `<repo>/.zcode/skills/`). There is no `disabled: true` frontmatter flag, no `.zcode-skill-state.json`, and no skill-preferences registry — confirmed by examining `~/.zcode/cli/config.json`, `~/.zcode/v2/setting.json`, the zcode-guide SKILL.md, and the actual 53 skill directories in `~/.zcode/skills/`. The mirror-deletion approach is safe: only directories with `.skill-router-meta.json` are touched. User-created skills are never modified.
- **Date:** 2026-09-23
- **Status:** Accepted

## D22 — Skill sync uses SHA-256 content hashing, not path or size

- **Question:** How to detect changes between project skills and the ZCode mirror?
- **Decision:** Compute SHA-256 of the full SKILL.md file content (including frontmatter). Two skills with identical content hash are classified as `unchanged` regardless of when they were last written. Differences in hash classify as `update`; presence in one side only classifies as `add` or `remove`.
- **Rationale:** Content-hash comparison is order-independent, handles renames correctly (a renamed file has different path but same hash → update), and avoids false positives from metadata-only changes (e.g., filesystem timestamps). SHA-256 is collision-resistant and available in Node.js built-ins with zero dependencies. Path-based or size-based comparison would miss content changes that happen to produce the same file size, or produce false updates when only timestamps differ.
- **Date:** 2026-09-23
- **Status:** Accepted

## D24 — Hierarchical routing deprecated in favor of flat BM25

- **Question:** Should hierarchical (domain-first) routing be the default for large corpora?
- **Decision:** No. `src/routing/selector.mjs` always selects `"flat"` as the default strategy regardless of corpus size. Hierarchical remains available via `--experimental` flag but is considered deprecated.
- **Rationale:** Phase 3 scale benchmark (docs/reports/phase-3-scale-benchmark.md) showed flat BM25 is faster at every corpus size (2ms vs 4ms at N=50, 15ms vs 17ms at N=500), with equal or slightly better Top-1 accuracy at all scales. The previously assumed inflection point at N=100 (auto-enable hierarchical) was not supported by data. The `--hierarchical` CLI flag still works for explicit opt-in.
- **Date:** 2026-09-23
- **Status:** Accepted

## D25 — SLM is disabled by default

- **Question:** Should the hybrid SLM+BM25 routing path be active by default?
- **Decision:** No. `slm.enabled` defaults to `false` in `src/config/defaults.mjs`. SLM routing is opt-in via `SKILL_ROUTER_SLM_ENABLED=true`.
- **Rationale:** Phase 2 benchmark results (docs/reports/phase-2-slm-benchmark.md) showed Qwen2.5-0.5B underperforms BM25 on this corpus. SLM-Only Top-1 = 20.00% vs BM25-Only Top-1 = 46.67%; Set Recall = 0.0972 vs 0.7000. Hybrid mode matches BM25 on Top-1 but degrades Set Recall (0.5750 vs 0.7000) and adds ~1.5 s latency per prompt — exceeding the hook timeout budget of 200 ms. The 0.5B model is too small for reliable multi-skill selection. Larger models (1.5B+) should be evaluated before enabling SLM. The `tests/slm-benchmark/runner.mjs --slm` flag forces SLM-enabled mode for comparison.
- **Date:** 2026-09-23
- **Status:** Accepted

## D26 — Both index builders share one default project corpus (`data/skills/` + `router-skills/`)

- **Question:** Should `reindex` and `hooks/build-index.mjs` each define their own default source list?
- **Decision:** No. Both now resolve the default project corpus through `projectSources()` in `src/index/sources.mjs`: `data/skills/` (54 leaf skills) plus `router-skills/` (6 `router-*` dispatchers), both tagged `source: "project"`. `--skills-dir` remains the explicit single-directory escape hatch; `SKILL_ROUTER_SOURCES` remains the explicit env override for `build-index`.
- **Rationale:** `reindex` previously defaulted to `data/skills` only, so running it rewrote `data/skill-index.json` with 54 entries and silently dropped the 6 router entries that the explicit `$mention` path and the tuning/optimizer corpus depend on. The generated index then depended on which builder ran last, which failed `tests/tuning/optimizer.test.mjs` after Sub-Phase 6.4 ("full index has 60 entries ... got 54", "leaf-only top1 0.9077 > full-index top1 0.9077"). Sharing one function makes the divergence structurally impossible and is regression-tested by `tests/cli/reindex.test.mjs` (12 assertions; 7 fail without the fix).
- **Date:** 2026-09-25
- **Status:** Accepted

## D27 — Adaptation-loop fixtures are derived from the live default and drift-gated

- **Question:** The adaptive feedback loop was built in Phase 5 against FNV-1a embeddings. Sub-Phase 6 replaced the backend behind `embeddings.provider` and re-froze the RRF weights. Should the loop be revalidated against hand-written fixtures, against the shipped configuration, or by raising `MAX_DELTA` until tuning applies?
- **Decision:** Regenerate the provider-derived telemetry fixtures from the shipped configuration with `node scripts/regenerate-fixtures.mjs`, gate them with `--check` in `tests/tuning/adaptation-fixtures.test.mjs`, and leave `MAX_DELTA` at 0.5 so the current proposal keeps being refused.
- **Rationale:** With `embeddings.weights.semantic = 0.0` the provider is never constructed (`src/core/retriever/hybrid.mjs:137`), so the loop's input ranking is pure BM25 and is genuinely unaffected by the provider work — the regenerated fixtures reproduce `tune --analyze`'s proposal exactly (127 attributions, dominant field name 41 / description 85 / keywords 1, proposed name 2.71 / description 2.71 / keywords 0.57). Regenerating from the live configuration rather than from a static corpus is what makes that claim checkable: changing the provider or the weights now fails the gate instead of silently leaving the loop validated against a stale corpus. Raising `MAX_DELTA` was rejected because the 0.715 description delta is 43% over the limit on the field that decides most of the ranking; a refusal is the guardrail working, and `tune --apply` exits 1 without writing. `data/baseline.json` now records both measured corpora explicitly — Top-1 0.9231 over the 60-entry benchmark index and 0.9692 over the 54-leaf corpus the hook actually searches — because the guardrail's accuracy comparison is made against the former and conflating them had been the source of the ambiguity.
- **Date:** 2026-09-26
- **Status:** Accepted

## D28 — The default embedding provider stays FNV-1a; ONNX ships opt-in and inert

- **Question:** Sub-Phase 6 built a second embedding backend. Should it become the default, replacing FNV-1a?
- **Decision:** No. `embeddings.provider` stays `fnv1a` and `embeddings.weights.semantic` stays `0.0`. The ONNX provider ships complete, benchmarked, and reachable through `SKILL_ROUTER_EMBEDDING_PROVIDER=onnx` or `node hooks/build-index.mjs --provider onnx`, but the default path never constructs it (`src/core/retriever/hybrid.mjs:137`).
- **Rationale:** The decision rule was fixed before measuring — switch only if Set Recall@5 improves by more than 5 percentage points over FNV-1a *and* latency stays under 100 ms. ONNX clears the first half and fails the second by an order of magnitude. Measured on the 130-prompt real corpus over the 60-entry index with the channel on (`SKILL_ROUTER_RRF_BM25_WEIGHT=0.4`, `SKILL_ROUTER_RRF_SEMANTIC_WEIGHT=0.6`): ONNX Set Recall@5 0.9052 (105/116) against FNV-1a 0.8534 (99/116) — +5.18 pp, a 0.18 pp margin over the bar — at 1212-1445 ms median against the 100 ms budget, six times the hook's own 200 ms `hook.timeoutMs`. Decisive as well: both semantic-on configurations score *below* the pure-BM25 configuration that ships (Set Recall@5 1.0000, Top-1 0.9231), and the 6.9 weight sweep found the semantic channel a net negative at every weight with both providers. Adopting it would trade a working default for a 9.5 pp Top-1 regression plus 591 MB of packages and a 469 ms first-prompt model load. The real constraint is the corpus: 60 short, keyword-rich manifests over a fixed technology vocabulary leave BM25 almost nothing to lose, and 116 of 130 prompts name concepts the manifests also name. The capability is kept so the decision can be revisited against a paraphrase test set without rebuilding anything.
- **Date:** 2026-09-26
- **Status:** Accepted
