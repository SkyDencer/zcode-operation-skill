# Architecture — Skill Router v0.2

## Overview

The Skill Router is a zero-dependency Node.js plugin for ZCode that intercepts authoring prompts, retrieves relevant skill documentation via BM25 lexical search, and injects it into the model context. Phase 2 added hierarchical routing, quality validation, adaptive threshold tuning, synonym expansion, query caching, context budget management, usage analytics, and an external skill import pipeline. Phase 3 added ZCode skill sync (SHA-256 based), a disable mechanism for mirror skills, a two-source index with collision resolution, verify/doctor diagnostic CLIs, and a routing selector that makes flat BM25 the default path.

## Data Flow

```
ZCode UserPromptSubmit
        │
        ▼
┌──────────────────────────────────────────────────┐
│  hooks/route.mjs │  Input validation, timeout guard, error boundary    │
│                  │  Detects explicit $-mentions (detectExplicitSkill)  │
│                  │  Builds QueryCache, selects routing strategy        │
│                  │  Fits selected skills within context budget         │
└────────────────┬───────────────────────────────┘
                 │ JSON payload (prompt, cwd)
                 ▼
         ┌───────┴───────┐
         │  explicit?    │
         └───────┬───────┘
        yes /   │   \  no
         │      │      │
         ▼      │       ▼
┌───────────────────┐ │  ┌──────────────────────────────────────────┐
│  Explicit Path    │ │  │  Implicit Path                           │
│                   │ │  │                                          │
│  detectExplicit-  │ │  │  Build leaf-only index (exclude router-*)│
│  skill(prompt)    │ │  │  QueryCache.getOrSet()                   │
│  resolves $mention│ │  │  │                                       │
│  to router skill  │ │  │  ▼                                       │
│  strips mention   │ │  │  SLM enabled?                            │
│  from prompt      │ │  │  │                                       │
│                   │ │  │  ├─ yes → routeHybrid(query, leafIndex) │
│  routeWithExplicit│ │  │  └─ no  → rankSkills(query, leafIndex)  │
│  (scoped BM25 to  │ │  │         (pure BM25, no SLM overhead)    │
│  router domain)   │ │  │                                          │
└───────────────────┘ │  └──────────────────────────────────────────┘
         │            │            │
         └────────────┴────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────────┐
│  readSkillContent() -> full SKILL.md text (capped at 4000 │
│  chars per skill)                                        │
└────────────────┬───────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────┐
│  fitWithinBudget() -> paragraph-safe truncation          │
│  maxChars: 24000 (default) │ minPerSkill: 500           │
└────────────────┬───────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────┐
│  telemetry logger (JSONL logs) + ring-buffer metrics    │
│  Never logs raw query text - only SHA-256 hashes        │
│  Logs: mode (explicit/implicit), tier, slmEnabled,      │
│  routerMatched, latencyMs                               │
└────────────────┬───────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────┐
│  output.json                                            │
│  {                                                     │
│    hookSpecificOutput: { additionalContext },           │
│    RoutePlan: { mode, domains, primary, candidates }   │
│  }                                                      │
└──────────────────────────────────────────────────────────┘
```

## Sync Subsystem

The sync subsystem manages the relationship between project skills (`data/skills/`) and the ZCode mirror (`~/.zcode/skills/`). It consists of four modules:

```
src/sync/
├── planner.mjs  ← planSync() — SHA-256 comparison, classify add/update/remove/unchanged/disabled
├── writer.mjs   ← applySync() — safe mirror write with meta-file protection
├── state.mjs    ← read/write .skill-router-sync-state.json (last sync timestamp, per-skill hashes)
└── disabler.mjs ← disableSkill()/enableSkill(), read/write .skill-router-disabled.json
```

### Sync Flow

```
project data/skills/              ZCode mirror ~/.zcode/skills/
        │                                    │
        │   planSync(): compare SHA-256      │
        │   hashes of SKILL.md content       │
        │                                    │
        ├───── add ──────────────────────────►│ copy SKILL.md + write meta
        ├───── update ───────────────────────►│ overwrite SKILL.md + update meta
        ├───── unchanged ─────────────────────│ no action
        ├───── remove ───────────────────────►│ delete managed mirror dir
        └───── disabled ─────────────────────►│ remove or shadow mirror dir
                                              │
        ▲                                    │
        └───── .skill-router-meta.json ◄─────┘
              (only managed dirs are touched)
```

### Sync Plan Classification

| Category | Condition | Action in Mirror |
|----------|-----------|------------------|
| `add` | In project, not in mirror, not disabled | Copy SKILL.md + write `.skill-router-meta.json` |
| `update` | In both, hash differs, not disabled | Overwrite SKILL.md + update meta |
| `remove` | In mirror, not in project | Delete managed mirror directory |
| `unchanged` | In both, hash matches, not disabled | No action |
| `disabled` | Disabled registry contains name | Remove from mirror (mirror) or write shadow (shadow) |

### Disable Mechanism

Two mechanisms are available, selected with `--disable-mechanism mirror|shadow`:

- **mirror** (default): Deletes the managed mirror directory. ZCode no longer discovers the skill. Only directories with `.skill-router-meta.json` are removed.
- **shadow**: Writes a minimal disabled SKILL.md with `disabled: true` frontmatter at the same path. The real directory is preserved so enable restores it by overwriting the shadow.

The disabled skills registry is stored in `.skill-router-disabled.json` at the project root:

```json
{
  "disabled": ["backend-laravel-eloquent", "frontend-react-hooks"],
  "lastModified": "2026-09-23T10:00:00.000Z"
}
```

### State Persistence

After each sync, `.skill-router-sync-state.json` records the last sync timestamp, mirror path, and per-skill hash+timestamp. This enables the `verify` command to detect drift between runs.

## Two-Source Index

When skills are loaded from multiple sources, name collisions can occur. The deduplication module resolves them with a priority rule:

```
Priority order (highest first):
  1. project  (data/skills/)
  2. zcode-user (data/skills/zcode/)
```

### Index Build Flow

```
loadSkills(data/skills/)              loadSkills(data/skills/zcode/)
          │                                        │
          └─────────── allEntries ─────────────────┘
                          │
                          ▼
               deduplicate by path
              (same file via different source scans)
                          │
                          ▼
               tagSkillsBySource()
           (most-specific source wins via path prefix)
                          │
                          ▼
               resolveCollisions()
           (project wins over zcode-user on name clash)
                          │
                          ▼
              data/skill-index.json
           (each entry carries source: "project"|"zcode-user")
```

Configuration via `SKILL_ROUTER_SOURCES` env var (colon-separated paths) or `reindex --sources project,zcode-user,all`.

## Core Modules

### BM25 Retriever (`src/core/retriever/bm25.mjs`)

- Weighted field scoring: name x3, description x2, keywords x1
- Standard BM25 formula with configurable k1 (1.5) and b (0.75)
- Normalizes raw scores to [0, 1] by dividing by max
- Supports optional synonym expansion: original tokens weight 3x, expanded tokens weight 1x
- Exports: `rankSkills(prompt, index, options)`, `readSkillContent(ranked)`

### Synonym Expander (`src/core/retrieval/expander.mjs`)

- Expands query tokens with synonym alternatives from `data/synonyms-curated.json`
- Filters by minimum IDF (0.8) to avoid generic-token noise
- Caps expansions at 3 tokens per query to prevent signal dilution
- `toWeightedTokenArray()`: original tokens repeated 3x, synonyms 1x -- replicates weight ratio in BM25
- Opt-in only: enabled via `--expand on` in benchmark or by passing `synonymMap` option

### Synonym Map Builder (`src/core/retrieval/synonyms.mjs`)

- Builds synonym map from three sources: curated JSON, co-occurrence analysis, abbreviation lists
- Curated entries (54 pairs): framework aliases, ORM names, testing terms, etc.
- Co-occurrence detection: tokens appearing in the same skill's keyword pool are linked
- Stored as `Map<string, string[]>` for O(1) lookup during expansion

### Hierarchical Router (`src/core/routing/hierarchical.mjs`)

- Three-stage pipeline for large corpora:
  1. **Domain detection** -- matches query tokens against domain registry metadata (keyword + description), returning top-3 candidate domains
  2. **Domain-scoped BM25** -- runs full BM25 within each candidate domain only (not across all skills)
  3. **Merge & rerank** -- takes best score per skill across domains, applies domain-confidence bonus (primary +10%, secondary +5%)
- Falls back to full BM25 when no domain metadata exists or query has no tokens
- Returns `HierarchicalPlan` with `{ mode, domains, skills, primaryDomain, candidateDomainCount, totalSkillsScored }`
- Deprecated as default: benchmark showed flat is faster at all corpus sizes

### Domain Registry (`src/core/routing/domain-registry.mjs`)

- Manages per-domain metadata stored in `data/domains/<domain>/meta.json`
- Each `meta.json`: `{ name, description, keywords, skillCount }`
- `populateDomainsFromSkills()` auto-generates/updates metadata from the skill corpus during `build-index`
- `matchDomainsToQuery()` scores each domain by keyword overlap (60%) and description overlap (40%)
- Used by hierarchical router (Stage 1) and quality validator (domain membership check)

### Route Planner (`src/core/routing/planner.mjs`)

- Three outcomes: **single-domain**, **multi-domain**, **fallback**
- Single-domain: top confidence > 0.90 AND gap > 0.15 over second domain
- Multi-domain: 2+ domains with confidence >= 0.50
- Fallback: no strong signal -> plain flat retrieve
- Multi-domain uses single hybrid pass with domain-distributed scoring

### Router Selector (`src/routing/selector.mjs`)

- `selectRouter(corpusSize, options)` chooses between flat and hierarchical routing
- Default: **flat** -- benchmark evidence shows flat is faster and equally/more accurate at all scales (N=50 to N=500)
- `mode` option: force `"flat"` or `"hierarchical"`
- `experimental` option: enables the deprecated hierarchical path. It is a `selectRouter()` option only -- no `src/cli/` module parses `--experimental`
- Hierarchical is NOT auto-enabled by corpus size; it requires an explicit option

### Context Budget Manager (`src/core/budget/manager.mjs`)

- `fitWithinBudget(skills, options)` distributes a total character budget across selected skills
- If total raw content is under budget, returns all entries unmodified
- Otherwise, divides budget equally with a per-skill floor (`minPerSkill`, default 500 chars)
- Calls `truncateAtParagraph()` to never split mid-paragraph
- Configurable via `SKILL_ROUTER_BUDGET_MAX_CHARS` (default 24000) and `SKILL_ROUTER_BUDGET_MIN_PER_SKILL` (default 500)

### Query Cache (`src/core/cache/query-cache.mjs`)

- Wraps an `LRUCache` with TTL expiration (default 5 minutes)
- Key = `{indexFingerprint}:{sha256(normalizedQuery)}` -- ensures cache invalidation on index rebuild
- `computeIndexFingerprint()` uses FNV-1a 64-bit hash of sorted skill names
- `getOrSet(query, factory)` pattern: returns cached value or computes and stores
- Stats tracking: hits, misses, hit rate, current size
- Updated in `hooks/route.mjs` -- all routing plans pass through the cache

### LRU Cache (`src/core/cache/lru.mjs`)

- Pure LRU eviction policy implemented with `Map` for O(1) get/set
- Methods: `get()`, `set()`, `delete()`, `size`, `clear()`, `has()`, `iterator()`
- Configurable max size; oldest entry evicted when capacity exceeded

### Index Deduplicator (`src/index/dedupe.mjs`)

- `resolveCollisions(indexEntries)` resolves name collisions across multi-source index entries
- Priority order: `project` (2) > `zcode-user` (1)
- Logs collision details to console: which entry was kept, which was removed, and their paths
- Used during `reindex` and `build-index` when multiple sources are configured

### Telemetry (`src/core/telemetry/`)

- **logger.mjs**: JSONL logging with daily rotation (`logs/YYYY-MM-DD.jsonl`)
  - Fields: ts, event, queryHash, queryLength, candidates, selected, mode, latencyMs, confidence
  - Events: `retrieve`, `build`, `cache`, `budget`, `error`
  - Never logs raw query text (hashed only)
- **metrics.mjs**: In-memory ring buffer of last 1000 requests
  - `recordLatency(ms)`, `recordAccuracy(hit)`, `recordFallback()`
  - `snapshot()` returns p50, p95, p99, mean, count, fallbacks, hits
- **reporter.mjs**: Human-readable markdown tables for metrics and benchmarks

### Configuration (`src/config/`)

- **defaults.mjs**: All tunable parameters with descriptive defaults
  - Loads optimized confidence thresholds from `data/thresholds.json` when present
  - Falls back to hardcoded defaults when file is absent or malformed
- **env.mjs**: Reads `SKILL_ROUTER_*` env vars, validates types/ranges, falls back to defaults
- Schema validation prevents invalid values from breaking the system

### Adaptive Threshold Tuning (`src/tuning/optimizer.mjs`)

- Grid search over `(high, medium)` confidence threshold pairs
- High range: [0.70, 0.95] in 0.05 steps; Medium range: [0.40, 0.75] in 0.05 steps
- Objective: maximize Top-1 accuracy subject to fallback rate < 15%
- Tie-breakers: (1) lower fallback rate, (2) closest to current defaults
- Evaluates 45 combinations on the 130-prompt benchmark in ~12 seconds
- Writes results to `data/thresholds.json` -- consumed by `defaults.mjs` at startup
- Optimized thresholds (current): high=0.85, medium=0.60, Top-1=96.9%, fallback=8.46%

### Skill Quality Validator (`src/quality/validator.mjs`)

- Validates each SKILL.md file against 6 rules:
  1. Name is present and non-empty
  2. Name pattern: starts with one of its declared domains followed by `-`
  3. Description length: 40-400 characters
  4. Keywords count: 3-15 entries
  5. Domains all exist in `data/domains/` registry
  6. Content token count: 100-800 tokens (after frontmatter)
- Returns `ValidationResult { valid, issues: [{field, message}], score: 0-100 }`
- `validateSkillsDir(dir)` walks a directory recursively and validates all SKILL.md files
- Ran on real corpus: 54/54 skills fixed (52 had name not prefixed with domain, 54 had content <100 tokens)

### External Skill Import (`src/import/`)

- **scanner.mjs**: Recursively scans a source directory for SKILL.md files
  - Blocks path traversal (`..`, `~`, leading `/`)
  - Skips symlinks pointing outside the source root
  - Respects `maxDepth` limit (default 10)
  - Returns `SkillCandidate[]` with name, description, keywords, domains, sourcePath, content
- **importer.mjs**: Validates candidates and copies them into `data/skills/`
  - Detects name collisions; skips or overwrites with `--force`
  - Runs `validateSkill()` before accepting; rejects invalid skills
  - Builds target directory from name slug: `backend-eloquent` -> `data/skills/backend/eloquent/`
- **reporter.mjs**: Produces console-readable import reports (imported/rejected/skipped counts)

### Usage Analytics (`src/analytics/`)

- **reader.mjs**: Parses JSONL log files, handles missing files and malformed lines gracefully
- **analyzer.mjs**: Computes metrics from parsed entries:
  - `totalRequests`, `totalBuilds`, `totalErrors`
  - `perDayHistogram`: retrieve counts grouped by date
  - `fallbackRateOverTime`: % of retrieves with zero results, per day
  - `medianLatencyTrend`: median durationMs per day
  - `top10Skills`: most frequently recommended skills (via BM25 lookup on top results)
  - `commonPromptHashes`: SHA-256 hashes of the 10 most frequent queries (raw prompts never displayed)
- **reporter.mjs**: Generates a formatted markdown report
- CLI: `node bin/skill-router.mjs analytics [--since N days] [--json]`

## Scale Findings

Phase 3 conducted a rigorous scale benchmark comparing flat BM25 against hierarchical routing across synthetic corpora of 50, 100, 200, 300, and 500 skills. Synthetic prompts were generated to target specific skills (2 prompts per skill using rotating template forms), making this a matching-corpus benchmark.

### Key Results

| N | Mode | Top-1 | Recall@3 | Median ms | P95 ms | Fallback |
|---|------|-------|----------|-----------|--------|----------|
| 50 | flat | 85.0% | 97.0% | 2 | 3 | 0.0% |
| 50 | hierarchical | 85.0% | 97.0% | 4 | 4 | 0.0% |
| 100 | flat | 76.0% | 93.5% | 3 | 4 | 0.0% |
| 100 | hierarchical | 76.0% | 93.5% | 5 | 6 | 0.0% |
| 200 | flat | 50.2% | 84.5% | 6 | 7 | 0.0% |
| 200 | hierarchical | 50.2% | 84.3% | 9 | 9 | 0.3% |
| 300 | flat | 36.7% | 76.7% | 9 | 10 | 0.0% |
| 300 | hierarchical | 36.5% | 76.3% | 11 | 12 | 0.3% |
| 500 | flat | 39.5% | 64.2% | 15 | 16 | 0.0% |
| 500 | hierarchical | 39.4% | 64.0% | 17 | 18 | 0.2% |

### Conclusions

1. **Flat BM25 is faster at every scale.** At N=50 it is 2x faster; the gap narrows to 1.13x at N=500 but flat never loses.
2. **Accuracy is tied or slightly better for flat.** Hierarchical never outperforms flat; at N=300 and N=500 flat edges ahead by 0.1-0.2%.
3. **Fallback rate is higher for hierarchical** at larger scales (0.3% vs 0.0%).
4. **The inflection point** where Top-1 drops below 95% is at N=50 on synthetic prompts. This is a corpus-distribution issue, not an algorithm failure -- the real 54-skill corpus achieves 96.9% Top-1.
5. **Decision**: hierarchical routing is deprecated as the default. Flat is the primary path. Hierarchical remains available to callers that pass `selectRouter(corpusSize, { mode: 'hierarchical' })` or `{ experimental: true }`; there is no `--experimental` CLI flag.

Full report: [docs/reports/phase-3-scale-benchmark.md](reports/phase-3-scale-benchmark.md)

## Hook Contract

### Input (stdin JSON)
```json
{
  "prompt": "string -- user's authoring prompt",
  "cwd": "string -- workflow directory path"
}
```

### Output (`.zcode/output.json`)
```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "string -- skill documentation to inject"
  },
  "RoutePlan": {
    "mode": "flat|hierarchical|single|multi|fallback",
    "domains": [{ "name": "string", "skills": ["string"] }],
    "primary": "string|null",
    "candidates": [{ "name": "string", "score": number }],
    "latencyMs": number
  }
}
```

### Fail-Open Behavior
- Empty input -> exit 0, no output
- Malformed JSON -> exit 0, no output
- Missing fields -> safe defaults applied
- Prompt > 10KB -> truncated
- Index not found -> exit 0
- Retrieval timeout (>200ms) -> partial results
- Any uncaught error -> exit 0, log to stderr

## Performance Characteristics

| Mode | Top-1 | Recall@3 | Median Latency | P95 Latency |
|------|-------|----------|----------------|-------------|
| BM25 (real, 54 skills) | 96.9% | 89.2% | 2 ms | 3 ms |
| BM25 (synthetic, 50) | 85.0% | 97.0% | 2 ms | 3 ms |
| BM25 (synthetic, 100) | 76.0% | 93.5% | 3 ms | 4 ms |
| BM25 (synthetic, 200) | 50.2% | 84.5% | 6 ms | 7 ms |
| BM25 (synthetic, 500) | 39.5% | 64.2% | 15 ms | 16 ms |
| Hierarchical (synthetic, 200) | 50.2% | 84.3% | 9 ms | 9 ms |
| Hierarchical (synthetic, 500) | 39.4% | 64.0% | 17 ms | 18 ms |
| BM25 + synonym expand | 80.0% | 87.7% | 2 ms | 3 ms |
| Hybrid (BM25+FNV-1a) | 53.8% | 77.7% | 31 ms | 41 ms |
| Routing overhead | -- | -- | +3 ms | +5 ms |

## Design Decisions

1. **Zero dependencies** -- No npm packages. All algorithms implemented from scratch.
2. **Deterministic embeddings** -- FNV-1a hashing ensures reproducible results without ML models.
3. **Flat routing is default** -- Phase 3 scale benchmark proved flat is faster and equally accurate at all corpus sizes. Hierarchical is deprecated as default but available via `--experimental`.
4. **Synonym expansion is opt-in** -- Defaults to off because expanding with low-IDF terms adds noise on the current corpus. Enabled via `--expand on`.
5. **Thresholds are adaptive** -- Loaded from `data/thresholds.json` (produced by the optimizer) rather than hardcoded. Falls back to `0.85/0.60` if the file is missing.
6. **Context budget is paragraph-safe** -- Truncation never splits mid-paragraph (double-newline boundary), preserving readability.
7. **Query cache keys include index fingerprint** -- Any index rebuild (new skills added) automatically invalidates all cached entries.
8. **Analytics preserves privacy** -- Raw prompts are never logged or displayed; only SHA-256 hashes appear in analytics reports.
9. **Import validates before copying** -- Skills are validated against the 6-field quality rules before being written to `data/skills/`. Invalid skills are rejected with a clear report.
10. **Sync protects user-managed skills** -- Only mirror directories with `.skill-router-meta.json` are modified. Hand-edited or user-created skills are left untouched.
11. **Disable mechanism is filesystem-based** -- ZCode has no native per-skill disable API. Mirror removal or shadow SKILL.md is the best available approach.
12. **Two-source index uses project priority** -- When the same skill name appears in project and zcode-user sources, the project version always wins.
13. **SLM is disabled by default** -- Phase 2 benchmarks proved Qwen2.5-0.5B underperforms BM25 on the 54-skill corpus (Top-1: 20% vs 46.67%; Set Recall: 0.0972 vs 0.7000). Hybrid mode degrades Set Recall. SLM is opt-in via `SKILL_ROUTER_SLM_ENABLED=true` for experimental use.

## Router Skills vs Leaf Skills

The skill corpus is split into two categories, each with a distinct role:

| Aspect | Router Skill | Leaf Skill |
|--------|-------------|------------|
| Location | `router-skills/router-{name}/SKILL.md` | `data/skills/{domain}/{skill-name}/SKILL.md` |
| Purpose | Dispatch to the right leaf skill domain | Contain actual workflow instructions |
| Size | ~50–80 lines | ~50–200+ lines |
| Frontmatter | `name`, `description`, `allowed-tools` | `name`, `description`, `keywords`, `domains` |
| Content | Routing table + trigger conditions | Step-by-step instructions, examples |
| In implicit BM25 | Excluded (filtered out as `router-*`) | Included |
| In explicit routing | Resolved via `$mention` detection | Retrieved after router dispatch |

**Key principle:** Routers read leaf skills; leaf skills never reference routers. This creates a clean one-way dependency graph.

The explicit detection engine (`src/core/routing/explicit.mjs`) scans prompts for `$`-prefixed tokens. Aliases are defined in `src/config/aliases.mjs`:

| Alias | Router Skill | Domain |
|-------|-------------|--------|
| `$next` | `router-next` | frontend |
| `$react` | `router-react` | frontend |
| `$laravel` | `router-laravel` | backend |
| `$design` | `router-design` | design |
| `$test` | `router-test` | testing |
| `$meta` | `router-meta` | meta |

The `ROUTER_DOMAINS` map in `explicit.mjs` provides the domain scoping used by `routeWithExplicit()` in `src/core/routing/hybrid.mjs`.

## When to Enable SLM

SLM routing is disabled by default (`slm.enabled: false`). Enable it only for experimentation or when using a larger model.

Phase 2 benchmark numbers (30-prompt dataset):

| Mode | Top-1 | Set Recall | p50 Latency |
|------|-------|------------|-------------|
| BM25-Only | 46.67% | 0.7000 | ~3 ms |
| SLM-Only | 20.00% | 0.0972 | ~182 ms |
| Hybrid (BM25→SLM) | 46.67% | 0.5750 | ~1484 ms |

**Do NOT enable SLM in production** with the current 0.5B model. It adds ~1.5 s latency per prompt and does not improve retrieval quality.

To enable SLM for experimentation:

```bash
SKILL_ROUTER_SLM_ENABLED=true node hooks/route.mjs
```

Benchmark runner with SLM forced:

```bash
node tests/slm-benchmark/runner.mjs --mode hybrid --slm
```

A larger model (1.5B+) or a pre-trained embedding model (Phase 6) would be prerequisites for SLM to become worthwhile.

## Deployment

### Router Skills vs Leaf Skills

The router deploys two kinds of skills to the ZCode mirror:

| Kind | Location | Purpose | Deployed to |
|------|----------|---------|-------------|
| **Router skills** | `router-skills/router-{name}/SKILL.md` | Dispatch to the right leaf-skill domain | `~/.zcode/skills/router-{name}/` |
| **Leaf skills** | `data/skills/{domain}/{slug}/SKILL.md` | Contain actual workflow instructions | `~/.zcode/skills/{domain}/{slug}/` |

### Hook Registration

The `UserPromptSubmit` hook must be registered in ZCode's CLI config (`~/.zcode/cli/config.json`). The project ships `hooks/hooks.json` as a reference manifest, but ZCode does not read hooks from plugin directories — only from the CLI config.

The `--with-hook` flag on `deploy` invokes `src/deploy/hook-registrar.mjs`, which writes the hook entry idempotently into `~/.zcode/cli/config.json`:

```json
{
  "hooks": {
    "events": {
      "UserPromptSubmit": [
        {
          "hooks": [
            {
              "type": "process",
              "command": "node",
              "args": ["${ZCODE_PLUGIN_ROOT}/hooks/route.mjs"],
              "timeoutMs": 3500,
              "enabled": true
            }
          ]
        }
      ]
    }
  }
}
```

The `${ZCODE_PLUGIN_ROOT}` literal is preserved in the config; ZCode substitutes it at runtime. Backups of the modified config are written to `logs/backups/` before each write.

### Deploy Subsystem

The deploy subsystem (`src/deploy/`) manages the router-side of the installation:

1. **Plan** (`planner.mjs`): compares `router-skills/` source against the ZCode mirror using SHA-256 hashes. Classifies routers as add, update, or unchanged.
2. **Write** (`writer.mjs`): copies router SKILL.md files to the mirror, writes `.skill-router-meta.json`, creates a timestamped snapshot before any writes, and attempts rollback on error.
3. **Verify** (`verifier.mjs`): post-deploy health check that verifies all expected routers are present with valid meta, no orphan router dirs exist, and the hook is registered.
4. **Hook Registrar** (`hook-registrar.mjs`): `registerHook()`, `unregisterHook()`, `isHookRegistered()`, `detectHookConfigPath()`. Idempotent registration of the `UserPromptSubmit` hook into ZCode's CLI config with backup-before-write.

Snapshots are saved to `logs/deploys/deploy-snapshot-*.json` and can be used for rollback with `deploy --rollback <file>`.

### Feedback Loop

```
┌─────────────────────────────────────────────────────────────────┐
│                     ZCode Editor                              │
│                    (workflow authoring)                       │
└──────────────────────┬────────────────────────────────────────┘
                       │ UserPromptSubmit
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  hooks/route.mjs (subprocess)                                  │
│   ├─ detects $mention → native skill activation                │
│   ├─ BM25 ranks leaf skills                                    │
│   ├─ reads SKILL.md content                                    │
│   ├─ fits into context budget                                  │
│   └─ writes .zcode/output.json + logs JSONL events             │
└──────────────────────┬──────────────────────────────────────────┘
                       │ additionalContext injected into model
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Model responds                             │
│                 (uses injected skill context)                  │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  logs/routing-YYYYMMDD.jsonl                                   │
│   {"ts":"...","mode":"implicit","tier":"bm25",                │
│    "router":null,"selectedSkills":[...],"promptHash":"sha256:.."}│
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  node bin/skill-router.mjs feedback                            │
│   ├─ reads all log files                                       │
│   ├─ summarizes by mode, tier, router, top skills              │
│   └─ reports latency percentiles and fallback rate             │
└─────────────────────────────────────────────────────────────────┘
```

The feedback command aggregates routing decisions from the JSONL log and produces a summary report. In future phases, this feedback data will be used to adjust retrieval parameters (Phase 5) and train semantic embeddings (Phase 6).

## Adaptive Feedback Loop

```
┌─────────────────────────────────────────────────────────────────┐
│                     ZCode Editor                              │
│                    (workflow authoring)                       │
└──────────────────────┬────────────────────────────────────────┘
                       │ UserPromptSubmit
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  Decision: hooks/route.mjs                                     │
│   ├─ BM25 ranks leaf skills                                    │
│   ├─ writes .zcode/output.json                                 │
│   └─ logs decision to logs/routing-YYYYMMDD.jsonl              │
└──────────────────────┬──────────────────────────────────────────┘
                       │ model uses injected context
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  Outcome signals (implicit user behaviour)                     │
│   ├─ retry     : same prompt re-submitted within 5 min         │
│   ├─ rephrase  : prompt rephrased within 5 min                 │
│   ├─ dismiss   : user dismissed suggestion without use         │
│   └─ success   : no corrective signal within 10 min            │
│   Recorded in logs/signals-YYYYMMDD.jsonl                      │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  Attribution: src/core/retriever/attribution.mjs               │
│   ├─ attributeOutcome(decision, outcome, leafIndex)            │
│   ├─ computes per-field BM25 (name, description, keywords)     │
│   ├─ determines dominant field that drove the top-ranked skill │
│   └─ returns Attribution record with dominantField             │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  Weight Update: src/core/retriever/weights.mjs                 │
│   ├─ computeWeights(attributions, currentWeights)              │
│   ├─ positive outcomes → +5% on dominant field                 │
│   ├─ negative outcomes → -5% on dominant field                 │
│   ├─ clamp each weight to [0.5, 5.0]                           │
│   ├─ normalize so sum stays constant                           │
│   └─ require ≥ 20 attributions before changing                  │
└─────────────────────────────────────────────────────────────────┘
```

### Why Adaptation is Bounded

The feedback loop adjusts BM25 field weights but does so under strict constraints to prevent regression:

1. **Minimum sample size** — `computeWeights` requires at least 20 attributed outcomes before producing any change. This prevents noise from a handful of decisions from driving spurious weight shifts.

2. **MaxDelta guardrail** — `src/cli/tune-guard.mjs` enforces `MAX_DELTA = 0.5`: no single field may move more than 0.5 away from the baseline weights in `data/baseline.json`. If the proposed change exceeds this bound, the guard returns `action: "refuse"` and the apply is blocked.

3. **Accuracy tolerance** — `--apply` runs the BM25 benchmark *before* and *after* writing new weights. If Top-1 accuracy drops by more than `ACCURACY_TOLERANCE` (1.0 percentage point), the system automatically rolls back to the pre-change weights.

4. **Weight clamping** — Each field is clamped to `[0.5, 5.0]`. No weight can drop to zero (which would effectively disable a field) or rise unboundedly.

5. **Sum preservation** — After clamping, weights are normalized so their sum equals the original sum. This prevents the total signal strength from drifting upward or downward.

6. **Frozen baseline** — `data/baseline.json` records the authoritative BM25 Top-1 (92.31%) and the default weights (`name: 3, description: 2, keywords: 1`). All guardrail checks reference this file. Users should update it manually via `tune --apply` after a successful run, or regenerate it after a corpus change.

7. **Snapshots** — Every successful `--apply` writes a snapshot to `logs/weights/weights-*.json`. `tune --rollback` restores the most recent snapshot. Rollback is manual; the system never auto-rolls back beyond the pre-benchmark safeguard.

These bounds ensure the feedback loop can nudge weights toward better performance but can never degrade the system below its frozen baseline without explicit user intervention.

## Phase 1 Findings: What Worked and What Did Not

### What Worked

- **BM25 alone is strong.** Top-1 96.9% (126/130) on 130 prompts against 54 real skills. Fast, deterministic, reliable. Median latency 2 ms. This is the mode to use in production when precision matters.
- **Multi-domain routing is functional.** The detector produces reasonable plans using a composite of BM25 signal, coverage signal, and embedding signal. Thresholds (single >= 0.90 with gap > 0.15; multi >= 0.50) are tuned for the current 54-skill / 11-domain corpus and may need re-tuning at scale.
- **Telemetry stack works cleanly.** JSONL logging, ring-buffer metrics, and the human-readable reporter all function as designed with no regressions.
- **Zero-dependency design holds.** All algorithms (BM25, FNV-1a embeddings, RRF, feature extraction) run from pure ESM with no npm packages.
- **Quality validation fixes real problems.** Running `validate` on the real corpus fixed 52 skills with incorrect name prefixes and 54 skills with insufficient content tokens.
- **Sync subsystem works correctly.** SHA-256 based comparison detects drift accurately; mirror protection prevents corruption of user-managed skills.

### What Did Not

- **N-gram embeddings (256-dim, FNV-1a) are insufficient for semantic similarity.** When fused via RRF (`k=60`), the weak embedding signal degrades Top-1 from 97% down to ~54%. Recall@3 improves, but the net effect on precision is negative. This is a documented negative result.
- **Feature-based reranker does not improve Top-1 on the current corpus.** The reranker is opt-in (`--rerank`) and blends a 4-feature lexical score at BLEND=0.01. On 54 skills, reranking produced no measurable Top-1 gain.
- **Synonym expansion dilutes signal on small corpus.** BM25 with `--expand on` drops from 97% to 80% Top-1. The low-IDF synonym noise outweighs recall gains. Keep expansion off by default; tune thresholds before enabling.
- **Embedding dimensionality is too low.** 256 dimensions from FNV-1a hashing means limited resolution per gram. Higher-dimensional hashes or a pre-trained model would be required for meaningful semantic signals.
- **Hierarchical routing is slower than flat at all scales.** Phase 3 benchmark proved flat wins on speed at every corpus size while tying or edgeing out on accuracy. Hierarchical is deprecated as default.

### What We Would Do Differently

Given what we know now, we would skip the hand-rolled n-gram embedding engine entirely and integrate a pre-trained embedding model from the start. The RRF fusion math is sound -- the input quality was the bottleneck. Phase 3 infrastructure work (sync, disable, two-source index) is complete; semantic embedding upgrade should be revisited when a suitable ONNX model is identified.

For the reranker specifically, we would either (a) collect implicit feedback data first and learn the feature weights, or (b) omit it entirely until the corpus grows large enough that lexical overlap becomes a discriminative signal.

### Benchmark Summary (Real Corpus, 130 prompts / 54 skills)

| Mode | Top-1 | Recall@3 | Median Latency | Verdict |
|------|-------|----------|----------------|---------|
| BM25 | 96.9% (126/130) | 89.2% (116/130) | 2 ms | Production-ready |
| BM25 + synonym expand | 80.0% (104/130) | 87.7% | 2 ms | Opt-in; caution -- dilutes signal |
| Hybrid (BM25+FNV-1a) | 53.8% (70/130) | 77.7% | 31 ms | Degrades BM25 baseline |
| Hierarchical (200 skills, exp.) | 50.2% | 84.3% | 9 ms | Slower than flat; not recommended |
| Routing overhead | -- | -- | +3 ms | Acceptable |
