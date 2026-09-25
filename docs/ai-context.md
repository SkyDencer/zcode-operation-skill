# AI Context — Technical Architecture

## Overview

The Skill Router is a local ZCode plugin that improves workflow authoring UX by
surfacing the most relevant subagents (skills) at the moment a user is writing a
workflow. Instead of forcing the author to remember or scroll through a flat list
of all available skills, the router inspects the current editing context, ranks
skills by lexical relevance, and presents a concise, confidence-scored shortlist.

The system is intentionally lightweight: no external ML models, no network
calls, and no persistent state beyond the JSON skill index.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     ZCode Editor                              │
│                    (workflow authoring)                       │
└──────────────────────┬────────────────────────────────────────┘
                       │ onWorkflowAuthoring hook
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                      HOOK LAYER                                 │
│  hooks/route.mjs                                               │
│   ├─ reads stdin JSON payload                                  │
│   ├─ validates input, extracts prompt text                     │
│   ├─ truncates oversized prompts (>10KB)                       │
│   ├─ loads skill index from data/skill-index.json              │
│   ├─ wraps retrieval in QueryCache.getOrSet()                  │
│   ├─ selects routing strategy (flat by default) via selector   │
│   ├─ applies context budget (fitWithinBudget)                  │
│   └─ writes output.json + logs telemetry                       │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SRC LAYER                                  │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Loader     │  │  Score (BM25)│  │  Config / Env        │  │
│  │  (frontmatter│  │  scorer.mjs  │  │  defaults.mjs        │  │
│  │   parser)    │  │  tokenize(), │  │  env.mjs             │  │
│  │              │  │  computeIdf()│  │  (loads thresholds.  │  │
│  │              │  │  bm25())     │  │   json if present)   │  │
│  │              │  └──────────────┘  │  aliases.mjs         │  │
│  │              │                    │  (alias→router map)  │  │
│  │              │  ┌──────────────┐  └──────────────────────┘  │
│  └──────────────┘                                               │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Retriever   │  │  Selector    │  │  Explicit Router     │  │
│  │  bm25.mjs    │  │  selector.   │  │  explicit.mjs        │  │
│  │              │  │  mjs         │  │                      │  │
│  │  rankSkills()│  │  selectRouter│  │  detectExplicitSkill │  │
│  │  readSkill() │  │  (flat/hier) │  │  ROUTER_ALIASES      │  │
│  │              │  │              │  │  ROUTER_DOMAINS      │  │
│  │  Supports:   │  │  Default:    │  │                      │  │
│  │  field-weight│  │  always flat │  │  Scans for $-mentions│  │
│  │  + synonym   │  │  (bench-     │  │  Resolves to router  │  │
│  │  expansion   │  │   marked    │  │  skill name          │  │
│  │              │  │  flat is     │  │  Strips mention from │  │
│  └──────────────┘  └──────────────┘  │  cleaned prompt      │  │
│                                      └──────────────────────┘  │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Query Cache │  │  Budget Mgr  │  │  Quality Validator   │  │
│  │  query-cache │  │  manager.mjs │  │  validator.mjs       │  │
│  │  .mjs        │  │              │  │  reporter.mjs        │  │
│  │              │  │  fitWithin   │  │                      │  │
│  │  LRU + TTL   │  │  Budget()    │  │  6-field checks:     │  │
│  │  index-fp    │  │  Paragraph-  │  │  name pattern,       │  │
│  │  keyed       │  │  safe trunc. │  │  desc length,        │  │
│  │  5-min TTL   │  │              │  │  keywords count,     │  │
│  └──────────────┘  └──────────────┘  │  domains, content    │  │
│                                      │  tokens               │  │
│  ┌──────────────┐  ┌──────────────┐  └──────────────────────┘  │
│  │  Analytics   │  │  Import      │  ┌──────────────────────┐  │
│  │  reader.mjs  │  │  scanner.mjs │  │  Sync Planner        │  │
│  │  analyzer.mjs│  │  importer.mjs│  │  planner.mjs         │  │
│  │  reporter.mjs│  │  reporter.mjs│  │                      │  │
│  │              │  │              │  │  planSync():          │  │
│  │  Parse logs, │  │  scanSource()│  │  compare SHA-256     │  │
│  │  compute     │  │  importSkills│  │  hashes project vs   │  │
│  │  per-day     │  │  with validate│  │  mirror. Classify     │  │
│  │  histograms, │  │  + collision │  │  add/update/remove/   │  │
│  │  fallback    │  │  detection   │  │  unchanged/disabled   │  │
│  │  rate, top-10│  │              │  │                      │  │
│  │  skills,     │  │  Security:   │  │  ┌────────────────┐  │  │
│  │  prompt hashes│  │  path-trav  │  │  │ Sync Writer    │  │  │
│  │  (never raw) │  │  + symlink  │  │  │ writer.mjs     │  │  │
│  └──────────────┘  │  blocking   │  │  │                │  │  │
│                     └──────────────┘  │  applySync() with │  │  │
│                                       │  .skill-router-   │  │  │
│  ┌──────────────┐  ┌──────────────┐  │  meta.json guard  │  │  │
│  │  Index       │  │  Threshold   │  │  Safe mirror write│  │  │
│  │  Deduplicator│  │  Tuner       │  │  └────────────────┘  │  │
│  │  dedupe.mjs  │  │  optimizer.  │  │                      │  │
│  │              │  │  mjs         │  │  ┌────────────────┐  │  │
│  │  resolve-    │  │              │  │  │ Sync State     │  │  │
│  │  collisions()│  │  Grid search │  │  │ state.mjs      │  │  │
│  │  project     │  │  over        │  │  │                │  │  │
│  │  wins over   │  │  (high,      │  │  │ read/write      │  │  │
│  │  zcode-user  │  │   medium)    │  │  │ .skill-router-  │  │  │
│  └──────────────┘  │  pairs,      │  │  │ sync-state.    │  │  │
│                     │  objective:  │  │  │ json          │  │  │
│  ┌──────────────┐  │  max Top-1,  │  │  └────────────────┘  │  │
│  │  Disabler    │  │  fallback <  │  │                      │  │
│  │  disabler.   │  │  15%         │  │  ┌────────────────┐  │  │
│  │  mjs         │  │              │  │  │ Disabler       │  │  │
│  │              │  │  Writes      │  │  │ disabler.mjs   │  │  │
│  │  disableSkill│  │  thresholds  │  │  │                │  │  │
│  │  enableSkill │  │  to          │  │  │ Mirror mode:   │  │  │
│  │  read/write  │  │  data/       │  │  │ delete mirror  │  │  │
│  │  registry    │  │  thresholds  │  │  │ dir            │  │  │
│  │  (.skill-    │  │  .json       │  │  │ Shadow mode:   │  │  │
│  │   router-    │  │              │  │  │ write disabled │  │  │
│  │   disabled.  │  │  Writes      │  │  │ SKILL.md       │  │  │
│  │   json)      │  │  benchmark   │  │  │ (preserves     │  │  │
│  └──────────────┘  │  data        │  │  │ real dir)      │  │  │
│                     └──────────────┘  │  └────────────────┘  │  │
│                                       └──────────────────────┘  │
│  ┌──────────────┐  ┌──────────────┐                               │
│  │  Embeddings  │  │  Reranker    │  ┌──────────────────────┐  │
│  │  engine.mjs  │  │  engine.mjs  │  │  Logger            │  │
│  │  (FNV-1a     │  │  features.mjs│  │  logger.mjs        │  │
│  │   256-dim)   │  │              │  │  Structured JSONL   │  │
│  └──────────────┘  └──────────────┘  │  logs/*.jsonl       │  │
│                                       └──────────────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Domain      │  │  Query Cache │  │  CLI (bin/)          │  │
│  │  Registry    │  │  query-cache │  │  list, add, remove,  │  │
│  │  .mjs        │  │  .mjs        │  │  validate, reindex,  │  │
│  │              │  │              │  │  benchmark, stats,   │  │
│  │  populate    │  │  LRU + TTL,  │  │  analytics, import,  │  │
│  │  Domains from│  │  5-min TTL,  │  │  sync, sources,      │  │
│  │  skills      │  │  fingerprint │  │  verify, doctor,     │  │
│  │  match-      │  │  keyed       │  │  help                │  │
│  │  DomainsTo   │  │              │  │                      │  │
│  │  Query()     │  │  Key:        │  │  18 subcommands      │  │
│  └──────────────┘  │  sha256+fp   │  └──────────────────────┘  │
│                     └──────────────┘                               │
└──────────────────────┬──────────────────────────────────────────┘
                       │ result
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ZCode UI / Output                            │
│         (suggested skill shortlist + confidence)                │
│         written to .zcode/output.json                           │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### Hook (`hooks/route.mjs`)

- Entry point invoked by ZCode on every authoring event.
- Reads the full stdin JSON payload (prompt, cwd).
- Validates input: empty input, malformed JSON, missing fields all fail open (exit 0).
- Truncates prompts exceeding `maxPromptLength` (default 10240 chars).
- Loads `data/skill-index.json`; fails open if missing.
- **Explicit detection** — calls `detectExplicitSkill(prompt, index)` before retrieval. If a `$`-mention is found, the prompt is stripped and routed via `routeWithExplicit()` which scopes BM25 to the router's domain. See `src/core/routing/explicit.mjs` and `src/config/aliases.mjs`.
- **Implicit routing** — when no explicit match, builds a leaf-only index (filters out `router-*` entries) and runs pure BM25 (`rankSkills`) unless SLM is enabled via `SKILL_ROUTER_SLM_ENABLED=true`.
- Creates a `QueryCache` keyed by index fingerprint + query hash.
- Reads full SKILL.md content for top-ranked skills via `readSkillContent()`.
- Fits selected skills into the context budget via `fitWithinBudget()`.
- Logs retrieve, cache, budget, and route events to JSONL (including mode, tier, slmEnabled, routerMatched).
- Writes `output.json` with `hookSpecificOutput.additionalContext` and `RoutePlan`.

### Index Builder (`hooks/build-index.mjs`)

- Reads all `.md` skill manifests from `data/skills/` recursively.
- Parses YAML-like frontmatter (name, description, keywords, domains, version).
- Builds a flat array of skill objects.
- Computes FNV-1a n-gram embeddings and persists to `data/skill-embeddings.json`.
- Auto-populates domain metadata in `data/domains/<domain>/meta.json`.
- Writes `data/skill-index.json`.
- When multiple sources are configured (via `SKILL_ROUTER_SOURCES`), tags skills by source and resolves name collisions (project wins).

### BM25 Retriever (`src/core/retriever/bm25.mjs`)

- `rankSkills(prompt, index, options)` -- weighted field BM25 scoring.
  - Field weights: name x3, description x2, keywords x1 (configurable).
  - BM25 parameters: `k1=1.5`, `b=0.75`.
  - Normalizes raw scores to [0, 1] by dividing by max.
- Supports optional `options.synonymMap` for query expansion.
- `readSkillContent(ranked)` -- reads SKILL.md for top-ranked skills (capped at 4000 chars each).

### Hybrid Retriever (`src/core/retriever/hybrid.mjs`)

- Runs BM25 and FNV-1a n-gram embedding similarity independently.
- Fuses via Reciprocal Rank Fusion: `score = Sum (1 / (k + rank_i))`, k=60.
- BM25 rank used as tiebreaker when RRF scores are within 1e-10.
- Optional feature-based reranking stage (opt-in).

### Embedding Engine (`src/core/embeddings/engine.mjs`)

- FNV-1a hash function (32-bit, seed 0x811c9dc5).
- Character 2-grams + 3-grams + word tokens + word bigrams hashed into 256 dims.
- Unit vector normalization; cosine similarity equals dot product.
- Used for hybrid mode and (in future phases) semantic search.

### Reranker (`src/core/reranker/`)

- **features.mjs**: Extracts 4 lexical features -- exact keyword overlap, bigram overlap, domain match, title match.
- **engine.mjs**: Blends RRF score with feature score (BLEND=0.01). Opt-in to avoid degrading accuracy on small corpora.

### Route Selector (`src/routing/selector.mjs`)

- `selectRouter(corpusSize, options)` chooses between flat and hierarchical routing.
- Priority order: explicit `mode` option > `experimental: true` > default flat. Hierarchical is available programmatically via `selectRouter(corpusSize, { mode: 'hierarchical' })` or `{ experimental: true }`.
- Default is always **flat** based on Phase 3 benchmark findings:
  - Flat is faster at ALL corpus sizes (N=50 to N=500).
  - Flat has equal or slightly better Top-1 accuracy.
  - Hierarchical has equal or higher fallback rates.
- `experimental` is a `selectRouter()` option only. No `src/cli/` module parses a `--experimental` flag; `hooks/route.mjs` always calls the selector with defaults.

### Explicit Router Detection (`src/core/routing/explicit.mjs`)

- `detectExplicitSkill(prompt, knownSkills)` — scans for `$`-prefixed tokens in the prompt.
- Resolution order: full router name (`$router-next`) > short alias (`$next`) via `ROUTER_ALIASES` > reject if not found.
- Case-insensitive matching on the alias portion.
- Returns `{ skill, matchedText, cleanedPrompt }` or `null` when no match.
- `ROUTER_DOMAINS` maps each router skill to the leaf-skill domains it dispatches to.
- Used by `routeWithExplicit()` in `src/core/routing/hybrid.mjs` to scope BM25 retrieval.

### Router Alias Config (`src/config/aliases.mjs`)

- `ROUTER_ALIASES` — mapping of short aliases to full router skill names:
  - `next` → `router-next`, `react` → `router-react`, `laravel` → `router-laravel`
  - `design` → `router-design`, `test` → `router-test`, `meta` → `router-meta`
- Only aliases whose target router exists in the deployed corpus are valid.
- Unknown aliases are silently ignored by `detectExplicitSkill`.

### Hybrid Router with Explicit Support (`src/core/routing/hybrid.mjs`)

- `routeHybrid(query, index)` — full hybrid pipeline (BM25 + SLM fallback) for implicit routing.
- `routeWithExplicit(query, index, routerSkill)` — explicit path: scopes BM25 to the router's domain using `ROUTER_DOMAINS`, then ranks leaf skills within that domain.
- When SLM is disabled (default), implicit routing uses pure BM25 on the leaf-only index.

### SLM Client (`src/core/slm/`)

- **client.mjs** — HTTP client for local SLM server (e.g. llama-server on :8080). Sends prompts, receives ranked skill suggestions.
- **parser.mjs** — Parses SLM response JSON into structured `{ skill, confidence }` entries.
- **prompt-builder.mjs** — Builds classification prompts for the SLM: lists all known skills with descriptions, asks the model to pick the most relevant one.
- **errors.mjs** — Custom error types for SLM failures (timeout, parse error, network).
- **index.mjs** — Re-exports the public API.
- SLM is opt-in via `SKILL_ROUTER_SLM_ENABLED=true`; disabled by default because Phase 2 benchmarks showed Qwen2.5-0.5B underperforms BM25.

### Deploy Subsystem (`src/deploy/`)

- **planner.mjs** — `planDeploy(projectDir, zcodeDir)`: compares `router-skills/` source against the ZCode mirror using SHA-256 hashes. Classifies routers as add/update/unchanged. Reads the disabled registry to classify leaf skills needing disable.
- **writer.mjs** — `applyDeploy(plan, projectDir, zcodeDir, options)`: copies router SKILL.md files to the mirror, writes `.skill-router-meta.json`, disables leaves via shadow mechanism. Creates a timestamped snapshot before any writes; attempts rollback on error.
- **verifier.mjs** — `verifyDeploy(projectDir, zcodeDir)`: post-deploy health check. Verifies all expected routers are present with valid meta, all disabled leaves are actually disabled, no orphan router dirs exist, and the hook is registered.
- **hook-registrar.mjs** — `registerHook()`, `unregisterHook()`, `isHookRegistered()`, `detectHookConfigPath()`. Idempotent registration of the `UserPromptSubmit` hook into ZCode's CLI config (`~/.zcode/cli/config.json`) with backup-before-write and `${ZCODE_PLUGIN_ROOT}` literal preservation.

### Hierarchical Router (`src/core/routing/hierarchical.mjs`)

- Three-stage domain-first retrieval:
  1. **Domain detection** -- calls `matchDomainsToQuery()` against `data/domains/` metadata.
  2. **Domain-scoped BM25** -- runs `rankSkills()` within each candidate domain only.
  3. **Merge & rerank** -- takes best score per skill across domains; applies domain-confidence bonus (+10% primary, +5% secondary).
- Returns `HierarchicalPlan` with merged ranked skills and domain metadata.
- Deprecated as default; available programmatically via the `mode: "hierarchical"` or `experimental: true` option to `selectRouter()` (no CLI flag).

### Domain Registry (`src/core/routing/domain-registry.mjs`)

- Manages `data/domains/<name>/meta.json` files.
- `readAllDomainMeta()` -- loads all domain metadata.
- `populateDomainsFromSkills(skills)` -- auto-generates metadata from the skill corpus.
- `matchDomainsToQuery(queryTokens, domains)` -- scores each domain by keyword (60%) and description (40%) overlap.
- `createDomainMeta(name, description, keywords)` -- creates a new domain entry.

### Route Planner (`src/core/routing/planner.mjs`)

- Three-outcome planner: single-domain, multi-domain, fallback.
- Single-domain: top confidence > 0.90 AND gap > 0.15 over second domain.
- Multi-domain: 2+ domains with confidence >= 0.50.
- Fallback: no strong signal -> plain flat retrieve.

### Context Budget Manager (`src/core/budget/manager.mjs`)

- `fitWithinBudget(skills, options)` -- distributes character budget across selected skills.
- If total raw content is under `maxChars`, returns all entries unmodified.
- Otherwise, divides budget equally with a per-skill floor (`minPerSkill`).
- Calls `truncateAtParagraph()` to never split mid-paragraph (double-newline boundary).
- Configurable via `SKILL_ROUTER_BUDGET_MAX_CHARS` (default 24000) and `SKILL_ROUTER_BUDGET_MIN_PER_SKILL` (default 500).

### Query Cache (`src/core/cache/query-cache.mjs`)

- Wraps `LRUCache` with TTL expiration (default 300,000 ms / 5 min).
- Key = `{indexFingerprint}:{sha256(normalizedQuery)}` -- auto-invalidates on index rebuild.
- `getOrSet(query, factory)` -- returns cached value or computes and stores.
- Tracks hit/miss statistics for telemetry.

### LRU Cache (`src/core/cache/lru.mjs`)

- O(1) get/set via `Map`; configurable max size.
- Methods: `get()`, `set()`, `delete()`, `size`, `clear()`, `has()`, `iterator()`.

### Synonym Expander (`src/core/retrieval/expander.mjs`)

- `expandQuery(query, synonymMap, idfMap)` -- appends synonym tokens with reduced weight (0.5).
- Filters by `MIN_IDF_THRESHOLD` (0.8) and caps at `MAX_EXPANDED_TOKENS` (3).
- `toWeightedTokenArray()` -- replicates original tokens 3x and expanded tokens 1x for BM25 compatibility.
- Opt-in only: enabled via `--expand on` flag or `synonymMap` option.

### Synonym Map Builder (`src/core/retrieval/synonyms.mjs`)

- `buildSynonymMap(index)` -- constructs a `Map<string, string[]>` from three sources:
  1. **Curated** (`data/synonyms-curated.json`): 54 hand-written pairs for framework aliases, ORM names, testing terms.
  2. **Co-occurrence**: tokens appearing together in skill keyword pools.
  3. **Abbreviations**: common abbreviations mapped to full forms.
- Returns map usable directly by `expandQuery()`.

### Skill Quality Validator (`src/quality/validator.mjs`)

- `validateSkill(filePath, registeredDomains)` -- checks 6 fields:
  1. Name present and non-empty.
  2. Name starts with one of its declared domains followed by `-`.
  3. Description length between 40 and 400 characters.
  4. Keywords count between 3 and 15.
  5. All declared domains exist in `data/domains/`.
  6. Content token count between 100 and 800.
- Returns `{ valid, issues: [{field, message}], score: 0-100 }`.
- `validateSkillsDir(skillsDir)` -- walks directory and validates all SKILL.md files.

### External Skill Import (`src/import/`)

- **scanner.mjs** -- `scanSource(path, options)` recursively finds SKILL.md files with security checks:
  - Blocks path traversal (`..`, `~`, leading `/`).
  - Validates symlinks stay within source root.
  - Respects `maxDepth` limit (default 10).
- **importer.mjs** -- `importSkills(sourceDir, skillsDir, options)`:
  - Validates each candidate with `validateSkill()`.
  - Detects name collisions; skips or overwrites with `--force`.
  - Writes validated skills to `data/skills/` preserving domain subdirectory structure.
- **reporter.mjs** -- produces console-readable import reports.

### Usage Analytics (`src/analytics/`)

- **reader.mjs** -- parses JSONL log files; handles missing files and malformed lines gracefully.
- **analyzer.mjs** -- `analyze(entries, options)` computes:
  - `totalRequests`, `totalBuilds`, `totalErrors`
  - `perDayHistogram`: retrieve counts by date
  - `fallbackRateOverTime`: % zero-result retrieves per day
  - `medianLatencyTrend`: median durationMs per day
  - `top10Skills`: most frequently recommended skills
  - `commonPromptHashes`: SHA-256 hashes of top-10 most frequent queries (raw prompts never stored)
- **reporter.mjs** -- generates markdown analytics report.

### Adaptive Threshold Tuner (`src/tuning/optimizer.mjs`)

- `optimizeThresholds(prompts, index, expected, options)` -- grid search over `(high, medium)` pairs.
- Grid: high in [0.70, 0.95] step 0.05; medium in [0.40, 0.75] step 0.05; medium < high.
- Objective: maximize Top-1 accuracy subject to fallback rate < 15%.
- Tie-breakers: (1) lower fallback rate, (2) closer to default thresholds.
- Current result: high=0.85, medium=0.60, Top-1=96.9%, fallback=8.46%.
- Writes `data/thresholds.json` consumed by `defaults.mjs`.

### Sync Planner (`src/sync/planner.mjs`)

- `planSync(projectSkillsDir, zcodeSkillsDir, options)` compares project skills with ZCode mirror.
- Builds in-memory indices for both sides via recursive SKILL.md discovery.
- Classifies each skill into one of five categories:
  - `add`: in project, absent from mirror, not disabled
  - `update`: in both, hash differs, not disabled
  - `remove`: in mirror, absent from project
  - `unchanged`: in both, hash matches, not disabled
  - `disabled`: in disabled registry regardless of mirror state
- Respects disabled registry from `.skill-router-disabled.json`.
- Returns `SyncPlan { add, update, remove, unchanged, disabled, mirrorPath }`.
- Sorts all arrays alphabetically for deterministic output.

### Sync Writer (`src/sync/writer.mjs`)

- `applySync(plan, projectSkillsDir, options)` applies a SyncPlan to the mirror.
- **Add**: copies SKILL.md to mirror path, writes `.skill-router-meta.json`.
- **Update**: overwrites mirror SKILL.md, updates meta hash.
- **Remove**: deletes managed mirror directory (only if `.skill-router-meta.json` exists).
- **Disabled** (mirror mode): deletes managed mirror directory.
- **Disabled** (shadow mode): writes a minimal disabled SKILL.md with `disabled: true` frontmatter.
- Skips unmanaged directories (no meta file) to protect user-created skills.
- Returns `SyncResult { added, updated, removed, disabled, skipped, errors }`.

### Sync State (`src/sync/state.mjs`)

- `readSyncState(projectRoot)` reads `.skill-router-sync-state.json`.
- `writeSyncState(state, projectRoot)` overwrites the state file.
- `mergeSyncResult(state, syncResult, projectRoot)` updates state after a sync:
  - Sets `lastSyncAt` to current ISO timestamp.
  - Updates `mirrorPath`.
  - Adds/updates entries for all non-removed skills with their hash + syncedAt.
  - Deletes entries for removed skills.

### Disabler (`src/sync/disabler.mjs`)

- `disableSkill(mirrorPath, entry, mechanism)` removes or shadows a skill in the mirror.
  - **mirror** (default): deletes the managed mirror directory entirely.
  - **shadow**: writes a disabled SKILL.md with `disabled: true` frontmatter; preserves the real directory.
  - Guard: only touches directories with `.skill-router-meta.json`.
- `enableSkill(mirrorPath, entry, projectSkillsDir, mechanism)` restores a disabled skill.
  - Copies SKILL.md from project source into mirror.
  - Writes fresh `.skill-router-meta.json` with `disabled: false`.
- `readDisabledRegistry(projectRoot)` reads `.skill-router-disabled.json`.
- `writeDisabledRegistry(disabled, projectRoot)` writes the disabled registry.

### Index Deduplicator (`src/index/dedupe.mjs`)

- `resolveCollisions(indexEntries)` resolves name collisions across multi-source index entries.
- Priority order: `project` (2) > `zcode-user` (1).
- When the same skill name appears in both sources, the project entry is kept.
- Logs collision details to console for visibility.
- Used during `reindex` and `build-index` when multiple sources are configured.

### Configuration (`src/config/`)

- **defaults.mjs** -- `getDefaults()` returns all tunable parameters. Loads `data/thresholds.json` for optimized confidence thresholds.
- **env.mjs** -- `getConfig()` merges `SKILL_ROUTER_*` environment variables over defaults. Supports comma-separated numeric arrays for list parameters.

### Telemetry (`src/core/telemetry/`)

- **logger.mjs** -- JSONL logging with daily rotation (`logs/YYYY-MM-DD.jsonl`). Events: `retrieve`, `build`, `cache`, `budget`, `error`. Never logs raw query text.
- **metrics.mjs** -- In-memory ring buffer of last 1000 requests. Tracks latency percentiles (p50/p95/p99), hit/fallback counts.
- **reporter.mjs** -- Human-readable markdown tables for metrics snapshots.

### User Feedback Telemetry (`src/telemetry/`)

- **feedback.mjs** -- `logDecision()` writes routing decisions (mode, tier, router, selectedSkills, latencyMs, confidence, prompt) to `logs/routing-YYYYMMDD.jsonl` with daily rotation and SHA-256 prompt hashing. `readDecisions()` and `summarize()` parse and aggregate decisions.
- **signals.mjs** -- `recordSignal()` appends user feedback signals (retry, dismiss, rephrase, success, explicit_override) to `logs/signals-YYYYMMDD.jsonl`. Signals are fire-and-forget and never block the hook. `readSignals()` reads with optional date/type filters.
- **outcomes.mjs** -- `correlate(decisions, signals)` classifies each decision as positive/negative/unknown based on signal proximity windows (retry within 5m = negative, explicit_override within 2m = negative, no signals within 10m = positive). `correlateFromLogs()` is the convenience wrapper used by `feedback --outcomes`.
- **session-tracker.mjs** -- `trackPrompt(prompt, promptHash)` detects implicit feedback signals from prompt patterns and emits a Signal or null. Used inside `hooks/route.mjs` to record signals without adding UI dependencies.

### BM25 Attribution Engine (`src/core/retriever/attribution.mjs`)

- `attributeOutcome(decision, outcome, index)` computes per-field BM25 scores (name, description, keywords) for the top-ranked skill, determines which field was the dominant contributor, and returns an `Attribution` record with `dominantField`, `fields`, `selectedSkill`, and `decisionHash`.
- Used by `feedback --outcomes` and `tune --analyze` to attribute positive/negative outcomes to specific fields.

### Adaptive Weight Adjuster (`src/core/retriever/weights.mjs`)

- `computeWeights(attributions, currentWeights, opts)` applies a 5% gradient-free adjustment: positive outcomes increase the dominant field by 5%, negative outcomes decrease it by 5%. Each weight is clamped to `[0.5, 5.0]` and the sum is preserved via normalization.
- Requires at least `minOutcomes` (default 20) attributions before producing a change. Returns `{ changed, newWeights, reason, sampleSize }`.

### CLI (`bin/skill-router.mjs` + `src/cli/`)

- Entry point at `bin/skill-router.mjs` routes to subcommand modules.
- Subcommands (18 total): `list`, `add`, `remove`, `validate`, `reindex`, `benchmark`, `stats`, `analytics`, `import`, `sync`, `deploy`, `sources`, `verify`, `doctor`, `feedback`, `health`, `tune`, `help`.
- `src/cli/` holds 20 modules; `tune-core.mjs` and `tune-guard.mjs` are helpers of `tune.mjs`, not subcommands.
- Each subcommand is a separate module in `src/cli/` with an exported `main(argv)` function.

## Skill Index Schema

`data/skill-index.json` is a **flat JSON array of skill objects** — one entry per
`SKILL.md` — not an inverted index with postings. It is built by
`hooks/build-index.mjs` / `src/cli/reindex.mjs` and read by
`src/core/retriever/bm25.mjs`, which scores fields at query time rather than at
build time.

```json
[
  {
    "name": "backend-api-resources",
    "description": "Laravel API Resources for transforming model data into JSON responses, conditional field inclusion, resource collections, and nested resource responses",
    "keywords": ["API Resources", "JSON transformation", "resource collections"],
    "domains": ["backend", "api"],
    "path": "<absolute path to the SKILL.md>",
    "version": "0.1.0",
    "source": "project"
  }
]
```

| Field | Type | Purpose |
|---|---|---|
| `name` | string | Skill name; also the `docId` used by the retrieval layer |
| `description` | string | One-line summary, scored at weight x2 |
| `keywords` | string[] | Scored at weight x1 |
| `domains` | string[] | Domain membership; drives hierarchical routing and the validator |
| `path` | string | Absolute path to the source `SKILL.md` |
| `version` | string | From the manifest frontmatter |
| `source` | `"project"` \| `"zcode-user"` | Origin, set only on multi-source builds |

The current index holds 60 entries: 54 leaf skills plus 6 `router-*` dispatchers.
The hook filters `router-*` out before implicit retrieval
(`hooks/route.mjs:139`), so the effective retrieval corpus is 54.

Note: the `path` field is absolute, which makes the file machine-specific (see
`docs/problems.md` P6-H-009).

## Retrieval Algorithm (BM25 MVP)

For each query term *q*:

```
score(q, d) = IDF(q) * Sum over positions p of:
              (tf(q,d) * (k1 + 1))
              -----------------------
              tf(q,d) + k1 * (1 - b + b * |d|/avgDL)
```

Where:
- `IDF(q) = ln((N - df(q) + 0.5) / (df(q) + 0.5) + 1)`
- `k1 = 1.5`, `b = 0.75`
- `|d|` = document length in tokens
- `avgDL` = average document length across the corpus

Results are sorted descending by score, truncated to `topK` (default 5).

Field weights multiply token multiplicity: name tokens appear 3x, description 2x, keywords 1x.

## Confidence Policy

Raw BM25 scores are non-negative and unbounded. We map them into three bands
using thresholds loaded from `data/thresholds.json` (or hardcoded defaults):

| Band | Threshold | Meaning |
|------|-----------|---------|
| `high` | >= 0.85 | Strongly relevant -- present prominently |
| `medium` | >= 0.60 | Likely relevant -- include in shortlist |
| `low` | >= 0.35 | Weakly relevant -- show only if few results |
| `dismiss` | < 0.35 | Ignore -- do not surface |

Thresholds are adaptive: the optimizer (`src/tuning/optimizer.mjs`) searches for optimal values on the current corpus and writes them to `data/thresholds.json`. If the file is absent, hardcoded defaults (0.85/0.60) are used.

If only one result is returned, it is auto-graded `high`.
If zero results match, the hook returns an empty suggestion list.

## Hook Contract

The ZCode `UserPromptSubmit` hook receives a payload shaped as:

```typescript
interface PromptPayload {
  prompt: string;           // user's authoring prompt
  cwd: string;              // workflow directory path
}
```

The hook MUST respond by writing `.zcode/output.json`:

```typescript
interface Output {
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit";
    additionalContext: string;  // markdown skill content to inject
  };
  RoutePlan: {
    mode: "flat" | "hierarchical" | "single" | "multi" | "fallback";
    domains: Array<{ name: string; skills: string[] }>;
    primary: string | null;
    candidates: Array<{ name: string; score: number }>;
    latencyMs: number;
  };
}
```

See `docs/implementation-plan.md` for the per-phase hook integration details.

## Logging Format

Two types of logs are produced:

### Runtime Events (`logs/YYYY-MM-DD.jsonl`)

Written by `src/core/telemetry/logger.mjs`. One JSON object per line, no pretty-print:

```jsonl
{"ts":"2026-09-20T12:00:00.000Z","event":"retrieve","query":"deploy aws lambda","resultCount":3,"durationMs":12}
{"ts":"2026-09-20T12:00:00.001Z","event":"build","totalDocs":42,"totalTerms":318,"durationMs":87}
{"ts":"2026-09-20T12:00:00.002Z","event":"cache","cacheHits":1,"cacheMisses":129,"cacheHitRate":0.0077}
{"ts":"2026-09-20T12:00:00.003Z","event":"budget","totalSkills":3,"selectedCount":3,"rawTotalChars":12000,"injectedChars":11800}
{"ts":"2026-09-20T12:00:01.000Z","event":"error","query":"deploy aws lambda","error":"index not found"}
```

Logs rotate by date. Lines older than 30 days are eligible for cleanup (Phase 4).

### Routing Decisions (`logs/routing-YYYYMMDD.jsonl`)

Written by `src/telemetry/feedback.mjs` via `logDecision()`. One JSON object per line, no pretty-print:

```jsonl
{"ts":"2026-09-20T12:00:00.000Z","mode":"implicit","router":null,"tier":"bm25","selectedSkills":["backend-laravel-eloquent","backend-api-rest"],"latencyMs":{"total":2,"bm25":2},"confidence":0.92,"promptHash":"sha256:abc123...","sessionId":"user-123","version":"0.2.0"}
{"ts":"2026-09-20T12:00:01.000Z","mode":"explicit","router":"router-laravel","tier":"bm25","selectedSkills":["backend-laravel-migrations"],"latencyMs":{"total":3,"bm25":3},"confidence":0.88,"promptHash":"sha256:def456...","sessionId":"user-123","version":"0.2.0"}
```

Raw prompts are never stored — only SHA-256 hashes appear. The `feedback` CLI reads these files and produces summary reports.

## Environment Variables

All tunable parameters can be overridden via `SKILL_ROUTER_*` environment variables:

| Variable | Default | Description |
|---|---|---|
| `SKILL_ROUTER_BM25_K1` | 1.5 | BM25 term frequency saturation |
| `SKILL_ROUTER_BM25_B` | 0.75 | BM25 length normalization |
| `SKILL_ROUTER_BM25_NAME_WEIGHT` | 3 | Name field weight multiplier |
| `SKILL_ROUTER_BM25_DESC_WEIGHT` | 2 | Description field weight multiplier |
| `SKILL_ROUTER_BM25_KEYWORD_WEIGHT` | 1 | Keywords field weight multiplier |
| `SKILL_ROUTER_EMBED_DIMS` | 256 | Embedding dimensionality |
| `SKILL_ROUTER_RRF_K` | 60 | RRF fusion constant |
| `SKILL_ROUTER_DOMAIN_THRESHOLD` | 0.80 | Single-domain confidence threshold |
| `SKILL_ROUTER_MULTI_DOMAIN_THRESHOLD` | 0.50 | Multi-domain confidence threshold |
| `SKILL_ROUTER_HIERARCHICAL_CONFIDENCE_THRESHOLD` | 0.08 | Hierarchical routing confidence threshold for domain selection |
| `SKILL_ROUTER_HIGH_THRESHOLD` | 0.85 | High-confidence threshold (override thresholds.json) |
| `SKILL_ROUTER_MEDIUM_THRESHOLD` | 0.60 | Medium-confidence threshold (override thresholds.json) |
| `SKILL_ROUTER_TIMEOUT_MS` | 200 | Hook timeout in milliseconds |
| `SKILL_ROUTER_MAX_PROMPT_LENGTH` | 10240 | Max prompt length before truncation |
| `SKILL_ROUTER_MAX_OUTPUT_LENGTH` | 30000 | Max output length |
| `SKILL_ROUTER_BUDGET_MAX_CHARS` | 24000 | Total context budget in characters |
| `SKILL_ROUTER_BUDGET_MIN_PER_SKILL` | 500 | Minimum characters per skill in budget |
| `SKILL_ROUTER_SOURCES` | (none) | Colon-separated source paths for multi-source indexing |
| `SKILL_ROUTER_ZCODE_DIR` | (none) | Override ZCode skills mirror directory |

List parameters accept comma-separated values (e.g., `SKILL_ROUTER_BM25_NAME_WEIGHT=3,2,1`).

## Constraints

- **No external dependencies.** The plugin ships as plain ESM; zero `npm install`.
- **No network calls.** All data is local to the project directory.
- **Deterministic.** Same input always produces the same ranking.
- **Memory bounded.** The index is loaded into memory at build time; capped at
  the size of the skill directory (expected < 1 MB for <= 200 skills).
- **Encoding.** UTF-8 for all text; gracefully handle malformed JSON with a warning.
- **Privacy.** Raw prompts are never stored or displayed. Only SHA-256 hashes appear in analytics.

## Out of Scope (for this project)

- Semantic / vector-based search with pre-trained models (planned for a future phase).
- Multi-tenant or cloud-synced skill registries.
- Learning user preferences over time via a feedback loop (planned for a future phase).
- GUI components -- the hook communicates through ZCode's existing UI channel.
- Real-time index updates during authoring (index is rebuilt on demand via `build-index`).
