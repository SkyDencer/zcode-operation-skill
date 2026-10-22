# The Feature-Based Reranker (Experimental — Not Recommended)

**Status (P6-H-026):** off by default, opt-in only. Do not enable it for
production routing.

## Why it is off

The reranker blends a 4-feature lexical score (exact keyword match, bigram
overlap, domain match, title match) into the RRF score at `BLEND = 0.01`
(`src/core/reranker/engine.mjs`). Its weights are a least-squares fit over
the 30-prompt benchmark (`src/scripts/train-reranker-weights.mjs` →
`data/reranker-weights.json`).

The decision recorded in Phase 6 (P6-H-026 in `docs/problems.md`):

- The fit's **held-out R² is −4.58** — the model predicts the held-out
  prompts *worse than the mean*. It is fit to itself; the in-sample R² is
  not a quality signal.
- On the real corpus, reranking produced **no measurable Top-1 gain** over
  the BM25 baseline (see `docs/architecture.md`, Key Findings).
- It therefore adds latency and risk without measured benefit.

The code is kept for experimentation (decisions D28/D29 kept the
experimental paths inert but present), and it is now gated the same way.

## How the default path treats it

- `src/config/defaults.mjs` ships `reranker.enabled = false` and
  `reranker.experimental = true`.
- The hook (`hooks/route.mjs`) passes `rerank: config.reranker.enabled`
  into `hybridRetrieve()`, so the reranker never runs in the production
  path unless explicitly enabled.
- When it does run, the hook writes an `experimental_mode` telemetry event
  (`{ event: 'experimental_mode', mode: 'reranker', risk: 'negative_heldout_r2' }`)
  plus a stderr warning, so an enabled experimental path is always
  observable. The route record also carries `rerankEnabled`.

The tuning tools are unaffected: `tests/run-benchmark.mjs --rerank on|off`
(default `off`) and the multi-domain planner keep their own rerank control.

## Enabling it for experimentation

```sh
# enable for one session or process
SKILL_ROUTER_RERANKER=enabled node bin/skill-router.mjs ...

# or in the hook environment (ZCode launches the hook with the ambient env)
SKILL_ROUTER_RERANKER=enabled
```

Accepted values: `enabled` (or `true` / `1`) and `disabled` (or `false` /
`0`). Any other value leaves the reranker off and prints a warning.

To turn it off again: unset the variable, or set
`SKILL_ROUTER_RERANKER=disabled`.

## When you might still want it

Only as a controlled experiment while developing new retrieval features:
reranking may become useful once the corpus is large enough for lexical
overlap to discriminate, or once implicit-feedback data can replace the
self-fit weights (see `docs/architecture.md`, "Open work" notes on the
reranker). Until then, the shipped default is BM25-only.
