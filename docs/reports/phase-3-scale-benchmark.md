# Phase 3 — Scale Benchmark Report

> Date: 2026-09-26
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
| 50 | flat     | 85.0% |   97.0% |     2 | 2.049999999999997 | 0.0% |
| 50 | hierarchical | 85.0% |   97.0% |     4 |      4 | 0.0% |
| 100 | flat     | 76.0% |   93.5% |     3 |      5 | 0.0% |
| 100 | hierarchical | 76.0% |   93.5% |     5 |      6 | 0.0% |
| 200 | flat     | 50.2% |   84.5% |     7 |      7 | 0.0% |
| 200 | hierarchical | 50.2% |   84.3% |     9 |     10 | 0.3% |
| 300 | flat     | 36.7% |   76.7% |    10 |     11 | 0.0% |
| 300 | hierarchical | 36.5% |   76.3% |    12 |     13 | 0.3% |
| 500 | flat     | 39.5% |   64.2% |    16 |     17 | 0.0% |
| 500 | hierarchical | 39.4% |   64.0% |    18 |     19 | 0.2% |

### Top-1 Accuracy vs Corpus Size (BM25 flat)

```
  N=50     │██████████████████████████░░░░│ 85.0%
  N=100    │███████████████████████░░░░░░░│ 76.0%
  N=200    │███████████████░░░░░░░░░░░░░░░│ 50.2%
  N=300    │███████████░░░░░░░░░░░░░░░░░░░│ 36.7%
  N=500    │████████████░░░░░░░░░░░░░░░░░░│ 39.5%
```

### Top-1 Accuracy vs Corpus Size (Hierarchical)

```
  N=50     │██████████████████████████░░░░│ 85.0%
  N=100    │███████████████████████░░░░░░░│ 76.0%
  N=200    │███████████████░░░░░░░░░░░░░░░│ 50.2%
  N=300    │███████████░░░░░░░░░░░░░░░░░░░│ 36.5%
  N=500    │████████████░░░░░░░░░░░░░░░░░░│ 39.4%
```

## Key Findings

### Inflection Point

The **inflection point** where flat BM25 Top-1 accuracy drops below 95 % is at **N = 50** skills.

### Flat vs Hierarchical Comparison

| N | Flat Top-1 | Hier Top-1 | Diff (H-F) | Flat Med(ms) | Hier Med(ms) | Hier Speedup |
|--|-----------|-----------|------------|-------------|-------------|-------------|
| 50 | 85.0% | 85.0% |   0.0000 |          2 |           4 |        0.50x |
| 100 | 76.0% | 76.0% |   0.0000 |          3 |           5 |        0.60x |
| 200 | 50.2% | 50.2% |   0.0000 |          7 |           9 |        0.78x |
| 300 | 36.7% | 36.5% |  -0.0017 |         10 |          12 |        0.83x |
| 500 | 39.5% | 39.4% |  -0.0010 |         16 |          18 |        0.89x |

### Observations

- Hierarchical and flat modes have **mixed** Top-1 performance depending on scale.
- Hierarchical routing is **slower** due to domain detection overhead at small corpus sizes.

## Benchmark Commands

```
node tests/scale/run-scale.mjs
```

Each scale point triggers:
1. `node tests/scale/generate-synthetic.mjs <N> --seed 42 --out data/skills-synthetic-<N>`
2. Flat BM25 benchmark on generated prompts
3. Hierarchical benchmark (after domain population) on same prompts
4. Aggregated results written to this file
