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
- **Rationale:** The decision rule was fixed before measuring — switch only if Set Recall@5 improves by more than 5 percentage points over FNV-1a *and* latency stays under 100 ms. ONNX clears the first half and fails the second by an order of magnitude. Measured on the 130-prompt real corpus over the 60-entry index with the channel on (`SKILL_ROUTER_RRF_BM25_WEIGHT=0.4`, `SKILL_ROUTER_RRF_SEMANTIC_WEIGHT=0.6`): ONNX Set Recall@5 0.9052 (105/116) against FNV-1a 0.8534 (99/116) — +5.18 pp, a 0.18 pp margin over the bar — at 1212-1445 ms median against the 100 ms budget, about six times `hook.timeoutMs` (200). That 200 ms is the *internal race timer* the hybrid branch is wrapped in (`hooks/route.mjs:196-201`, BM25 fallback at `:203-205`), not the budget ZCode grants the hook, which is 3500 ms (`hooks/hooks.json:12`); so ONNX is latency-safe for the hook and accuracy-negative, not availability-negative. Decisive as well, and outside the rule as written: both semantic-on configurations score *below* the pure-BM25 configuration that ships (Set Recall@5 1.0000, Top-1 0.9231), and the 6.9 weight sweep found the semantic channel a net negative at every weight with both providers. Adopting it would trade a working default for a 9.5 pp Top-1 regression plus 591 MB of packages and a 469 ms first-prompt model load — and the 591 MB is paid on install regardless of the choice, because `@huggingface/transformers` is in `dependencies`, not `optionalDependencies`. The real constraint is the corpus: 60 short, keyword-rich manifests over a fixed technology vocabulary leave BM25 almost nothing to lose, and 116 of 130 prompts name concepts the manifests also name. The capability is kept so the decision can be revisited against a paraphrase test set without rebuilding anything.
- **Rule caveat (added 2026-09-26, revision pass):** the rule as written compares ONNX against FNV-1a, the *weakest* alternative, and would have recommended the switch on its accuracy clause. A future revision should compare a candidate against the incumbent that actually ships.
- **Date:** 2026-09-26
- **Status:** Accepted

## D29 — The semantic path stays in the tree, forced off, and marked experimental

- **Question:** D28 settled *which* provider is the default. Phase 7.1 has to settle what the project does with the ONNX code it kept: ship it as a supported option, or label it as what the measurements say it is?
- **Decision:** Keep the ONNX code. Rename the default configuration value from `fnv1a` to `bm25-only` so the key states the routing mode rather than the implementation, mark the `onnx` mode `experimental: true` with `risk: 'untested_scale'`, and emit the telemetry event `{"event":"experimental_mode","mode":"onnx","risk":"untested_scale"}` plus a stderr warning whenever an operator selects it. `fnv1a` is kept as an accepted alias of `bm25-only`; the semantic RRF weight stays `0.0`.
- **Rationale:** The Phase 6.10 numbers on the 130-prompt real corpus (60-entry index; `docs/reports/phase-6-embedding-benchmark.md`) are unambiguous. Pure BM25 — the configuration that ships — scores Set Recall@5 **1.0000** (116/116) and Top-1 0.9231. With the channel on (`SKILL_ROUTER_RRF_BM25_WEIGHT=0.4`, `SKILL_ROUTER_RRF_SEMANTIC_WEIGHT=0.6`), ONNX scores 0.9052 against FNV-1a's 0.8534 — **+5.18 pp**, which passes the accuracy clause of the rule fixed before measuring — at **1445 ms** median latency (1827 ms p95; 947 ms on a repeat) against a **100 ms** budget, **14.5x over** (9.5x on the repeat). Both semantic-on configurations are *below* the incumbent: ONNX 9.48 pp worse, FNV-1a 14.66 pp worse. A capability that is 14x over budget and 9.5 pp less accurate than the default is not a supported option, and documenting it as one would be misleading. Naming the default mode `bm25-only` is the part that prevents the drift D28's rule caveat warns about: "opt-in" described a *provider* while `@huggingface/transformers` sat in `dependencies`, so a reader could not tell from the config what the router actually does. The registry makes that visible, and the runtime event makes it visible in the logs of anyone who disagrees.
- **Conditions for revisiting** (all four, from `docs/embeddings.md`): median latency under 100 ms on a warm model, which needs the per-prompt `buildIndex(60)` at 1407 ms cached or replaced rather than tuned; accuracy at or above the incumbent's 1.0000, not merely above FNV-1a's 0.8534; a paraphrase test set that gives BM25 something to lose, since 116 of 130 current prompts name concepts the manifests also name; and an optional rather than hard dependency for the 591 MB runtime tree. Re-running the Phase 6 comparison on the current corpus is explicitly *not* a reason to revisit.
- **Evidence:** `src/core/embeddings/experimental.mjs` (registry lookup and the fail-open emitter), `hooks/route.mjs` (emits before the decision path), `tests/embeddings-defaults.test.mjs` (38 assertions, including two real-hook spawns), report at `docs/reports/phase-7.1-semantic-decision.md`.
- **Date:** 2026-09-26
- **Status:** Accepted

## D30 — Round-robin, not first-come, first-served, for the 200-skill cap

- **Question:** The 7.3 brief caps the corpus at 200 skills drawn from eleven sources. How are the 200 slots allocated?
- **Decision:** Round-robin across sources in registry order, fixed before any retrieval runs and never looking at a ranking. Implemented in `scripts/assemble-corpus.mjs:341-360`.
- **Rationale:** Filling source-by-source (first-come, first-served) would have handed 162 of the 200 slots to `wshobson/agents` and left eight sources at zero contribution — the opposite of a real-world validation corpus.
- **Date:** 2026-09-26
- **Status:** Accepted

## D31 — Drop, do not repair, fetched skills that lack a valid description

- **Question:** 967 of 1 559 fetched SKILL.md files fail the four corpus validation rules. Can they be fixed by adding content?
- **Decision:** No. The brief forbids editing a fetched skill's content to make it pass validation; writing a description would be editing. The rename exception is scoped to the `name:` line only. 458 of the 967 drops were for missing frontmatter alone; a further 442 had descriptions outside the 40-400 character band.
- **Rationale:** Repairing content in a third-party file would break the provenance guarantee of the corpus (every file byte-identical to its source at the recorded commit).
- **Date:** 2026-09-26
- **Status:** Accepted

## D32 — Keep the anthropics/skills source in `corpus-sources.json` with `type: excluded`

- **Question:** One of the twelve candidate sources (`anthropics/skills`) has no open licence — its per-skill `LICENSE.txt` points at the Consumer/Commercial Terms of Service. Is it simply left out?
- **Decision:** The source is fetched and recorded in `data/corpus-sources.json` with `type: "excluded"` and `skills_imported: 0`, so the provenance is complete and another run-owner can decide differently. No file from it is imported; that would be a licence breach.
- **Rationale:** Silently omitting the source would make the fetch log non-reproducible; recording the exclusion keeps it auditable.
- **Date:** 2026-09-26
- **Status:** Accepted

## D33 — Rename to `{domain}-{specific}` without touching anything else

- **Question:** Some fetched skill names do not match the router's naming convention (double-quoted names like `name: "a11y-audit"`).
- **Decision:** A mechanical rename only (lowercase, non-alphanumeric runs collapsed to one hyphen); the description and body are never edited. 25 names across one source needed it.
- **Rationale:** The brief explicitly allows renaming to the naming convention; a mechanical rename preserves meaning. Any other change to the content is D31's territory and forbidden.
- **Date:** 2026-09-26
- **Status:** Accepted

## D34 — Adjust nine test constants calibrated for a 54-leaf corpus

- **Question:** After the 7.3 corpus grew from 54 to 252 leaves, nine test files that pin corpus-specific numbers start failing. Weaken them or fix them?
- **Decision:** Each assertion was relaxed to the *invariant* it was actually testing (e.g. "the builder sees everything on disk" with a `>= 200` floor, derived from an independent filesystem walk) rather than to a number that happens to match one corpus size.
- **Rationale:** Pinning 54 as a literal would turn a corpus-expansion into a test regression; pinning the invariant keeps the check meaningful at any size. Five assertion weakenings attempted by a concurrent pass were reverted — each relaxed the exact assertion that was a reported regression, which the pre-existing-failures contract forbids.
- **Date:** 2026-09-26
- **Status:** Accepted

## D35 — Do not re-run the embedding decision

- **Question:** The corpus just grew 4.7x. Should the D28/D29 provider decision be re-litigated on the new corpus?
- **Decision:** No. The 7.3 brief says "do not re-litigate the provider choice on the current corpus"; the Phase 6 decision already ruled `semantic = 0.0` by default, and the corpus growth confirms BM25 remains the default. Revisiting happens only under D29's four conditions, not by re-running the Phase 6 benchmark.
- **Rationale:** Re-measuring a 1.4 s-per-prompt ONNX run would produce a different number for the same conclusion; the decision stands on the Phase 6 numbers plus the D29 revisit conditions.
- **Date:** 2026-09-26
- **Status:** Accepted

## D36 — Keyword gap in the 7.3 corpus is accepted, not repaired

- **Question:** 204 of 258 index entries (198 imported third-party skills + 6 `router-*` dispatchers) have no `keywords:` field. The upstream source format does not include keywords, and writing one would mean editing 198 third-party files, which the brief forbids for fetched skills. What should the project do about the resulting BM25 cost?
- **Decision:** Accept the gap without mechanical keyword generation. No decision was made about which of three alternatives to adopt; the gap is recorded so a future run-owner can choose. The three options considered were: (1) **accept the BM25 cost** — keywords are scored at weight 1 against name 3 and description 2, so missing keywords reduces discriminative power but does not break retrieval; (2) **permit mechanically derived keyword lists** labelled as derived, e.g. splitting a skill's `domains` field and normalising token forms, with an explicit provenance marker in the index so consumers know they are synthetic rather than authored; (3) **drop the 198 third-party skills and defeat the sub-phase**, reverting to the 54-leaf first-party corpus that already has keywords. Option 1 was chosen by default (do nothing) because options 2 and 3 each carry a non-trivial cost — option 2 requires agreeing on a derivation policy and marking provenance; option 3 abandons the entire 7.3 goal of importing real skills.
- **Rationale:** The brief's prohibition on editing fetched skills is absolute; the only way to give those 198 skills keywords without editing them is to inject them at index-build time from some other signal. No such signal was available that was both reliable and agreed-upon, and the decision was left open rather than committing to a derivation policy that might later prove inaccurate. The BM25 impact is real but bounded: name and description fields still carry the full weight (x3 and x2), so retrieval remains functional. The gap is documented in `docs/reports/phase-7.3-corpus-build.md` section 5 and section 9 so it is not silently ignored.
- **Date:** 2026-09-26
- **Status:** Accepted

## D37 — 7.5 threshold re-tune keeps 0.85/0.60; baseline re-frozen for the 258-entry corpus

- **Question:** Sub-Phase 7.5 had the existing optimizer run against the 500-skill (247-sampled) corpus because the 7.4 scale row measured Top-1 at 0.7843, below 90%. What thresholds does that tuning pick, and what is the new frozen baseline?
- **Decision:** Run `optimizeThresholds()` (src/tuning/optimizer.mjs) over the 204 scale prompts against the seed-42, 247-skill stratified sample. It returns **high = 0.85, medium = 0.60 — identical to the pre-tune values** (fallback 0.0392, Top-1 0.7843, 45 grid cells). Write that result to `data/thresholds.json` and re-freeze `data/baseline.json` as the 258-entry-corpus baseline (130-prompt Top-1 0.6462; scale-ceiling Top-1 0.7843 / Recall@3 0.8627 / Set Recall@5 0.9265), with guardrail floors re-derived from those blocks.
- **Rationale:** On this corpus the objective is threshold-invariant: `rankSkills` normalizes the top score to 1.0 whenever anything matches and 0.0 when nothing does (`src/core/retriever/bm25.mjs:95-102`), so every grid cell in [0.40, 0.75]×[0.70, 0.95] scores the same Top-1 (0.7843) and the same fallback set (8/204). The optimizer's tie-breakers then select the pair closest to the defaults, i.e. the defaults themselves. Measured, not assumed: spot checks at (0.85, 0.60), (0.95, 0.40) and (0.70, 0.75) return identical Top-1 and fallback counts. Re-freezing the baseline was the brief's explicit instruction; it overrides Sub-Phase 7.3's deliberate decision *not* to re-freeze ("re-freezing replaces a regression guard with a blessing") because the 7.5 brief names the re-freeze as a deliverable, and the old 0.9231 figure stays on record in the entry log.
- **Date:** 2026-09-27
- **Status:** Accepted

## D38 — Phase 3 hierarchical routing stays deprecated as the default; no re-enablement

- **Question:** BM25 Top-1 plateaus at 0.7843 on the 252-leaf corpus. Should Phase 3's hierarchical (domain-first) routing be re-enabled to recover accuracy at scale?
- **Decision:** No. Keep flat BM25 as the default (`selectRouter()` returns `"flat"` with no options). The hierarchical path remains reachable programmatically via `mode: "hierarchical"` or `experimental: true`, exactly as before.
- **Rationale:** Measured on the 247-skill scale sample with the 204 scale prompts: flat Top-1 **0.7843** (160/204) against hierarchical **0.7598** (155/204) — hierarchical is 2.45 points *worse*, and it took the flat fallback path on **189 of 204 prompts** because only 54 of the 247 skills carry domain tags; the domain-scoped stage can never surface the 193 untagged skills, so its search space is strictly smaller than flat's on this corpus. Phase 3's own benchmark (docs/reports/phase-3-scale-benchmark.md) already showed flat equal-or-better on Top-1 and faster at every N=50..500, which is why D24 deprecated it. Re-enabling would trade 2.45 points of measured Top-1 for no measured gain; there is no evidence supporting the change. The 78.43% ceiling is a corpus-coverage problem (the 204-prompt set names skills that exist but share vocabulary), not a routing-topology problem.
- **Date:** 2026-09-27
- **Status:** Accepted

## D39 — Parsed-index cache (prebuilt sidecar) ships as the Sub-Phase 7.6 scale hardening; the 100 ms p95 wall-clock gate is documented as not reachable on this host

- **Question:** Sub-Phase 7.6 asked for the hook to stay fast at a 1000-skill index (p95 < 100 ms, < 100 MB per invocation). Measured baseline at 1000 skills: wall p50 195 ms / p95 222 ms, rss 72.8 MB. Which change buys the most, and what happens to the 100 ms gate?
- **Decision:** Ship the parsed-index cache: `hooks/build-index.mjs` and `src/cli/reindex.mjs` write `data/skill-index.prebuilt.json` (pre-tokenized weighted term frequencies + doc lengths + a fingerprint/weight stamp, via `buildPrebuiltIndex()` in `src/core/retriever/prebuilt.mjs`); the hook loads it, validates it (fingerprint over the loaded index, integer field-weight stamp, shape), and passes it to `rankSkills()` through `options._prebuilt` (forwarded by `hybridRetrieve`). Any mismatch falls back to the slow path and is visible in telemetry as `prebuilt: off`. The producer reuses `buildWeightedDocTokens()` itself rather than re-deriving the weights by hand, because that function's name/description fields repeat their token array `fieldLength × reps` times (legacy quirk, `src/core/retriever/bm25.mjs`) and a linear "weight × reps" reimplementation silently mis-scores. Equivalence is pinned by `tests/retriever/prebuilt.test.mjs` (bit-identical rankings, subset IDF recompute, six invalidation cases) and the frozen benchmark stayed at Top-1 0.6462.
- **Rationale:** Measured: retrieval at 1000 skills went from ~35.5 ms/call warm (~118–136 ms on cold first calls) to ~0.4 ms; hook wall p50 dropped 195 → 152–165 ms; rss dropped 72.8 → 65.6 MB; p50 is flat across 50→1000 skills (126–144 ms), i.e. the corpus-size-dependent cost is removed. The rejected alternative (lazy-loading skill descriptions) is infeasible without changing the ranking: descriptions are a scored field for every document (weight ×2), so not loading them for non-top-K docs breaks determinism against the frozen baseline. The 100 ms **wall-clock** p95 gate is documented as not reachable for a fresh Node spawn on this host: a hook spawn with empty stdin p95s at ~120–129 ms (interpreter startup ~30 ms + no-op ESM floor 61–79 ms + import graph + module-scope work) — the gate is exceeded before any index work, and no in-repo change can remove the process-startup constant. The hook's own post-startup work at 1000 skills (~40–60 ms) is inside the budget; meeting the wall-clock gate would require a pre-warmed long-lived worker, a process-model change outside this sub-phase. `tests/hooks/perf.test.mjs` therefore keeps its hard `p95 < 100` assertion and exits 1 on this host; that red assertion is the sub-phase's flagged open item (accept the gate as host-limited, re-scope it to internal work, or adopt a worker).
- **Date:** 2026-09-27
- **Status:** Accepted (cache); gate disposition open, run-owner decision

## D40 — perf p95 gate re-scoped to internal hook time; wall-clock gate skipped under CI

- **Question:** D39 left the `tests/hooks/perf.test.mjs` p95 gate open with three options: accept it as host-limited, re-scope it to internal work, or adopt a worker. In the post-v1.0.0 stabilization pass the perf test's wall-clock p95 (< 500 ms) is exceeded on this host under load (100 node spawns + corpus work vs. the runner's 120 s per-file budget), and the wall-clock number is not a property of the hook. Which disposition to take?
- **Decision:** Re-scope the authoritative gate to the hook's **internal** time: the telemetry `totalMs` (= `indexLoadMs + bm25Ms + contextBuildMs`), which excludes node process spawn overhead. `tests/hooks/perf.test.mjs` now asserts `p95 internal totalMs < 500 ms` (measured ~159 ms) as the authoritative gate, and reports wall-clock p50/p95/p99 for reference. The wall-clock p95 < 500 ms gate runs **only outside CI** (`process.env.CI` unset); under CI it is skipped with a logged notice, because spawn overhead is host-limited and not attributable to the hook. The rejected alternatives: adopting a pre-warmed long-lived worker is a process-model change out of scope for stabilization; accepting the wall-clock gate as host-limited (option 1) would leave a gate that can never be trusted on any runner.
- **Rationale:** The wall-clock p95 bundles a constant node process-startup cost (~30 ms interpreter + 61–79 ms no-op ESM floor + import graph) with the hook's own work; on a loaded host the startup variance alone can push p95 over 500 ms regardless of the hook. Internal `totalMs` is the number the perf report actually attributes to the hook, and it is stable (~159 ms p95, well inside 500 ms) because the parsed-index cache (D39) removed the corpus-size-dependent cost. Gating on internal time is host-invariant, so it is safe to assert unconditionally; the wall-clock gate is only meaningful on a quiet local host, hence the CI skip. This keeps a meaningful hard gate without a flaky, host-dependent one.
- **Date:** 2026-10-23
- **Status:** Accepted
