# Phase 7 — Scale Benchmark Results

> Date: 2026-09-26
> Full leaf corpus: 252 skills
> Prompts: 204
> Sizes tested: 54, 200, 500, 1000
> Modes: bm25

## Method

For each corpus size:
1. Load the full leaf index from `data/skill-index.json`.
2. Sample a stratified subset via `tests/scale-benchmark/corpus-sampler.mjs` (seed=42).
3. Run every prompt through `rankSkills()` (pure BM25, no expansion, no rerank).
4. Grade Top-1, Recall@3, Set Recall@5, median/p95 latency, fallback rate.

## Results

| Size | Mode | Skills | Top-1 | Recall@3 | SetRecall | SetRecall(skill) | Median(ms) | P95(ms) | Fallback | Timeouts |
|------|------|--------|-------|----------|-----------|------------------|------------|---------|----------|----------|
| 54 | bm25 | 54 | 27.94% | 27.45% | 32.35% | 29.38% | 5 | 6 | 4.41% | 0 |
| 200 | bm25 | 199 | 66.67% | 75.98% | 80.88% | 80.93% | 21 | 25 | 3.92% | 0 |
| 500 | bm25 | 247 | 78.43% | 86.27% | 92.65% | 93.30% | 31 | 55.39999999999998 | 3.92% | 0 |
| 1000 | bm25 | 247 | 78.43% | 86.27% | 92.65% | 93.30% | 28 | 32 | 3.92% | 0 |

## Per-prompt detail

Full per-prompt results are in the JSON report at `<repo-root>\docs\reports\phase-7-scale-results.json`.
