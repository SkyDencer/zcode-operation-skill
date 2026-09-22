# ZCode Skill Router

A local BM25-based skill retrieval plugin for ZCode. Surfaces relevant subagent skills at workflow authoring time by ranking structured skill manifests against the current prompt using lexical search.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/Node.js->=_20-brightgreen)](https://nodejs.org)
[![ZCode >= 3.14.1](https://img.shields.io/badge/ZCode->=_3.14.1-blue)](https://zcode.z.ai)

## Overview

When authoring a ZCode workflow, the agent must know which subagent skills are available. A flat list of all skills is hard to navigate. The Skill Router inspects the current prompt, ranks skills by lexical relevance using BM25, and injects the top results as structured context into the model.

It solves three problems:
1. **Discovery** — authors no longer need to remember or scroll through a fixed skill list.
2. **Relevance** — BM25 ranking surfaces the most appropriate skill for the current task.
3. **Performance** — fully local, zero network calls, median latency around 3 ms.

The system is intentionally lightweight: no external dependencies, no ML models, no persistent state beyond a pre-built JSON index.

## Architecture

```
UserPromptSubmit Hook
       │
       ▼
┌─────────────────┐
│   route.mjs     │  reads stdin, validates payload
│   (hook layer)  │  delegates to rankSkills()
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  skill-index.   │  flat-array index built by
│     json        │  build-index.mjs from SKILL.md frontmatter
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  retriever.mjs  │  BM25 scoring + tokenization
│   (BM25)        │  returns ranked { name, score }[]
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   scorer.mjs    │  min-max normalizes scores to 0–1
│ (confidence)    │  applies fixed thresholds:
│                 │   high >= 0.85, medium >= 0.60, low >= 0.35
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  additional-    │  skill content injected as
│    Context      │  markdown blocks into hook output
└────────┬────────┘
         │
         ▼
       Model
```

## Features

- **BM25 lexical retrieval** (default, recommended) with configurable `k1=1.5`, `b=0.75` parameters.
- **Hybrid retrieval** (experimental) — fuses BM25 rankings with n-gram embeddings via Reciprocal Rank Fusion (`k=60`). Available via `--mode hybrid`; underperforms BM25 on the current 54-skill corpus but is retained for Phase 2 experimentation.
- **Feature-based reranker** (opt-in, experimental) — reranks results using keyword, bigram, domain, and title features. Does not consistently improve Top-1 on the current corpus. Enable with `--rerank`.
- **Flat-array index** built from `data/mock-skills/*/SKILL.md` frontmatter (name, description, keywords, domains).
- **Confidence policy** with three bands (high / medium / low) applied to normalized scores.
- **Zero dependencies** — pure ESM, no `npm install`.
- **Structured JSONL logging** to `logs/YYYY-MM-DD.jsonl` with event, query, duration, and error fields.
- **Deterministic** — same input always produces the same ranking.
- **RFC-like hook contract** — reads stdin JSON, writes `hookSpecificOutput` with `additionalContext` to `.zcode/output.json`.

## Phase 1 Benchmark

Phase 1 is complete. Benchmark results on 130 prompts against 54 skills:

| Metric                        | Value                | Target  | Pass? |
|-------------------------------|----------------------|---------|-------|
| Top-1 Accuracy (BM25)         | 97.7% (127/130)      | —       | —     |
| Recall@3 (BM25)               | 97.7% (127/130)      | —       | —     |
| Median Latency (BM25)         | 3 ms                 | < 50 ms | Yes   |
| Top-1 Accuracy (Hybrid)       | 61.5% (80/130)       | —       | —     |
| Recall@3 (Hybrid)             | 83.1% (108/130)      | —       | —     |
| Median Latency (Hybrid)       | 11 ms                | —       | —     |
| Reranker improvement (BM25)   | None observed        | —       | —     |

**Notes:**
- Hybrid mode (BM25 + n-gram embeddings via RRF) is available for experimentation but underperforms BM25 on the current 54-skill corpus. Improving hybrid retrieval is on the Phase 2 roadmap.
- The feature-based reranker is opt-in. On small corpora it does not consistently improve accuracy. Enable with `--rerank` to experiment.

Full report: [docs/reports/phase-1-final-report.md](./docs/reports/phase-1-final-report.md)

## Installation

### Prerequisites

- Node.js >= 20
- ZCode >= 3.14.1

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/SkyDencer/zcode-operation-skill.git
cd zcode-operation-skill

# 2. Build the skill index from mock skill fixtures
npm run build-index

# 3. Install the plugin into your ZCode workspace
#    Copy the project directory into your ZCode workspace plugins folder:
#    <ZCODE_HOME>/workspace/default/plugins/zcode-skill-router/
#    Then register it in <ZCODE_HOME>/workspace/default/plugins/marketplace.json:
#    { "source": "directory", "path": "<absolute/path/to/zcode-operation-skill>" }

# 4. Restart ZCode
```

### Verify installation

```bash
# Run the benchmark suite
npm run benchmark
```

## Usage

### Building the index

```bash
npm run build-index
```

Reads all `data/skills/*.md` and `data/mock-skills/*/SKILL.md` files, parses YAML-like frontmatter, and writes `data/skill-index.json` plus `data/skill-embeddings.json`.

### Running benchmarks

```bash
# BM25 mode (default, recommended)
node tests/run-benchmark.mjs --mode bm25

# Hybrid mode (BM25 + embeddings via RRF)
node tests/run-benchmark.mjs --mode hybrid

# BM25 mode with opt-in reranker
node tests/run-benchmark.mjs --mode bm25 --rerank
```

Evaluates Top-1 accuracy, Recall@3, median latency, and no-skill rate against `tests/prompts.json` and `tests/expected-routes.json`.

### Hook invocation

The `UserPromptSubmit` hook is triggered by ZCode when a user submits a prompt. It:
1. Reads the prompt JSON from stdin.
2. Calls `rankSkills(prompt, index)` from `src/retriever.mjs`.
3. Applies the confidence policy from `src/scorer.mjs`.
4. Reads the full skill content for top-ranked skills.
5. Writes a JSON response to `.zcode/output.json` with `hookSpecificOutput.additionalContext`.

### Log format

```jsonl
{"ts":"2026-09-20T12:00:00.000Z","event":"retrieve","query":"deploy aws lambda","resultCount":3,"durationMs":12}
{"ts":"2026-09-20T12:00:00.001Z","event":"build","totalDocs":10,"totalTerms":87,"durationMs":87}
```

Logs rotate daily into `logs/YYYY-MM-DD.jsonl`.

## Project Structure

```
zcode-operation-skill/
├── .zcode-plugin/
│   └── plugin.json           # Plugin manifest (name, version, engines, skills path)
├── hooks/
│   ├── hooks.json            # Hook registration for UserPromptSubmit
│   ├── route.mjs             # Main hook: reads stdin, ranks, writes output
│   └── build-index.mjs       # Builds data/skill-index.json from SKILL.md files
├── src/
│   ├── index.mjs             # SkillIndex class (reserved for future inverted index)
│   ├── retriever.mjs         # rankSkills(query, index) + readSkillContent()
│   ├── scorer.mjs            # BM25 scoring + confidence normalization
│   ├── loader.mjs            # JSON manifest loader (currently unused, legacy)
│   └── logger.mjs            # Structured JSONL logger
├── data/
│   ├── mock-skills/          # 10 sample SKILL.md fixtures
│   └── skill-index.json      # Built index (output of npm run build-index)
├── tests/
│   ├── prompts.json          # 20 test prompts
│   ├── expected-routes.json  # Expected top-1 skill per prompt
│   └── run-benchmark.mjs     # Benchmark runner
├── logs/                     # Runtime JSONL logs
├── docs/
│   ├── reports/              # Generated phase reports
│   ├── ai-context.md         # Technical architecture
│   ├── implementation-plan.md#  Phase table and ordering rationale
│   ├── current-state.md      # Entry log and active phase tracker
│   ├── decision-dictionary.md# Decisions D1–D8
│   ├── problems.md           # Open and resolved issues
│   └── manager-playbook.md   # Project manager guide
├── AGENTS.md                 # Mandatory workflow rules for subagents
├── README.md                 # This file
├── LICENSE                   # MIT License
└── package.json              # ESM project, build-index and benchmark scripts
```

## Documentation

| File | Purpose |
|---|---|
| [docs/ai-context.md](./docs/ai-context.md) | Technical architecture, BM25 algorithm, confidence policy, hook contract |
| [docs/implementation-plan.md](./docs/implementation-plan.md) | Phase table with ordering rationale |
| [docs/current-state.md](./docs/current-state.md) | Entry log and active phase status |
| [docs/decision-dictionary.md](./docs/decision-dictionary.md) | Recorded decisions (D1–D8) |
| [docs/problems.md](./docs/problems.md) | Open and resolved issues |
| [docs/manager-playbook.md](./docs/manager-playbook.md) | Project manager guide and escalation triggers |
| [docs/reports/phase-0-spike-20260920.md](./docs/reports/phase-0-spike-20260920.md) | Phase 0 benchmark and hook-contract report |
| [docs/reports/phase-0.5b-deployment-20260921.md](./docs/reports/phase-0.5b-deployment-20260921.md) | Deployment report and manual test plan |
| [AGENTS.md](./AGENTS.md) | Mandatory workflow rules for all subagents |

## Roadmap

| Phase | Title                        | Description                                                                                          | Status     |
|---|---|---|---|
| 0 | Spike — Feasibility Check | Confirm ZCode hook contract, verify BM25 viability on small corpus | Complete |
| 1 | Skeleton & Infrastructure | Project scaffolding, module structure, Logger baseline, hybrid retriever, reranker, multi-domain routing, telemetry, 54-skill corpus | Complete |
| 2 | Adaptive Learning | Learn from implicit feedback; adjust BM25 field weights and embedding vectors based on user corrections | In Progress |
| 3 | Index Builder | Implement `src/index.mjs` with inverted index; wire `build-index.mjs` hook | Planned |
| 4 | Retriever + Scorer | BM25 scoring in `src/retriever.mjs` and `src/scorer.mjs`; wired confidence policy | Planned |
| 5 | Hook Integration | Implement `hooks/skill-router.mjs`; validate against ZCode 3.14.1 authoring context payload | Planned |
| 6 | Benchmark Suite | `tests/run-benchmark.mjs` covering correctness, latency, and confidence-threshold behaviour | Planned |
| 7 | Polish & Documentation | Edge-case hardening, error recovery, README update, decision-dictionary entries | Planned |

See [docs/implementation-plan.md](./docs/implementation-plan.md) for full ordering rationale.

## Contributing

Contributions are welcome. Please read `AGENTS.md` before making any changes — it contains mandatory workflow rules including the requirement to read `docs/ai-context.md`, `docs/implementation-plan.md`, and `docs/current-state.md` before starting work. All changes should be left uncommitted; the project manager controls commits.

## License

MIT. See [LICENSE](./LICENSE).
