# Architecture — Skill Router v0.2

## Overview

The Skill Router is a zero-dependency Node.js plugin for ZCode that intercepts authoring prompts, retrieves relevant skill documentation via hybrid lexical+semantic search, and injects it into the model context.

## Data Flow

```
ZCode UserPromptSubmit
        │
        ▼
┌──────────────────┐
│  hooks/route.mjs │  ← Input validation, timeout guard, error boundary
└────────┬─────────┘
         │ JSON payload (prompt, cwd)
         ▼
┌──────────────────────┐
│  src/loader.mjs      │  ← Parse SKILL.md frontmatter
└────────┬─────────────┘
         │ skill-index.json
         ▼
┌─────────────────────────────────────────────────────────┐
│  src/core/routing/planner.mjs                           │
│  ├─ detectDomains() → DomainMatch[]                     │
│  ├─ Single: top confidence > 0.90 with clear gap        │
│  ├─ Multi: 2+ domains ≥ 0.50 confidence                 │
│  └─ Fallback: no strong signal                          │
└─────────────────────────┬───────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
   │  BM25       │ │  Embeddings │ │  Reranker   │
   │  rankSkills │ │  cosine sim │ │  (opt-in)   │
   └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
          └────────┬───────┘               │
                   ▼                       │
          ┌─────────────────┐              │
          │  RRF Fusion     │              │
          │  score = Σ 1/(k │              │
          │       + rank_i) │              │
          └────────┬────────┘              │
                   │                       │
                   ▼                       ▼
          ┌─────────────────────────────────────┐
          │  readSkillContent() → additionalContext │
          └───────────────────┬─────────────────┘
                              │
                              ▼
          ┌─────────────────────────────────────┐
          │  telemetry logger + metrics         │
          │  (JSONL logs, ring buffer, reporter)│
          └───────────────────┬─────────────────┘
                              │
                              ▼
          ┌─────────────────────────────────────┐
          │  output.json                        │
          │  {                                   │
          │    hookSpecificOutput: {...},       │
          │    RoutePlan: { mode, domains... }  │
          │  }                                  │
          └─────────────────────────────────────┘
```

## Core Modules

### BM25 Retriever (`src/core/retriever/bm25.mjs`)
- Weighted field scoring: name ×3, description ×2, keywords ×1
- Standard BM25 formula with configurable k1 (1.5) and b (0.75)
- Normalizes raw scores to [0, 1] by dividing by max
- Exports: `rankSkills(prompt, index)`, `readSkillContent(ranked)`

### Hybrid Retriever (`src/core/retriever/hybrid.mjs`)
- Runs BM25 and embedding similarity independently
- Fuses via Reciprocal Rank Fusion: `score = Σ (1 / (k + rank_i))` with k=60
- BM25 rank used as tiebreaker when RRF scores are within 1e-10
- Optional reranking stage (BLEND=0.01, opt-in via `{rerank: true}`)
- Exports: `hybridRetrieve(prompt, index, options)`

### Embedding Engine (`src/core/embeddings/engine.mjs`)
- FNV-1a hash function (32-bit, seed 0x811c9dc5)
- Character 2-grams + 3-grams + word tokens + word bigrams hashed into 256 dims
- Unit vector normalization
- Cosine similarity bounded [0, 1]
- Exports: `embed(text)`, `cosineSimilarity(a, b)`, `buildEmbeddingIndex(skills)`

### Reranker (`src/core/reranker/`)
- **features.mjs**: Extracts 4 lexical features:
  - `exactKeyword`: count of query tokens matching skill name/description/keywords
  - `bigramOverlap`: shared bigrams between query and skill description
  - `domainMatch`: 1.0 if query tokens overlap skill domains
  - `titleMatch`: 1.0 if skill name tokens appear in query
- **engine.mjs**: Blends RRF score with feature score (BLEND=0.01)
  - `blended = (1-BLEND) * rrfScore + BLEND * featureScore`
  - Opt-in to avoid degrading hybrid accuracy on small corpora

### Domain Detector (`src/core/routing/detector.mjs`)
- Three signals per domain:
  1. **BM25 signal**: avg raw BM25 score normalized against corpus total
  2. **Coverage signal**: fraction of domain skills above 30% of global max
  3. **Embedding signal**: avg cosine similarity of domain skills to query
- Combined: `confidence = 0.5×bm25 + 0.3×coverage + 0.2×embedding`
- Matched tokens: query tokens found in domain keyword pools

### Route Planner (`src/core/routing/planner.mjs`)
- **Single-domain**: top confidence > 0.90 AND gap > 0.15 over second domain
- **Multi-domain**: 2+ domains with confidence >= 0.50 (checked after single)
- **Fallback**: no strong signal → plain hybrid retrieve
- Multi-domain uses single hybrid pass with domain-distributed scoring

### Telemetry (`src/core/telemetry/`)
- **logger.mjs**: JSONL logging with daily rotation (`logs/YYYY-MM-DD.jsonl`)
  - Fields: ts, event, queryHash, queryLength, candidates, selected, mode, latencyMs, confidence
  - Never logs raw query text (hashed only)
- **metrics.mjs**: In-memory ring buffer of last 1000 requests
  - `recordLatency(ms)`, `recordAccuracy(hit)`, `recordFallback()`
  - `snapshot()` returns p50, p95, p99, mean, count, fallbacks, hits
- **reporter.mjs**: Human-readable markdown tables for metrics and benchmarks

### Configuration (`src/config/`)
- **defaults.mjs**: All tunable parameters with descriptive defaults
- **env.mjs**: Reads `SKILL_ROUTER_*` env vars, validates types/ranges, falls back to defaults
- Schema validation prevents invalid values from breaking the system

## Hook Contract

### Input (stdin JSON)
```json
{
  "prompt": "string — user's authoring prompt",
  "cwd": "string — workflow directory path"
}
```

### Output (`.zcode/output.json`)
```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "string — skill documentation to inject"
  },
  "RoutePlan": {
    "mode": "single|multi|fallback",
    "domains": [{ "name": "string", "skills": ["string"] }],
    "primary": "string|null",
    "candidates": [{ "name": "string", "score": number }],
    "latencyMs": number
  }
}
```

### Fail-Open Behavior
- Empty input → exit 0, no output
- Malformed JSON → exit 0, no output
- Missing fields → safe defaults applied
- Prompt > 10KB → truncated
- Index not found → exit 0
- Retrieval timeout (>200ms) → partial results
- Any uncaught error → exit 0, log to stderr

## Performance Characteristics

| Mode | Top-1 | Recall@3 | Median Latency | P95 Latency |
|------|-------|----------|----------------|-------------|
| BM25 | 95.4% | 95.4% | 2ms | 4ms |
| Hybrid | 60.8% | 83.1% | 10ms | 14ms |
| Routing overhead | — | — | +3ms | +5ms |

**Note:** Hybrid mode trades Top-1 for broader recall. For production use, BM25 mode is recommended when precision matters; hybrid mode when recall matters. The reranker is disabled by default to preserve accuracy.

## Design Decisions

1. **Zero dependencies** — No npm packages. All algorithms implemented from scratch.
2. **Deterministic embeddings** — FNV-1a hashing ensures reproducible results without ML models.
3. **RRF fusion** — Theoretically guaranteed to improve precision at rank 1 when combining independent rankers.
4. **Opt-in reranking** — Feature-based reranking can degrade accuracy on small corpora; enabled only when explicitly requested.
5. **Fail-open** — The hook never blocks user input. Any error results in clean exit with no output.
6. **Single hybrid pass** — Multi-domain routing runs retrieval once and distributes scores, avoiding N× latency.

## Phase 1 Findings: What Worked and What Did Not

### What Worked

- **BM25 alone is strong.** Top-1 0.9769 (127/130) on 130 prompts against 54 skills. Fast, deterministic, reliable. Median latency 3 ms. This is the mode to use in production when precision matters.

- **Multi-domain routing is functional.** The detector produces reasonable plans using a composite of BM25 signal, coverage signal, and embedding signal. Thresholds (single ≥ 0.90 with gap > 0.15; multi ≥ 0.50) are tuned for the current 54-skill / 11-domain corpus and may need re-tuning at scale.

- **Telemetry stack works cleanly.** JSONL logging, ring-buffer metrics, and the human-readable reporter all function as designed with no regressions.

- **Zero-dependency design holds.** All algorithms (BM25, FNV-1a embeddings, RRF, feature extraction) run from pure ESM with no npm packages.

### What Did Not

- **N-gram embeddings (256-dim, FNV-1a) are insufficient for semantic similarity.** When fused via RRF (`k=60`), the weak embedding signal degrades Top-1 from 97.7% down to 60.8%. Recall@3 improves (83.1%), but the net effect on precision is negative. This is a documented negative result — see [phase-1-final-report.md](./reports/phase-1-final-report.md).

- **Feature-based reranker does not improve Top-1 on the current corpus.** The reranker is opt-in (`--rerank`) and blends a 4-feature lexical score (keyword, bigram, domain, title) at BLEND=0.01. On 54 skills, reranking produced no measurable Top-1 gain over raw BM25. The likely cause is insufficient training signal — four hand-tuned features on a small corpus cannot meaningfully re-rank against a ground-truth distribution. A larger corpus or learned weights would be needed.

- **Embedding dimensionality is too low.** 256 dimensions from FNV-1a hashing means limited resolution per gram. With only 54 skills and ~100 unique n-grams each, effective discriminative power is low. Higher-dimensional hashes or a pre-trained model would be required for meaningful semantic signals.

### What We Would Do Differently

Given what we know now, we would skip the hand-rolled n-gram embedding engine entirely and integrate a pre-trained embedding model (e.g., a small ONNX transformer or local tiny-BERT) from the start. The RRF fusion math is sound — the input quality was the bottleneck. Phase 2 (Adaptive Learning) is the natural place to revisit embedding quality with more signal.

For the reranker specifically, we would either (a) collect implicit feedback data first and learn the feature weights, or (b) omit it entirely until the corpus grows large enough that lexical overlap becomes a discriminative signal.

### Benchmark Summary (Phase 1, 130 prompts / 54 skills)

| Mode | Top-1 | Recall@3 | Median Latency | Verdict |
|------|-------|----------|----------------|---------|
| BM25 | 97.7% (127/130) | 97.7% (127/130) | 3 ms | Production-ready |
| BM25 + reranker | 97.7% (127/130) | 97.7% (127/130) | 3 ms | No improvement; opt-in only |
| Hybrid (BM25 + n-gram RRF) | 60.8% | 83.1% (108/130) | 11 ms | Negative result; retain for Phase 2 research |
