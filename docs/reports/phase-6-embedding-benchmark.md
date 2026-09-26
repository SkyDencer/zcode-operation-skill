# Phase 6 Embedding Benchmark — FNV-1a vs ONNX

> Date: 2026-09-26
> Machine: Windows 10, Node 24, `@huggingface/transformers` 4.3.0, model `Xenova/all-MiniLM-L6-v2` (384-dim)
> Corpus: `data/skill-index.json` = 60 entries (54 leaf + 6 `router-*`), 130 prompts from `tests/prompts.json`
> Sub-Phase: 6.10

## Question

Sub-Phase 6.10 decides the default embedding provider. The decision rule is
fixed in advance: **switch to ONNX only if it improves Set Recall by more than
5 percentage points over FNV-1a *and* latency stays under 100 ms.**

## What was measured, and how

All numbers below come from runs executed for this report. Nothing is carried
over from the earlier Sub-Phase 6.10 attempt (commit `9f9ab49`), whose report
existed but never exercised the embedding channel and mislabelled Recall@3.

| Run | Command |
|-----|---------|
| Model download | `node -e "import('./src/core/embeddings/providers/onnx.mjs').then(m => new m.OnnxProvider().downloadModel())"` |
| Flat (BM25) | `node tests/run-benchmark.mjs --corpus real --router flat` |
| Hybrid, FNV-1a | `node tests/run-benchmark.mjs --corpus real --router hybrid --provider fnv1a` |
| Hybrid, ONNX | `node tests/run-benchmark.mjs --corpus real --router hybrid --provider onnx` |
| Hybrid, FNV-1a, semantic on | `SKILL_ROUTER_RRF_BM25_WEIGHT=0.4 SKILL_ROUTER_RRF_SEMANTIC_WEIGHT=0.6 node tests/run-benchmark.mjs --corpus real --router hybrid --provider fnv1a` |
| Hybrid, ONNX, semantic on | same, `--provider onnx` |
| SLM | `node tests/slm-benchmark/runner.mjs --mode hybrid` |
| Two-mode | `node tests/two-mode-benchmark/runner.mjs` |

`--router` and `--provider` did not exist in `tests/run-benchmark.mjs` before
this sub-phase (it parsed `--router` and then ignored it, and had no provider
flag at all, so all three commands the mission names would have measured the
same default hybrid configuration). Both flags are implemented here, and the
provider actually used is written into `logs/benchmark-<date>.json` so a run can
never be filed under the wrong provider. Set Recall was added for the same
reason: the harness reported only Top-1 and Recall@3, which cannot see a skill
found at rank 4.

**Set Recall@5** — the expected skill appears in the returned top 5, computed
over the 116 prompts that name a skill (`tests/benchmark/metrics.mjs`). The
14 negative prompts (`expected: null`) are scored separately as an abstention
decision, matching `tests/slm-benchmark/runner.mjs`. The top-5 cut is required:
`rankSkills()` emits an entry for every indexed skill, so an unbounded returned
set would make Set Recall trivially 1.0 for every mode.

## Result 1 — the mission's four commands, shipped configuration

Shipped weights are `bm25: 1.0, semantic: 0.0`.

| Mode | Top-1 | Recall@3 | Set Recall@5 (116) | Set Recall (130) | Abstained (14) | Median | P95 | Index size | Embedding file |
|------|-------|----------|--------------------|------------------|----------------|--------|-----|------------|----------------|
| Flat (BM25) | 0.9231 (120/130) | 0.8923 (116/130) | 1.0000 (116) | 0.9769 | 11 | 3 ms | 5 ms | 60 | none |
| Hybrid, FNV-1a | 0.9231 (120/130) | 0.8923 (116/130) | 1.0000 (116) | 0.9769 | 11 | 3 ms | 6 ms | 60 | 381 KB (256-dim) |
| Hybrid, ONNX | 0.9231 (120/130) | 0.8923 (116/130) | 1.0000 (116) | 0.9769 | 11 | 3 ms | 5 ms | 60 | 585 KB (384-dim) |

The three rows are identical, and that is a property of the shipped default,
not a measurement failure: with `semantic = 0`, `hybridRetrieve()` returns
before a provider is ever constructed (`src/core/retriever/hybrid.mjs:137`).
The whole 130-prompt ONNX run finished in 0.72 s of process wall time and no
model was loaded; the benchmark recorded 0 provider fallbacks. **A comparison of
the providers cannot be read off this table** — the providers are not in the
path. Result 2 is the comparison.

## Result 2 — the same commands with the semantic channel switched on

`SKILL_ROUTER_RRF_BM25_WEIGHT=0.4 SKILL_ROUTER_RRF_SEMANTIC_WEIGHT=0.6` — the
weight the mission originally specified for Sub-Phase 6.9.

| Mode | Top-1 | Recall@3 | Set Recall@5 (116) | Set Recall (130) | Abstained (14) | Median | P95 | Fallbacks | Process wall |
|------|-------|----------|--------------------|------------------|----------------|--------|-----|-----------|--------------|
| Hybrid, FNV-1a | 0.1846 (24/130) | 0.6077 (79/130) | 0.8534 (99) | 0.8462 | 11 | 36 ms | 42 ms | 0 | 4.2 s |
| Hybrid, ONNX | 0.7615 (99/130) | 0.7769 (101/130) | 0.9052 (105) | 0.8923 | 11 | 1445 ms | 1827 ms | 0 | not timed |
| Hybrid, ONNX (repeat) | 0.7615 (99/130) | 0.7769 (101/130) | 0.9052 (105) | 0.8923 | 11 | 947 ms | 1257 ms | 0 | 129 s |

Deltas that decide the default:

- **ONNX vs FNV-1a at the same weights: +5.18 pp Set Recall@5**
  (0.9052 - 0.8534 = 0.0518). The recall half of the rule is met, marginally.
- **Latency: 1445 ms median against a 100 ms budget — 14.5x over.** The repeat
  run halved to 947 ms median and is still 9.5x over. The latency half of the
  rule fails in every measurement, by an order of magnitude.
- **Both providers are worse than the shipped default.** Pure BM25 scores
  1.0000 Set Recall@5; ONNX costs 9.48 pp, FNV-1a 14.66 pp. Turning the
  semantic channel on is a regression against the configuration that ships,
  whichever provider supplies it.
- The repeat is bit-identical on accuracy (0.7615 / 0.9052 in both runs), so
  the comparison is deterministic; only the timings move with machine load.

## Cold versus warm timing

Provider level, measured in a fresh Node process against the real 60-entry
index (`embed` = one short prompt; `buildIndex` = 60 skill documents).

| Operation | FNV-1a cold | FNV-1a warm | ONNX cold | ONNX warm |
|-----------|-------------|-------------|-----------|-----------|
| `embed(text)` | 0.470 ms | 0.079 ms median (min 0.040, max 0.676, n=10) | 469.4 ms | 5.92 ms median (min 5.36, max 7.02, n=10) |
| `buildIndex(60 skills)` | 51.0 ms | 31.5 ms (second call) | 1407.3 ms | 1364.5 ms (second call) |

Retrieval level, from the 130-prompt runs:

| Mode | First prompt | Steady state | Process wall (130 prompts) |
|------|--------------|--------------|----------------------------|
| Flat (BM25) | 0 ms (cache hit) | 3 ms median | 0.49 s |
| Hybrid, FNV-1a, semantic on | 54 ms | 34-38 ms | 4.2 s |
| Hybrid, ONNX, semantic on | 2054 ms | 1440-1730 ms | 129 s |

The ONNX "warm" `buildIndex` is not warm: `hybridRetrieve()` calls
`buildIndex()` once per prompt and the provider rebuilds all 60 vectors every
time, which is where the ~1.4 s per prompt goes. A single embedding is 5.9 ms.
Caching the skill vectors across prompts would bring the per-prompt cost down
to single-digit milliseconds; that is a retriever change, out of scope here,
and it would still leave a 469 ms model load on the first prompt of a session.

## Disk usage

| Component | Measured | Note |
|-----------|----------|------|
| `node_modules` total | 591 MB | whole dependency tree |
| `node_modules/@huggingface` | 135 MB | includes the 122 MB model cache |
| `node_modules/onnxruntime-node` | 288 MB | pulled in by the transformers package |
| `node_modules/onnxruntime-web` | 141 MB | pulled in by the transformers package |
| Model cache (`node_modules/@huggingface/transformers/.cache/`) | 122 MB | downloaded model, not shipped in the repo |
| `data/skill-embeddings-384.json` | 585 KB | 384-dim vectors for 60 skills |
| `data/skill-embeddings.json` | 381 KB | 256-dim vectors for 60 skills |

Model cache contents: `model.onnx` 90,387,606 B (86.2 MiB), `tokenizer.json`
711,661 B, `config.json` + `tokenizer_config.json` 1,016 B — 86.9 MiB of live
model. The remaining 35.0 MiB is
`model.onnx.tmp.11568.v47mjq` (36,658,315 B, dated 2026-09-25 23:15), a partial
download left behind by an interrupted fetch in an earlier session; the real
`model.onnx` completed at 23:21. Deleting that file reclaims 35 MB.

**Total ONNX overhead: 591 MB installed, of which 469 MB is packages and 122 MB
is the downloaded model.** Both artifact files are gitignored, so the git
footprint of the semantic layer is the source code only.

## Other benchmarks in this sub-phase

SLM, `node tests/slm-benchmark/runner.mjs --mode hybrid` (30-prompt dataset, no
LLM server on :8080, so hybrid degrades to BM25 — this is the documented Phase 2
finding, not a new regression):

| Metric | Value |
|--------|-------|
| Top-1 hit rate | 0.4667 (14/30) |
| Set Recall (avg) | 0.7000 |
| Set Precision (avg) | 0.0417 |
| False positive rate | 0.1000 |
| Latency p50 / p95 / max | 3 ms / 6.55 ms / 10 ms |

Two-mode routing, `node tests/two-mode-benchmark/runner.mjs` (40 prompts):

| Metric | Value |
|--------|-------|
| Mode detection (explicit) | 1.0000 (15/15) |
| Router selection (explicit) | 1.0000 (15/15) |
| Top-1 (implicit) | 1.0000 (25/25) |
| Overall success | 1.0000 (40/40) |
| Latency p50 explicit / implicit / overall | 1 ms / 3 ms / 2 ms |

Neither benchmark touches the embedding provider: the SLM benchmark runs BM25
plus an LLM, and the two-mode benchmark exercises explicit and implicit BM25
routing. They are in the report because the mission asks for both; they are
regression evidence that nothing else moved, not evidence about embeddings.

## Corpus caveat

The benchmark ranks the full 60-entry index, while `hooks/route.mjs:139` filters
`router-*` out and the hook really searches 54 leaves. Four of the seven BM25
Top-1 misses are a `router-*` skill winning the top slot
(`router-next` x2, `router-laravel`, `router-test`). Re-measuring the same 130
prompts against the 54-leaf index gives **Top-1 0.9692 (126/130)** with Set
Recall@5 unchanged at 1.0000. Every hybrid number above is therefore a
conservative reading of the production path, and the gap is a benchmark-harness
artefact, not a production defect. Changing the default corpus would move the
frozen BM25 baseline and is out of scope for this sub-phase.

## Recommendation

**Keep `fnv1a` as the default embedding provider. Keep the semantic channel at
`semantic: 0.0`.**

Against the rule as written, in order:

1. The latency condition fails. ONNX hybrid retrieval costs 1445 ms median
   (947 ms on a repeat) against a 100 ms budget, and the hook's own budget is
   `hook.timeoutMs = 200`. One AND-ed condition failing is enough.
2. The accuracy condition is met only against FNV-1a, and only by 0.18 pp of
   margin (+5.18 pp against a >5 pp threshold) — a margin far inside the
   run-to-run noise of a threshold this coarse.
3. Against the configuration that actually ships — pure BM25, Set Recall@5
   1.0000 — ONNX is 9.48 pp *worse*. Promoting ONNX to the default would mean
   shipping a regression in exchange for 469 MB of packages, 122 MB of model,
   and a 469 ms first-prompt model load.

ONNX is a real capability and is not a fake one: on the semantic-on
configuration it recovers 6 of the 17 Set Recall hits that FNV-1a loses against
BM25 (105 vs 99 of 116), and it is the only one of the two that understands
"add a login page" and "implement user authentication" as related. The problem
is that this corpus — 60 short, keyword-rich skill manifests over a fixed
technology vocabulary — gives BM25 almost nothing to lose. A semantic channel
earns its cost on a corpus with paraphrased, vocabulary-mismatched prompts, and
this one is not it.

### What would change the answer

- **A paraphrase test set.** Prompts that avoid the skill's own words
  ("make the app remember who I am" for `backend-sanctum`). That is the
  measurement the current 130 prompts cannot produce, because 116 of 130 name
  concepts the manifest also names.
- **Cached skill vectors.** `buildIndex()` per prompt is the whole 1.4 s.
  Building once and reusing it would put ONNX hybrid at roughly 6 ms per
  prompt, inside the budget, and the comparison would then be about accuracy
  alone.
- **A longer session.** The 469 ms model load is paid once per process; the
  hook runs as a short-lived process, so a user pays it repeatedly. A resident
  process or a pre-warmed server would amortise it.

## Files changed by this sub-phase

- `tests/run-benchmark.mjs` — `--router` selects the retrieval mode, `--provider`
  names the embedding provider, Set Recall@5 is computed and reported, the
  effective RRF weights are recorded next to the shipped ones, the console
  output and corpus helpers moved out (360 -> 296 lines).
- `tests/benchmark/metrics.mjs` — Set Recall convention and aggregation.
- `tests/benchmark/corpus.mjs` — frontmatter parsing and synthetic-corpus
  loading, moved out of the harness.
- `tests/benchmark/report.mjs` — console table and summary block.
- `tests/benchmark/metrics.test.mjs` — 26 assertions over the new modules.
- `src/config/defaults.mjs` — default provider decision recorded with these
  numbers (unchanged value: `fnv1a`).
- `README.md`, `docs/embeddings.md` — the decision and the measured numbers.
- `package.json` — the new test registered in the chain (72 steps).

## Checks run for this sub-phase

Each with `node <file>`; none of these is the full suite, which the run script
gates on.

| Check | Result |
|-------|--------|
| `node tests/benchmark/metrics.test.mjs` | 26 passed, 0 failed |
| `node tests/retriever/mocked-provider.test.mjs` | 9 passed, 0 failed |
| `node tests/retriever/weighted-rrf.test.mjs` | 20 passed, 0 failed |
| `node tests/retriever/fallback-provider.test.mjs` | 13 passed, 0 failed |
| `node tests/retriever/default-weights.test.mjs` | 20 passed, 0 failed |
| `node tests/hybrid-provider.test.mjs` | 16 passed, 0 failed |
| `node tests/embeddings/provider.test.mjs` | 19 passed, 0 failed |
| `node tests/embeddings/onnx-provider.test.mjs` | 16 passed, 0 failed |
| `node tests/run-benchmark.mjs --mode bm25` | Top-1 0.9231 (120/130), Recall@3 0.8923 — frozen baseline unchanged |
