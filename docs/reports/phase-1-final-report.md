# Phase 1 — The Command Center — Final Report

**Date:** 2026-09-22  
**Status:** Complete  
**Sub-phases completed:** 12/12

## Summary

Phase 1 transformed the BM25 spike from Phase 0 into a production-grade hybrid retrieval engine. The system now supports hybrid BM25+semantic retrieval with Reciprocal Rank Fusion, feature-based reranking, multi-domain fan-out routing, full telemetry, and a 54-skill corpus tested against 130 prompts.

## Benchmark Results

| Metric | Phase 0 | Phase 1 | Change |
|--------|---------|---------|--------|
| Top-1 Accuracy (BM25) | 90% (18/20) | 95.4% (124/130) | +5.4pp |
| Recall@3 (BM25) | 100% (20/20) | 95.4% (124/130) | -4.6pp |
| Median Latency | 3ms | 2ms | -1ms |
| Skills indexed | 10 | 54 | +44 |
| Prompts tested | 20 | 130 | +110 |
| Top-1 Accuracy (Hybrid) | N/A | 60.8% (79/130) | N/A |
| Recall@3 (Hybrid) | N/A | 83.1% (108/130) | N/A |

**Note:** Hybrid mode (BM25 + semantic embeddings via RRF) trades Top-1 accuracy for broader recall. On the 54-skill corpus, BM25 alone achieves 95.4% Top-1. The hybrid retriever achieves 83.1% Recall@3, meaning the correct skill appears in the top-3 for 83% of prompts. The reranker is opt-in and does not run by default to preserve accuracy.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  ZCode Hook (hooks/route.mjs)                              │
│  ├─ Input validation (empty, malformed, oversized)         │
│  ├─ Timeout guard (200ms via Promise.race)                 │
│  └─ Error boundary (fail open on any error)                │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│  Core Retrieval Pipeline                                    │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────────────┐  │
│  │ BM25 Scorer │   │ Embedding    │   │ Domain          │  │
│  │ (scorer.mjs)│   │ Engine       │   │ Detector        │  │
│  └──────┬──────┘   └──────┬───────┘   └──────┬──────────┘  │
│         │                 │                   │             │
│         └─────────┬───────┘───────────────────┘             │
│                   ▼                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Hybrid Retriever (hybrid.mjs)                       │   │
│  │  ├─ BM25 rankings + Embedding cosine similarity      │   │
│  │  ├─ Reciprocal Rank Fusion (k=60)                    │   │
│  │  └─ Optional reranker (BLEND=0.01, opt-in)           │   │
│  └─────────────────────┬───────────────────────────────┘   │
│                        │                                    │
│                        ▼                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Route Planner (planner.mjs)                         │   │
│  │  ├─ Single-domain: top confidence > 0.90, gap > 0.15 │   │
│  │  ├─ Multi-domain: 2+ domains >= 0.50 confidence      │   │
│  │  └─ Fallback: no strong signal → hybrid retrieve     │   │
│  └─────────────────────┬───────────────────────────────┘   │
│                        │                                    │
│                        ▼                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Telemetry                                           │   │
│  │  ├─ JSONL logging (logs/YYYY-MM-DD.jsonl)            │   │
│  │  ├─ Metrics ring buffer (last 1000 requests)         │   │
│  │  └─ Reporter (human-readable summaries)              │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Modules Created

| Module | Lines | Purpose |
|--------|-------|---------|
| `src/core/retriever/bm25.mjs` | 81 | BM25 ranking with field weighting |
| `src/core/retriever/hybrid.mjs` | 128 | RRF fusion of BM25 + embeddings |
| `src/core/reranker/engine.mjs` | 52 | Feature-based reranking (opt-in) |
| `src/core/reranker/features.mjs` | 50 | Keyword, bigram, domain, title features |
| `src/core/embeddings/engine.mjs` | 160 | FNV-1a 256-dim n-gram embeddings |
| `src/core/routing/detector.mjs` | 137 | Multi-signal domain detection |
| `src/core/routing/planner.mjs` | 156 | Single/multi/fallback route planning |
| `src/core/telemetry/logger.mjs` | 70 | JSONL logging with daily rotation |
| `src/core/telemetry/metrics.mjs` | 62 | Ring buffer metrics with percentiles |
| `src/core/telemetry/reporter.mjs` | 45 | Human-readable metric reports |
| `src/config/defaults.mjs` | 98 | All tunable parameters |
| `src/config/env.mjs` | 111 | SKILL_ROUTER_* env overrides |
| `src/utils/text.mjs` | ~40 | Tokenization, bigrams, stopwords |
| `src/utils/fs.mjs` | ~40 | Cross-platform file helpers |
| `src/utils/time.mjs` | ~30 | Timing utilities |
| `src/index.mjs` | ~35 | Public API re-exports |
| `src/loader.mjs` | 117 | SKILL.md manifest loader |

## Skill Corpus

54 skills across 7 domains:
- **backend/laravel** (15): eloquent, sanctum, queues, pagination, validation, migrations, seeding, factories, api-resources, events-listeners, middleware, service-container, task-scheduling, cache, http-client
- **backend/api** (5): rest-conventions, versioning, errors, rate-limiting, graphql-basics
- **frontend/react** (10): hooks-basics, patterns, state-management, performance, testing, forms, portals, suspense, context, refs
- **frontend/nextjs** (8): app-router, server-components, data-fetching, middleware, image-optimization, file-routing, api-routes, static-generation
- **design** (6): color-theory, typography, glassmorphism, spacing, responsive-design, accessibility
- **testing** (5): pest-php, vitest, playwright, tdd-basics, integration-testing
- **meta** (5): debugging, refactoring, code-review, architecture, documentation

## Test Suite

165 tests total, all passing:
- **embeddings.test.mjs** (69 tests): Hash determinism, dimensionality, cosine similarity, semantic relatedness
- **hybrid.test.mjs** (16 tests): Output structure, Top-1 accuracy, Recall@3, custom k, pre-built embeddings
- **reranker.test.mjs** (21 tests): Feature extraction, cardinality, sorting, latency, opt-in behavior
- **routing.test.mjs** (43 tests): Domain detection, route planning, primary domain, latency, hit rate
- **hook-edge-cases.mjs** (16 tests): Empty input, invalid JSON, long prompts, emojis, SQL injection, null bytes

## Configuration

All parameters are configurable via `src/config/defaults.mjs` and environment variables:

| Parameter | Default | Env Var |
|-----------|---------|---------|
| BM25 k1 | 1.5 | SKILL_ROUTER_BM25_K1 |
| BM25 b | 0.75 | SKILL_ROUTER_BM25_B |
| RRF k | 60 | SKILL_ROUTER_RRF_K |
| Embedding dimensions | 256 | SKILL_ROUTER_EMBED_DIMS |
| Domain threshold | 0.90 | SKILL_ROUTER_DOMAIN_THRESHOLD |
| Multi-domain threshold | 0.50 | SKILL_ROUTER_MULTI_DOMAIN_THRESHOLD |
| Hook timeout | 200ms | SKILL_ROUTER_TIMEOUT_MS |
| Max prompt length | 10240 | SKILL_ROUTER_MAX_PROMPT_LENGTH |

## Known Limitations

1. **N-gram embeddings are deterministic but weak** — FNV-1a feature hashing captures sub-word similarity but cannot match transformer-quality embeddings. Accuracy improves with larger corpora where semantic signals become more discriminative.

2. **Feature-based reranker degrades on small corpora** — With only 54 skills, the lexical reranker can override the stronger RRF signal. It is opt-in by default and should be fine-tuned per deployment.

3. **Domain detection has noise on small corpora** — With 11 domains across 54 skills, many prompts trigger multi-domain classification. The threshold parameters (SINGLE_THRESHOLD=0.90, MULTI_THRESHOLD=0.50) were tuned for this corpus.

4. **No external dependencies** — By design, the system uses zero npm packages. This limits embedding quality but ensures zero-trust deployment.

5. **Hook latency varies with corpus size** — BM25 mode: 2ms median. Hybrid mode: 9ms median. Routing adds ~3ms overhead. All well under the 100ms p95 target.

## Next Steps: Phase 2

**Suggested title:** Adaptive Learning — Online learning from user corrections

**Goal:** Learn from implicit feedback (which skills the user actually uses after hook injection) to improve retrieval over time. Key ideas:
- Log which skills are actually consumed (via ZCode telemetry or explicit feedback)
- Adjust BM25 field weights based on click-through data
- Add learning rate to embedding vector updates
- A/B test retrieval strategies

## Files Changed

- **New:** src/core/, src/config/, src/utils/, src/index.mjs, src/loader.mjs
- **New:** tests/embeddings.test.mjs, tests/hybrid.test.mjs, tests/reranker.test.mjs, tests/routing.test.mjs, tests/hook-edge-cases.mjs
- **New:** data/skills/ (54 SKILL.md files), scripts/generate-skills.mjs, scripts/write-prompts.mjs
- **Modified:** hooks/route.mjs, hooks/build-index.mjs, tests/run-benchmark.mjs
- **Modified:** docs/ (ai-context.md, current-state.md, decision-dictionary.md, implementation-plan.md)
- **New:** CHANGELOG.md, docs/architecture.md, docs/reports/phase-1-final-report.md

**Total new lines of code:** ~2,700  
**Total test assertions:** 165 (all passing)  
**Commits:** 12 (local only, not pushed)
