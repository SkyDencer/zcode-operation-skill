# ZCode Skill Router

A local BM25-based skill retrieval plugin for ZCode. Surfaces relevant subagent skills at workflow authoring time by ranking structured skill manifests against the current prompt using lexical search.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/Node.js->=_20-brightgreen)](https://nodejs.org)
[![ZCode >= 3.14.1](https://img.shields.io/badge/ZCode->=_3.14.1-blue)](https://zcode.z.ai)

## Overview

When authoring a ZCode workflow, the agent must know which subagent skills are available. A flat list of all skills is hard to navigate. The Skill Router inspects the current prompt, ranks skills by lexical relevance using BM25, and injects the top results as structured context into the model.

It solves three problems:
1. **Discovery** -- authors no longer need to remember or scroll through a fixed skill list.
2. **Relevance** -- BM25 ranking surfaces the most appropriate skill for the current task.
3. **Performance** -- fully local, zero network calls, median latency around 2 ms.

The system is intentionally lightweight: no external dependencies, no ML models, no persistent state beyond a pre-built JSON index.

## One-Command Install

The fastest way to get started is the one-command install script:

```bash
# Windows (PowerShell)
.\install.ps1 --yes

# Unix / macOS / WSL
./install.sh --yes
```

Or run the Node script directly from any subdirectory of the repository:

```bash
node scripts/install.mjs --yes
```

The script will:

1. Verify Node.js >= 20
2. Confirm it is running from the repository root
3. Build the skill index (`hooks/build-index.mjs`)
4. Preview the sync plan (`sync --dry-run`)
5. Deploy router skills to your ZCode mirror (`deploy --dry-run`)
6. Sync leaf skills to your ZCode mirror (`~/.zcode/skills`)
7. Run a health check (`verify`)
8. Print next steps

To preview without making changes:

```bash
node scripts/install.mjs --dry-run
```

## How It Works

### Retrieval

On every `UserPromptSubmit` event, the hook reads the user's prompt from stdin, loads the pre-built BM25 index from `data/skill-index.json`, and ranks all skills by lexical relevance. The top-k skills (default 5) have their SKILL.md content read and injected into the model context via `output.json`.

BM25 scoring uses configurable field weights (`name x3`, `description x2`, `keywords x1`) and parameters (`k1=1.5`, `b=0.75`). Results are normalized to [0, 1] and classified into confidence bands (`high >= 0.85`, `medium >= 0.60`, `low >= 0.35`, `dismiss < 0.35`) using adaptive thresholds loaded from `data/thresholds.json`.

### Sync to ZCode Mirror

Skills are managed in `data/skills/` and can be synced to the ZCode skills mirror at `~/.zcode/skills/` using the `sync` subcommand. The sync planner compares SHA-256 content hashes between project and mirror, classifying each skill as add, update, remove, unchanged, or disabled.

```bash
# Preview what would change
node bin/skill-router.mjs sync --dry-run

# Apply changes
node bin/skill-router.mjs sync

# Disable a skill in the mirror (mirror mechanism)
node bin/skill-router.mjs sync --disable backend-laravel-eloquent

# Re-enable it
node bin/skill-router.mjs sync --enable backend-laravel-eloquent

# Shadow mechanism: writes a disabled SKILL.md instead of deleting the dir
node bin/skill-router.mjs sync --disable backend-laravel-eloquent --disable-mechanism shadow
```

The sync state is persisted in `.skill-router-sync-state.json` so subsequent runs can detect drift. Disabled skills are tracked in `.skill-router-disabled.json`.

### Disable Mechanism

ZCode has no native per-skill disable mechanism. Skills are discovered by filesystem presence. The router implements a best-guess approach:

- **Mirror mechanism** (default): removes the managed mirror directory entirely. ZCode stops discovering the skill because SKILL.md is gone.
- **Shadow mechanism**: writes a minimal disabled SKILL.md with `disabled: true` frontmatter at the same path, shadowing the real skill. The real directory is preserved so enable can restore it.

Only mirror directories bearing `.skill-router-meta.json` are touched. User-created or hand-edited skills are never modified.

### Two-Source Index

The router supports skills from multiple sources. The default source is the project `data/skills/`. A secondary `zcode-user` source can be configured via `SKILL_ROUTER_SOURCES` environment variable or the `--sources` flag on `reindex`. When the same skill name appears in both sources, project-sourced skills always win (higher priority). Collisions are logged during rebuild.

### Query Cache

Retrieval results are cached in an LRU cache with a 5-minute TTL. Cache keys are computed from the index fingerprint plus a SHA-256 hash of the normalized query. Any index rebuild automatically invalidates all cached entries.

### Context Budget

Selected skill content is fitted within a configurable character budget (default 24,000 chars total, 500 chars minimum per skill). Truncation is paragraph-safe: it never splits mid-paragraph (double-newline boundary).

## Scale

BM25 benchmark results on 130 prompts against 54 real skills:

| Metric | Value | Notes |
|--------|-------|-------|
| Top-1 Accuracy (BM25) | 96.9% (126/130) | Current baseline, domain-prefixed skills |
| Recall@3 | 89.2% (116/130) | |
| Median Latency | 2 ms | |
| P95 Latency | 3 ms | |
| Fallback Rate | 8.5% (11/130) | |
| Cache Hit Rate | <1% | Single-run benchmark; low-repeat prompts |

Synthetic scale benchmarks (N skills, generated prompts matching skill names/keywords):

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

**Note on synthetic benchmarks:** These use randomly generated skill names with no domain vocabulary. The accuracy drop on synthetic data reflects lexical poverty (random tokens don't match prompts), not a scalability limitation of BM25. Real-world performance is anchored by the 96.9% Top-1 result on the actual 54-skill corpus. Larger real corpora remain untested.

Key findings from scale benchmarks:
- Flat BM25 is faster than hierarchical at ALL corpus sizes (2x faster at N=50, narrowing to 1.13x at N=500).
- Flat wins on the real 54-skill corpus (96.9% Top-1); larger real corpora are untested.
- Hierarchical routing is deprecated as default; flat is the primary path. Hierarchical remains available via `--experimental` flag.

Full scale report: [docs/reports/phase-3-scale-benchmark.md](./docs/reports/phase-3-scale-benchmark.md)

## CLI Reference

The project ships a full management CLI at `bin/skill-router.mjs`:

| Subcommand | Description |
|------------|-------------|
| `list` | List all skills grouped by domain with quality scores |
| `add` | Add a single skill from a SKILL.md file |
| `remove` | Remove a skill by name |
| `validate` | Validate all skills against quality rules |
| `reindex` | Rebuild the BM25 index (supports `--sources`) |
| `benchmark` | Run the benchmark suite (`--mode`, `--corpus`) |
| `stats` | Show corpus statistics |
| `import` | Bulk import skills from a directory |
| `sync` | Sync project skills to ZCode mirror (`--dry-run`, `--disable`, `--enable`) |
| `deploy` | Deploy router skills to ZCode mirror (`--dry-run`, `--rollback`, `--verify`) |
| `sources` | List current sources and skill counts |
| `verify` | Health check: sync drift, orphans, index integrity |
| `doctor` | Diagnostic report for the installation |
| `analytics` | Show usage analytics from routing logs |
| `help` | Show help |

```bash
# Quick start
node bin/skill-router.mjs list
node bin/skill-router.mjs validate
node bin/skill-router.mjs reindex
node bin/skill-router.mjs sync --dry-run
node bin/skill-router.mjs deploy --dry-run
node bin/skill-router.mjs verify
node bin/skill-router.mjs doctor
node bin/skill-router.mjs benchmark --mode bm25
```

See [docs/cli-reference.md](./docs/cli-reference.md) for full subcommand documentation.

## Two-Mode Routing

The router supports two complementary routing modes:

- **Explicit mode** (`$mention`) — When the prompt contains a `$`-prefixed alias such as `$next`, `$laravel`, `$react`, `$design`, `$test`, or `$meta`, the router resolves it to a router skill and scopes BM25 retrieval to that router's domain only. The `$mention` is stripped from the prompt before ranking.
- **Implicit mode** (no `$`) — When no `$` mention is present, the router runs pure BM25 over the leaf-skill corpus (excluding router skills from lexical ranking). This is the default path for ordinary authoring prompts.

Router skills live in `router-skills/` and are indexable dispatchers; leaf skills live in `data/skills/` and contain the actual workflow instructions. The hook detects explicit mentions before retrieval (`hooks/route.mjs:125`) and routes each path independently.

### Example Prompts

```
# Explicit: dispatches to router-laravel, BM25 scoped to backend skills
"$laravel write a migration for user preferences"

# Explicit: dispatches to router-next, BM25 scoped to frontend skills
"$next set up ISR for a blog post"

# Implicit: pure BM25 over all leaf skills
"optimize eager loading in Laravel"

# Implicit: pure BM25 over all leaf skills
"how to use React hooks for state management"
```

Alias resolution order: full router name (`$router-next`) > short alias (`$next`) > silently ignored if unknown. Alias lookup is case-insensitive.

See [router-skills/README.md](./router-skills/README.md) for the full router catalog and [src/config/aliases.mjs](./src/config/aliases.mjs) for the alias table.

## Deploying Router Skills

Router skills are managed separately from leaf skills and deployed to the ZCode mirror via the `deploy` subcommand:

```bash
# Preview what would be deployed
node bin/skill-router.mjs deploy --dry-run

# Deploy router skills and apply leaf disables
node bin/skill-router.mjs deploy

# Deploy and verify health
node bin/skill-router.mjs deploy --verify

# Roll back from a snapshot
node bin/skill-router.mjs deploy --rollback ./path/to/snapshot.json
```

Deploy plans compare `router-skills/` source against the ZCode mirror using SHA-256 hashes. Routers are added or updated; leaf skills listed in `.skill-router-disabled.json` are disabled via the shadow mechanism. A snapshot is saved before any writes, enabling rollback on failure.

## SLM Status

Small-language-model (SLM) routing is **disabled by default** (`slm.enabled: false`). The system runs pure BM25 unless SLM is explicitly enabled via `SKILL_ROUTER_SLM_ENABLED=true`.

Phase 2 benchmark results on 30 prompts show that Qwen2.5-0.5B does **not** outperform BM25 on this corpus:

| Mode | Top-1 | Set Recall | Latency p50 |
|------|-------|------------|-------------|
| BM25-Only | 46.67% | 0.7000 | ~3 ms |
| SLM-Only | 20.00% | 0.0972 | ~182 ms |
| Hybrid | 46.67% | 0.5750 | ~1484 ms |

Hybrid achieves parity with BM25 on Top-1 but degrades on Set Recall and adds ~1.5 s latency per prompt, which exceeds the hook timeout budget.

To enable SLM for experimentation:

```bash
SKILL_ROUTER_SLM_ENABLED=true node hooks/route.mjs
```

Or in the benchmark runner:

```bash
node tests/slm-benchmark/runner.mjs --mode hybrid --slm
```

**Note:** Larger models (1.5B+) may perform better. The 0.5B model is insufficient for meaningful semantic reranking on this skill corpus. See [docs/reports/phase-2-slm-benchmark.md](./docs/reports/phase-2-slm-benchmark.md) for full results.

## Limitations

- **Synonym expansion degrades Top-1** on the current 54-skill corpus (80% vs 97% with expansion off). Keep expansion off by default.
- **Synthetic scale accuracy is low** due to prompt-skill distribution mismatch, not algorithm failure. The real 54-skill corpus achieves 96.9% Top-1.
- **FNV-1a n-gram embeddings** (256-dim) are insufficient for semantic search. Hybrid mode degrades BM25 precision. Phase 3 targeted infrastructure; semantic embedding upgrade is planned for a future phase.
- **Hierarchical routing is slower** than flat at all corpus sizes. It is deprecated as default but remains available experimentally.
- **Disable mechanism is filesystem-based** and depends on ZCode's skill discovery behavior. It may not work in all ZCode configurations.
- **No pre-trained embedding model** -- all search is lexical (BM25). Semantic search requires a Phase 4+ upgrade.
- **Single-runner cache** -- the query cache shows <1% hit rate on single-run benchmarks because prompts are not repeated. Cache benefits accumulate in long-running sessions.

## Project Structure

```
zcode-operation-skill/
├── .zcode-plugin/
│   └── plugin.json           # Plugin manifest
├── bin/
│   └── skill-router.mjs      # CLI entry point (15 subcommands)
├── hooks/
│   ├── hooks.json            # Hook registration
│   ├── route.mjs             # Main hook: stdin -> route -> output
│   └── build-index.mjs       # Index + embeddings + domain registry builder
├── src/
│   ├── index.mjs             # Public API surface (re-exports)
│   ├── loader.mjs            # SKILL.md frontmatter parser + loadSkills()
│   ├── scorer.mjs            # BM25 formula + IDF + tokenize()
│   ├── logger.mjs            # Structured JSONL logger
│   ├── config/
│   │   ├── defaults.mjs      # All tunable parameters
│   │   ├── env.mjs           # SKILL_ROUTER_* env override merge
│   │   └── aliases.mjs       # $mention alias → router skill name mapping
│   ├── core/
│   │   ├── retriever/
│   │   │   ├── bm25.mjs      # rankSkills() with field-weighted BM25
│   │   │   └── hybrid.mjs    # BM25 + embeddings via RRF fusion; routeWithExplicit
│   │   ├── routing/
│   │   │   ├── hierarchical.mjs  # 3-stage domain-first retrieval (experimental)
│   │   │   ├── explicit.mjs        # detectExplicitSkill() — $-mention detection
│   │   │   ├── domain-registry.mjs # Domain metadata CRUD + matching
│   │   │   ├── planner.mjs         # Single/multi/fallback planning
│   │   │   └── selector.mjs        # Flat vs hierarchical selector (flat default)
│   │   ├── cache/
│   │   │   ├── lru.mjs         # LRU cache (O(1) via Map)
│   │   │   └── query-cache.mjs # TTL-backed query cache
│   │   ├── budget/
│   │   │   ├── manager.mjs     # fitWithinBudget() with paragraph-safe truncation
│   │   │   └── truncator.mjs   # truncateAtParagraph()
│   │   ├── retrieval/
│   │   │   ├── synonyms.mjs    # buildSynonymMap() from curated + co-occurrence
│   │   │   └── expander.mjs    # expandQuery() with IDF filtering
│   │   ├── reranker/
│   │   │   ├── engine.mjs      # Feature-based reranking (opt-in)
│   │   │   └── features.mjs    # keyword, bigram, domain, title features
│   │   ├── embeddings/
│   │   │   └── engine.mjs      # Zero-deps FNV-1a n-gram embeddings
│   │   ├── slm/
│   │   │   ├── client.mjs      # HTTP client for local SLM server
│   │   │   ├── parser.mjs      # Parse SLM response into ranked skills
│   │   │   ├── prompt-builder.mjs  # Build prompts for SLM classification
│   │   │   ├── errors.mjs      # SLM error types
│   │   │   └── index.mjs       # Re-exports
│   │   └── telemetry/
│   │       ├── logger.mjs      # JSONL logging (hash-only queries)
│   │       ├── metrics.mjs     # Ring-buffer p50/p95/p99 metrics
│   │       └── reporter.mjs    # Human-readable markdown reports
│   ├── quality/
│   │   ├── validator.mjs       # validateSkill() with 6-field checks
│   │   └── reporter.mjs        # Markdown + console report formatters
│   ├── import/
│   │   ├── scanner.mjs         # scanSource() with symlink safety
│   │   ├── importer.mjs        # importSkills() with collision detection
│   │   └── reporter.mjs        # Import report formatters
│   ├── analytics/
│   │   ├── reader.mjs          # Read and parse JSONL log files
│   │   ├── analyzer.mjs        # Compute metrics from parsed entries
│   │   └── reporter.mjs        # Markdown analytics report
│   ├── tuning/
│   │   ├── optimizer.mjs       # Grid-search threshold optimizer
│   │   └── report.mjs          # Threshold report formatter
│   ├── sync/
│   │   ├── planner.mjs         # planSync(): compare project vs mirror
│   │   ├── writer.mjs          # applySync(): safe mirror write
│   │   ├── state.mjs           # read/write .skill-router-sync-state.json
│   │   └── disabler.mjs        # disableSkill()/enableSkill(), disabled registry
│   ├── index/
│   │   └── dedupe.mjs          # resolveCollisions(): project wins over zcode-user
│   ├── deploy/
│   │   ├── planner.mjs         # planDeploy(): compare router-skills/ vs mirror
│   │   ├── writer.mjs          # applyDeploy(): copy routers, snapshot, rollback
│   │   └── verifier.mjs        # verifyDeploy(): post-deploy health checks
│   └── cli/
│       ├── list.mjs            # List skills by domain with quality
│       ├── add.mjs             # Add a single skill
│       ├── remove.mjs          # Remove a skill by name
│       ├── validate.mjs        # Run quality validator
│       ├── reindex.mjs         # Rebuild index (supports --sources)
│       ├── benchmark.mjs       # Run benchmark suite
│       ├── stats.mjs           # Corpus statistics
│       ├── import.mjs          # Bulk import skills
│       ├── sync.mjs            # Sync to ZCode mirror
│       ├── deploy.mjs          # Deploy router skills to ZCode mirror
│       ├── sources.mjs         # List sources and collisions
│       ├── verify.mjs          # Health checks (5 checks)
│       ├── doctor.mjs          # Diagnostic report
│       ├── analytics.mjs       # Show usage analytics
│       └── help.mjs            # CLI help text
├── data/
│   ├── skills/                 # Production SKILL.md manifests
│   ├── mock-skills/            # Test fixture skills
│   ├── skills-synthetic/       # Synthetic scale-test corpus
│   ├── domains/                # Domain metadata (meta.json per domain)
│   ├── skill-index.json        # Built BM25 index (output of build-index)
│   ├── skill-embeddings.json   # Pre-computed embeddings
│   ├── synonyms-curated.json   # Hand-curated synonym pairs (54 entries)
│   ├── thresholds.json         # Optimized confidence thresholds
│   ├── skill-router-disabled.json   # Disabled skills registry (generated)
│   └── skill-router-sync-state.json # Last sync state (generated)
├── router-skills/              # Router dispatcher skills (auto-scanned by build-index)
├── tests/
│   ├── run-benchmark.mjs       # Benchmark runner
│   ├── prompts.json            # 130 test prompts
│   ├── expected-routes.json    # Expected top-1 skill per prompt
│   ├── scale/                  # Synthetic corpus generator + runner
│   ├── two-mode-benchmark/     # Two-mode routing benchmark
│   ├── slm-benchmark/          # SLM benchmark runner
│   └── {module}.test.mjs       # Per-module unit tests
├── logs/                       # Runtime JSONL logs
├── docs/
│   ├── reports/                # Generated phase reports
│   ├── ai-context.md           # Technical architecture
│   ├── architecture.md         # Full module reference
│   ├── implementation-plan.md  # Phase table and ordering rationale
│   ├── current-state.md        # Entry log and active phase status
│   ├── decision-dictionary.md  # Recorded decisions (D1-D25)
│   ├── cli-reference.md        # CLI subcommand reference
│   ├── getting-started.md      # 5-minute tour for new users
│   ├── skill-authoring.md      # How to write high-quality skills
│   ├── problems.md             # Open and resolved issues
│   └── manager-playbook.md     # Project manager guide
├── AGENTS.md                   # Mandatory workflow rules for subagents
├── README.md                   # This file
├── CHANGELOG.md                # Version history
└── package.json                # ESM project, build-index and benchmark scripts
```

## Documentation

| File | Purpose |
|---|---|
| [docs/ai-context.md](./docs/ai-context.md) | Technical architecture, BM25 algorithm, confidence policy, hook contract |
| [docs/architecture.md](./docs/architecture.md) | Full module reference including all Phase 3 additions |
| [docs/implementation-plan.md](./docs/implementation-plan.md) | Phase table with ordering rationale |
| [docs/current-state.md](./docs/current-state.md) | Entry log and active phase status |
| [docs/decision-dictionary.md](./docs/decision-dictionary.md) | Recorded decisions (D1-D25) |
| [docs/cli-reference.md](./docs/cli-reference.md) | Every CLI subcommand documented with examples |
| [docs/getting-started.md](./docs/getting-started.md) | 5-minute tour for new users |
| [docs/skill-authoring.md](./docs/skill-authoring.md) | How to write high-quality SKILL.md files |
| [docs/problems.md](./docs/problems.md) | Open and resolved issues |
| [docs/manager-playbook.md](./docs/manager-playbook.md) | Project manager guide and escalation triggers |
| [docs/reports/phase-3-scale-benchmark.md](./docs/reports/phase-3-scale-benchmark.md) | Phase 3 scale benchmark and findings |
| [AGENTS.md](./AGENTS.md) | Mandatory workflow rules for all subagents |

## Roadmap

| Phase | Title | Description | Status |
|---|---|---|---|
| 0 | Spike - Feasibility Check | Confirm ZCode hook contract, verify BM25 viability on small corpus | Complete |
| 1 | Skeleton & Infrastructure | Project scaffolding, module structure, Logger baseline, hybrid retriever, reranker, multi-domain routing, telemetry, 54-skill corpus | Complete |
| 2 | Scale & Tooling | Hierarchical routing, quality validator, CLI management tool, adaptive threshold tuning, synonym expansion, query cache, context budget manager, usage analytics, external skill import, scale benchmarks | Complete |
| 3 | Sync & Infrastructure | ZCode skill sync, disable mechanism, two-source index, verify/doctor CLI, routing selector (flat default), scale benchmark validation, two-mode routing ($mention detection), router skill deploy subsystem | Complete |
| 4 | Log Rotation & Cleanup | Implement 30-day log rotation, disk-space monitoring, stale cache eviction | Planned |
| 5 | Feedback Loop | Collect implicit user corrections (skill dismissed / manually selected) and use them to adjust field weights | Planned |
| 6 | Semantic Embedding Upgrade | Replace FNV-1a n-gram embeddings with a pre-trained local model (e.g., ONNX transformer) for meaningful semantic signals | Planned |
| 7 | Polishing | Edge-case hardening, error recovery, comprehensive documentation | Planned |

See [docs/implementation-plan.md](./docs/implementation-plan.md) for full ordering rationale.

## Contributing

Contributions are welcome. Please read `AGENTS.md` before making any changes -- it contains mandatory workflow rules including the requirement to read `docs/ai-context.md`, `docs/implementation-plan.md`, and `docs/current-state.md` before starting work. All changes should be left uncommitted; the project manager controls commits.

## License

MIT. See [LICENSE](./LICENSE).
