# FAQ — Skill Router

Frequently asked questions about the ZCode Skill Router.

## Why BM25 and not embeddings?

BM25 is the default because it is fast, deterministic, and accurate on this corpus — with zero dependencies. The frozen baseline measures **92.31% Top-1** (120/130) on the benchmark index and **96.92% Top-1** (126/130) on the 54-leaf corpus the hook actually searches (`data/baseline.json`). Latency is 2–5 ms median.

Semantic embeddings were evaluated in Phase 6 using an ONNX transformer model (Xenova/all-MiniLM-L6-v2, 384-dim). On the same corpus, the ONNX provider scored 76.15% Top-1 with the semantic channel on — below the pure BM25 baseline — and cost 1445 ms median latency, 14x the 100 ms budget the decision rule allowed. The full comparison is in [docs/reports/phase-6-embedding-benchmark.md](./reports/phase-6-embedding-benchmark.md) and [docs/reports/phase-7.1-semantic-decision.md](./reports/phase-7.1-semantic-decision.md).

The FNV-1a n-gram embeddings (256-dim, zero dependencies) are available as an alias (`fnv1a` = `bm25-only`) but are not used on the default path because the semantic RRF weight is 0.0 — the embedding channel is never constructed.

## Why is SLM disabled?

Small-language-model routing (`SKILL_ROUTER_SLM_ENABLED=true`) is disabled by default because Phase 2 benchmarks showed the 0.5B Qwen model **underperforms BM25** on this corpus:

| Mode | Top-1 | Set Recall | Latency p50 |
|------|-------|------------|-------------|
| BM25-Only | 46.67% | 0.7000 | ~3 ms |
| SLM-Only | 20.00% | 0.0972 | ~182 ms |
| Hybrid | 46.67% | 0.5750 | ~1484 ms |

Hybrid achieves parity with BM25 on Top-1 but degrades Set Recall and adds ~1.5 s latency per prompt, which exceeds the hook timeout budget. A larger model (1.5B+) or a pre-trained embedding model would be prerequisites for SLM to become worthwhile. See [docs/reports/phase-2-slm-benchmark.md](./reports/phase-2-slm-benchmark.md).

## How many skills are supported?

The router has been benchmarked up to **1000 skills** with the parsed-index cache (`data/skill-index.prebuilt.json`) in place. At that scale:

| Corpus size | Median latency | P95 latency | RSS peak |
|-------------|---------------|-------------|----------|
| 54 (real) | 32 ms | 39 ms | ~50 MB |
| 252 (real ceiling) | 29 ms | 44–53 ms | ~57 MB |
| 1000 (synthetic fixture) | 152–165 ms | 180–249 ms | 64–66 MB |

The corpus-size-dependent retrieval cost is flat at 1000 skills (~0.4 ms/call) because the prebuilt cache avoids rebuilding token indices per prompt (`src/core/retriever/prebuilt.mjs`). The fixed floor (~120–129 ms p95 on this host) is the ESM import graph and module-scope config work, not the retrieval itself. See [docs/reports/phase-7.6-hook-performance.md](./reports/phase-7.6-hook-performance.md).

The real-world corpus currently holds **252 leaf skills** plus **6 router dispatcher skills** (258 total index entries). The hook filters `router-*` entries before implicit ranking (`hooks/route.mjs:139`), so the effective retrieval corpus is 252.

## How do I add my own skills?

Write a `SKILL.md` file with frontmatter and place it outside `data/skills/`. The `add` subcommand validates it and copies it into the correct domain subdirectory:

```bash
# Create a skill directory with SKILL.md
mkdir -p /tmp/my-skill
cat > /tmp/my-skill/SKILL.md << 'EOF'
---
name: testing-my-skill
description: "Validates that an HTTP client handles retries, timeouts and error responses correctly in integration tests."
keywords:
  - http
  - retries
  - timeouts
  - integration-test
domains:
  - testing
version: 1.0.0
---

# Testing My Skill

Use this skill when you need to write integration tests for an HTTP client.
...
EOF

# Add it (validates against the 6-field quality rules)
node bin/skill-router.mjs add /tmp/my-skill/SKILL.md

# Reindex so the hook sees the new skill
node bin/skill-router.mjs reindex
```

The six quality rules (`src/quality/validator.mjs:169-179`) require: name present and non-empty, name starts with one of its declared domains followed by `-`, description 40–400 characters, keywords 3–15 entries, all declared domains exist in `data/domains/`, content 100–800 tokens. Run `validate` to check all skills:

```bash
node bin/skill-router.mjs validate
```

See [docs/skill-authoring.md](./skill-authoring.md) for detailed guidance on writing high-quality skills.

## What do I do if I want semantic search?

Semantic search is available through the experimental ONNX provider, but it is **not recommended for production use**. To enable it:

```bash
export SKILL_ROUTER_EMBEDDING_PROVIDER=onnx
export SKILL_ROUTER_RRF_SEMANTIC_WEIGHT=0.6
export SKILL_ROUTER_RRF_BM25_WEIGHT=0.4
```

This requires `@huggingface/transformers` (591 MB install) and downloads the model on first use. The hook emits an `experimental_mode` telemetry event and warns on stderr on every invocation. On the current corpus, semantic-on modes score below pure BM25 and cost ~1.4 s per prompt.

The conditions under which ONNX would be reconsidered are documented in [docs/embeddings.md](./embeddings.md): warm model latency under 100 ms, accuracy at or above the incumbent's 1.0000 Set Recall@5, a paraphrase test set showing BM25 weakness, and the dependency becoming optional rather than hard. None of these conditions are met today.

## How do I contribute?

Contributions are welcome. Please read `AGENTS.md` before making any changes — it contains mandatory workflow rules including the requirement to read `docs/ai-context.md`, `docs/implementation-plan.md`, and `docs/current-state.md` before starting work. All changes should be left uncommitted; the project manager controls commits.

Key contribution guidelines:

- **No new npm dependencies.** The project forbids them except through an explicit decision recorded in `docs/decision-dictionary.md`.
- **Every new module gets a JSDoc header.** Files over 400 lines must be split.
- **The hook stays fail-open.** When it cannot compute a decision, it exits 0 with no output.
- **No silent failures.** A check that cannot run is logged and reported, never swallowed.
- **Run the test suite before finishing.** `node scripts/run-all-tests.mjs` must pass (allowing the pre-existing failures listed in `logs/pre-existing-failures.json`).
- **Cite your evidence.** Every claim in a report or doc must cite a file path and line number, or the exact command and output that produced it.

To propose a new feature or report a bug, open an issue or pull request on the repository. For internal development, follow the phase-gated workflow in `docs/implementation-plan.md`.

## Where can I find more information?

| Topic | Location |
|-------|----------|
| Technical architecture | [docs/ai-context.md](./ai-context.md) |
| Module reference | [docs/architecture.md](./architecture.md) |
| CLI reference | [docs/cli-reference.md](./cli-reference.md) |
| Installation | [docs/install.md](./install.md) |
| Configuration | [docs/configure.md](./configure.md) |
| Troubleshooting | [docs/troubleshooting.md](./troubleshooting.md) |
| Embeddings deep dive | [docs/embeddings.md](./embeddings.md) |
| Tuning and feedback | [docs/tuning.md](./tuning.md) |
| Skill authoring guide | [docs/skill-authoring.md](./skill-authoring.md) |
| Sync workflow | [docs/sync.md](./sync.md) |
| Open and resolved issues | [docs/problems.md](./problems.md) |
| Recorded decisions | [docs/decision-dictionary.md](./decision-dictionary.md) |
| Project roadmap | [docs/implementation-plan.md](./implementation-plan.md) |
| Phase reports | [docs/reports/](./reports/) |
