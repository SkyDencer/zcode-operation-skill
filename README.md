# ZCode Skill Router

A local BM25-based skill retrieval plugin for ZCode that surfaces the most relevant subagent skills at workflow authoring time — fast, deterministic, zero network calls.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/Node.js->=_20-brightgreen)](https://nodejs.org)
[![ZCode >= 3.14.1](https://img.shields.io/badge/ZCode->=_3.14.1-blue)](https://zcode.z.ai)

## Quick start

```bash
git clone https://github.com/SkyDencer/zcode-operation-skill.git
cd zcode-operation-skill
node scripts/install.mjs --yes
node bin/skill-router.mjs deploy
```

Restart ZCode. Type `$laravel fix N+1 query` or `optimize eager loading in Laravel` in the editor — the router surfaces relevant skills automatically. To undo: `node scripts/install.mjs --dry-run` previews; remove the hook manually with the snippet below, then delete the project directory.

```bash
node -e "
import { detectHookConfigPath, unregisterHook } from './src/deploy/hook-registrar.mjs';
const configPath = detectHookConfigPath();
if (configPath) { unregisterHook(configPath); console.log('Hook unregistered from', configPath); }
else { console.log('No hook config found'); }
"
```

Full guides: [Install](./docs/install.md) · [Configure](./docs/configure.md) · [Troubleshoot](./docs/troubleshooting.md) · [FAQ](./docs/faq.md)

## What it does

When you type in the ZCode workflow editor, the router inspects your prompt, ranks all available skills by lexical relevance using BM25, and injects the top results as structured context into the model. It solves three problems:

1. **Discovery** — authors no longer need to remember or scroll through a flat list of skills.
2. **Relevance** — BM25 ranking surfaces the most appropriate skill for the current task.
3. **Performance** — fully local, zero network calls, median latency around 32 ms.

## How it works

### Explicit routing (`$mention`)

Prompts containing a `$`-prefixed alias dispatch to a router skill:

```
$next set up ISR for a blog post     → routes to router-next, scores frontend skills
$laravel write a migration           → routes to router-laravel, scores backend skills
$react hooks for state               → routes to router-react, scores frontend skills
```

Alias resolution order: full router name (`$router-next`) > short alias (`$next`) > silently ignored if unknown.

### Implicit routing (BM25)

All other prompts are routed implicitly via pure BM25 over the leaf-skill corpus. Router skills are excluded from implicit ranking. The hook reads the pre-built index from `data/skill-index.json`, ranks skills, reads full SKILL.md content for the top results, fits content into the context budget with paragraph-safe truncation, and writes `.zcode/output.json`.

If anything fails (missing index, timeout, parse error), the hook exits 0 with no output — **fail-open** behaviour so ZCode is never blocked.

## Benchmark results

Two corpora are in play. Both are current; do not conflate them:

| Metric | 258-entry benchmark index | 247-skill scale ceiling |
|--------|--------------------------|-------------------------|
| Top-1 Accuracy (BM25) | **64.62% (84/130)** | **78.43% (160/204)** |
| Recall@3 | 70.77% (92/130) | 86.27% (176/204) |
| Set Recall@5 | 85.38% (all prompts) / 88.79% (skill-only 103/116) | 92.65% (all prompts) |
| Median latency | 32 ms | 29 ms |
| P95 latency | 39.1 ms | 44–53 ms |
| Fallback rate | 6.15% (8/130) | 3.92% (8/204) |

The frozen baseline (`data/baseline.json`) records the 258-entry index figures; the scale figures come from the 247-skill stratified sample of the 252-leaf real corpus (`docs/reports/phase-7.4-scale-benchmark.md`, `docs/reports/phase-7.5-scale-analysis.md`). Top-1 is below 90% at every measured size on this prompt set — the trend is upward with corpus size, and the 90% target is not reached. Full results: `node tests/run-benchmark.mjs --mode bm25` and `node tests/scale-benchmark/runner.mjs --prompts-path tests/scale-benchmark/prompts.json`.

Synthetic scale benchmarks (random names, no domain vocabulary) are in [docs/architecture.md](./docs/architecture.md) under "Scale Findings"; they measure algorithm behaviour, not real-world quality.

## Embeddings

**BM25-only is the default. The semantic (ONNX) path is experimental and not recommended.**

The shipped configuration uses only lexical retrieval (`embeddings.provider: 'bm25-only'` in `src/config/defaults.mjs:100`). The `fnv1a` alias points to the same zero-dependency FNV-1a provider. The `onnx` provider is retained in the tree but is **experimental**: selecting it logs an `experimental_mode` telemetry event, warns on stderr, and on this corpus scores below pure BM25 at 1445 ms median latency. See [docs/embeddings.md](./docs/embeddings.md) and decision D29 in [docs/decision-dictionary.md](./docs/decision-dictionary.md).

## CLI reference

```bash
node bin/skill-router.mjs <subcommand> [options]
```

| Subcommand | Description |
|------------|-------------|
| `list` | List all skills grouped by domain with quality scores |
| `add` | Add a new skill from a SKILL.md file |
| `remove` | Remove a skill by name |
| `validate` | Validate all skills against quality rules |
| `reindex` | Rebuild the BM25 index |
| `benchmark` | Run the benchmark suite (`--mode bm25|hybrid`) |
| `stats` | Show corpus statistics |
| `import` | Bulk import skills from a directory |
| `corpus` | Fetch, validate, measure and import external corpora |
| `sync` | Sync project skills to the ZCode mirror |
| `deploy` | Deploy router skills and register the hook |
| `sources` | List current sources and skill counts |
| `verify` | Health check: sync drift, orphans, index integrity |
| `doctor` | Diagnostic report for the installation |
| `feedback` | Show routing feedback summary |
| `health` | Quick health status (8 checks) |
| `tune` | Adaptive BM25 weight tuning |
| `help` | Show help |

Common patterns:

```bash
# Verify installation
node bin/skill-router.mjs health
node bin/skill-router.mjs verify

# Run the benchmark
node bin/skill-router.mjs benchmark --mode bm25

# Inspect the corpus
node bin/skill-router.mjs list
node bin/skill-router.mjs stats
node bin/skill-router.mjs validate

# Add a skill
node bin/skill-router.mjs add ./my-skill/SKILL.md
node bin/skill-router.mjs reindex

# Inspect logs and feedback
node bin/skill-router.mjs analytics
node bin/skill-router.mjs feedback --outcomes
node bin/skill-router.mjs tune --status
```

Full reference: [docs/cli-reference.md](./docs/cli-reference.md).

## Project structure

```
zcode-operation-skill/
├── bin/skill-router.mjs          # CLI entry point (19 subcommands)
├── hooks/
│   ├── hooks.json                # Hook registration manifest
│   ├── route.mjs                 # Main hook: stdin → route → output
│   └── build-index.mjs           # Index + embeddings builder
├── src/
│   ├── config/                   # Defaults, env overrides, aliases
│   ├── core/                     # Retrieval engines (BM25, embeddings, routing)
│   ├── telemetry/                # Decision logs, signals, outcomes
│   ├── sync/                     # Project ↔ mirror sync
│   ├── deploy/                   # Router deployment + hook registrar
│   ├── tuning/                   # Threshold optimizer
│   ├── quality/                  # Skill validation
│   ├── analytics/                # Log analysis
│   ├── corpus/                   # External corpus fetch/import (7.2)
│   └── cli/                      # CLI subcommands
├── data/
│   ├── skills/                   # Production SKILL.md manifests (252 leaves)
│   ├── domains/                  # Domain metadata
│   ├── skill-index.json          # Built BM25 index
│   ├── skill-index.prebuilt.json # Parsed-index cache (Sub-Phase 7.6)
│   ├── thresholds.json           # Optimised confidence thresholds
│   └── baseline.json             # Frozen benchmark baseline
├── router-skills/                # Router dispatcher skills (6)
├── tests/                        # Test suites
├── logs/                         # Runtime JSONL logs
├── docs/                         # Documentation
├── scripts/                      # Build and maintenance scripts
├── install.sh                    # Unix/macOS install wrapper
├── install.ps1                   # Windows install wrapper
└── package.json                  # ESM project, no required dependencies
```

## Documentation

| File | Purpose |
|------|---------|
| [docs/install.md](./docs/install.md) | Prerequisites, step-by-step install, verification, uninstall |
| [docs/configure.md](./docs/configure.md) | All environment variables, defaults, providers, thresholds |
| [docs/troubleshooting.md](./docs/troubleshooting.md) | Diagnostics and fixes for common problems |
| [docs/faq.md](./docs/faq.md) | Frequently asked questions |
| [docs/ai-context.md](./docs/ai-context.md) | Technical architecture and component reference |
| [docs/architecture.md](./docs/architecture.md) | Full module reference with diagrams |
| [docs/embeddings.md](./docs/embeddings.md) | Embedding provider comparison and decision record |
| [docs/tuning.md](./docs/tuning.md) | Adaptive feedback loop documentation |
| [docs/skill-authoring.md](./docs/skill-authoring.md) | How to write high-quality SKILL.md files |
| [docs/cli-reference.md](./docs/cli-reference.md) | Every CLI subcommand documented |
| [docs/decision-dictionary.md](./docs/decision-dictionary.md) | Recorded design decisions (D1–D39) |
| [docs/implementation-plan.md](./docs/implementation-plan.md) | Phase table and ordering rationale |
| [docs/current-state.md](./docs/current-state.md) | Entry log and active phase status |

## Contributing

Contributions are welcome. Please read [AGENTS.md](./AGENTS.md) before making any changes — it contains mandatory workflow rules. All changes should be left uncommitted; the project manager controls commits.

No new npm dependencies without an explicit decision recorded in `docs/decision-dictionary.md`. Every new module must have a JSDoc header and must not exceed 400 lines.

## License

MIT. See [LICENSE](./LICENSE).
