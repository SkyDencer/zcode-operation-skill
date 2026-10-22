# Phase 3 — Scale Benchmark Report

> Date: 2026-09-30
> Sub-agent: scale-benchmark-engineer
> Seed: 42 (deterministic)

## Objective

Measure how flat (BM25-only) and hierarchical (domain-first) routing scale as the
skill corpus grows.  Synthetic SKILL.md manifests are generated deterministically
for each target size N, and each skill is targeted by 2 unambiguous prompts using
rotating template forms (question / imperative / noun-phrase).

## Method

| Step | Detail |
|------|--------|
| Corpus generator | `tests/scale/generate-synthetic.mjs` — Mulberry32 PRNG, 8 domains |
| Prompt coverage  | 2 prompts per skill, rotating form, each references the skill name directly |
| Flat mode        | `rankSkills(prompt, index)` — pure BM25 over all skills |
| Hierarchical mode| `routeHierarchical(prompt, index)` — domain detect → BM25 per domain → merge |
| Domains          | `populateDomainsFromSkills()` called before each hierarchical run |

## Results

### Combined table

| N (skills) | Mode | Top-1 | Recall@3 | Median ms | P95 ms | Fallback |
|-----------|------|-------|----------|-----------|--------|----------|
| 50 | flat     | 85.0% |   97.0% |     3 |      6 | 0.0% |
| 50 | hierarchical | 85.0% |   97.0% |     7 | 12.049999999999997 | 0.0% |
| 100 | flat     | 76.5% |   93.5% |     6 | 9.049999999999983 | 0.0% |
| 100 | hierarchical | 76.5% |   93.5% |     8 |     14 | 0.0% |
| 200 | flat     | 50.2% |   84.5% |    10 |     18 | 0.0% |
| 200 | hierarchical | 50.2% |   84.3% |    11 |     17 | 0.3% |
| 300 | flat     | 36.8% |   77.2% |    12 |     19 | 0.0% |
| 300 | hierarchical | 36.7% |   76.8% |    24 |     37 | 0.3% |
| 500 | flat     | 40.0% |   64.3% |    25 |     41 | 0.0% |
| 500 | hierarchical | 39.9% |   64.1% |    24 | 38.049999999999955 | 0.2% |

### Top-1 Accuracy vs Corpus Size (BM25 flat)

```
  N=50     │██████████████████████████░░░░│ 85.0%
  N=100    │███████████████████████░░░░░░░│ 76.5%
  N=200    │███████████████░░░░░░░░░░░░░░░│ 50.2%
  N=300    │███████████░░░░░░░░░░░░░░░░░░░│ 36.8%
  N=500    │████████████░░░░░░░░░░░░░░░░░░│ 40.0%
```

### Top-1 Accuracy vs Corpus Size (Hierarchical)

```
  N=50     │██████████████████████████░░░░│ 85.0%
  N=100    │███████████████████████░░░░░░░│ 76.5%
  N=200    │███████████████░░░░░░░░░░░░░░░│ 50.2%
  N=300    │███████████░░░░░░░░░░░░░░░░░░░│ 36.7%
  N=500    │████████████░░░░░░░░░░░░░░░░░░│ 39.9%
```

## Key Findings

### Inflection Point

The **inflection point** where flat BM25 Top-1 accuracy drops below 95 % is at **N = 50** skills.

### Flat vs Hierarchical Comparison

| N | Flat Top-1 | Hier Top-1 | Diff (H-F) | Flat Med(ms) | Hier Med(ms) | Hier Speedup |
|--|-----------|-----------|------------|-------------|-------------|-------------|
| 50 | 85.0% | 85.0% |   0.0000 |          3 |           7 |        0.43x |
| 100 | 76.5% | 76.5% |   0.0000 |          6 |           8 |        0.75x |
| 200 | 50.2% | 50.2% |   0.0000 |         10 |          11 |        0.91x |
| 300 | 36.8% | 36.7% |  -0.0017 |         12 |          24 |        0.50x |
| 500 | 40.0% | 39.9% |  -0.0010 |         25 |          24 |        1.04x |

### Observations

- Hierarchical and flat modes have **mixed** Top-1 performance depending on scale.
- Hierarchical routing latency is **comparable** to flat, with trade-offs depending on domain match quality.

## Benchmark Commands

```
node tests/scale/run-scale.mjs
```

Each scale point triggers:
1. `node tests/scale/generate-synthetic.mjs <N> --seed 42 --out data/skills-synthetic-<N>`
2. Flat BM25 benchmark on generated prompts
3. Hierarchical benchmark (after domain population) on same prompts
4. Aggregated results written to this file
