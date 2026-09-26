# Embeddings

> **Status: Experimental — do not enable the semantic path in production.**
>
> The default provider mode is **`bm25-only`** (lexical retrieval, no semantic
> backend in the request path). The `onnx` mode is retained in the tree but is
> **experimental and not recommended**: Phase 6 measured it below the shipped
> BM25 configuration on accuracy and roughly 14x over the latency budget.
> Selecting it logs an `experimental_mode` telemetry event
> (`{ event: "experimental_mode", mode: "onnx", risk: "untested_scale" }`) and
> warns on stderr. Decision D29: `docs/reports/phase-7.1-semantic-decision.md`.

The Skill Router supports two embedding backends, selected with the
`SKILL_ROUTER_EMBEDDING_PROVIDER` environment variable (default:
`bm25-only`) or the `--provider` flag of `hooks/build-index.mjs`. `fnv1a` is
kept as an accepted alias of `bm25-only`; both build the same FNV-1a provider.

| Provider | Dims | Dependency | Cached | Speed | Quality |
|----------|------|------------|--------|-------|---------|
| `bm25-only` / `fnv1a` (default) | 256 | none | n/a | 0.08 ms per embed, 51 ms for 60 skills (measured) | lexical only |
| `onnx` (experimental, not recommended) | 384 | `@huggingface/transformers` (591 MB installed) | yes, 122 MB | 5.9 ms per embed warm, 1407 ms to build 60 skills (measured) | semantic + lexical |

Measured on Windows 10 / Node 24, corpus of 60 skills (54 leaf + 6 routers),
`Xenova/all-MiniLM-L6-v2`. Sub-Phase 6.10 measured cold start, warm inference
and the accuracy comparison; see the decision at the bottom of this file.

## FNV-1a provider (the `bm25-only` default)

Zero-dependency character n-gram hasher
(`src/core/embeddings/engine.mjs`, wrapped by
`src/core/embeddings/providers/fnv1a.mjs`). It produces deterministic 256-dim
unit vectors from name/description/keywords text. Fast, offline, and byte-for-byte
identical to the Phase 1 implementation, but purely lexical: it cannot tell that
"add a login page" and "implement user authentication" are related.

```
node hooks/build-index.mjs --provider fnv1a     # default
```

Writes `data/skill-embeddings.json` (256-dim).

## ONNX provider (experimental, not recommended)

Uses the [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2)
sentence-transformer through `@huggingface/transformers`, producing 384-dim
mean-pooled, L2-normalised vectors.

```
node hooks/build-index.mjs --provider onnx
```

Writes `data/skill-embeddings-384.json` (384-dim).

### Enabling (experimental — for measurement only)

```
SKILL_ROUTER_EMBEDDING_PROVIDER=onnx
```

This is how the Phase 6 numbers were produced and how the path stays
re-testable. It is not a production setting: the mode emits
`{"event":"experimental_mode","mode":"onnx","risk":"untested_scale"}` on every
invocation and warns on stderr. Do not set it in a deployment.

1. The package must be installed (`@huggingface/transformers` is a runtime
   dependency, so a plain `npm install` already provides it).
2. The model is fetched on first use. `hooks/build-index.mjs` downloads it
   automatically when it is not cached, or fetch it explicitly:

   ```
   node -e "import('./src/core/embeddings/providers/onnx.mjs').then(m => new m.OnnxProvider().downloadModel())"
   ```

### Model cache

The library's default cache directory is inside the installed package, not the
user profile: `node_modules/@huggingface/transformers/.cache/`. Measured on
this machine after one download:

| File | Size |
|------|------|
| `Xenova/all-MiniLM-L6-v2/onnx/model.onnx` | 90,387,606 B (86.2 MiB) |
| `Xenova/all-MiniLM-L6-v2/tokenizer.json` | 711,661 B |
| `config.json` + `tokenizer_config.json` | 1,016 B |
| Live model total | 86.9 MiB |
| `onnx/model.onnx.tmp.11568.v47mjq` (stale partial download, 2026-09-25) | 36,658,315 B |
| Cache total as measured | ~122 MB |

`OnnxProvider.isAvailable()` reports `true` only when a `model.onnx` file is
present in that cache tree. Delete the `.cache` directory to force a clean
re-download.

### Offline and cold-start behaviour

- `isAvailable()` returns `false` until the model is cached.
- `downloadModel()` triggers a real model load (the library builds its pipeline
  lazily, so the method runs a one-word warm-up inference), and throws
  `ProviderNotAvailableError` for **every** failure mode — offline network,
  remote models disabled, corrupt cache entry — with a message naming the
  model, the cause, and the fallback. No raw library error ever reaches the
  caller.
- `embed()` and `buildIndex()` throw `ProviderNotAvailableError` when the model
  is not cached, so a cold provider can never silently return zero vectors.
- `hooks/build-index.mjs --provider onnx` attempts the download *before* writing
  any file; on failure it prints the reason and exits 1 with the previous index
  untouched. It does not silently downgrade to FNV-1a.

## When to use which

- **`bm25-only` (FNV-1a)** — the default, and the only mode intended for
  production. No disk, no network, no startup cost, and the frozen BM25
  baseline (92.31% Top-1) does not depend on it.
- **`onnx`** — **experimental, not recommended.** A genuine semantic backend,
  kept so the decision can be revisited without rebuilding anything, but on
  this corpus it is slower and less accurate than the default (numbers below).
  Selecting it emits the `experimental_mode` telemetry event and a stderr
  warning; the hook still runs, and still fails open.

The semantic channel is disabled by default (`embeddings.weights: { bm25: 1.0, semantic: 0.0 }`). Enabling it with `SKILL_ROUTER_RRF_SEMANTIC_WEIGHT=0.6` and `SKILL_ROUTER_RRF_BM25_WEIGHT=0.4` to test hybrid retrieval *lowers* accuracy on the current corpus — expect that, it is measured, not suspected.

Full decision rationale: [docs/reports/phase-6-embedding-benchmark.md](./reports/phase-6-embedding-benchmark.md) and [docs/reports/phase-7.1-semantic-decision.md](./reports/phase-7.1-semantic-decision.md)

## Dependency justification

Required by the Phase 6 hard rules for every new runtime dependency.

| Item | Value |
|------|-------|
| Package | `@huggingface/transformers` |
| Version | 4.3.0 (latest stable) — declared as `^4.3.0` in `package.json` |
| Install size | **591 MB** measured (`du -sm node_modules`): `@huggingface/transformers` 135 MB, `onnxruntime-node` 288 MB, `onnxruntime-web` 141 MB, plus tokenizers/jinja/sharp/protobufjs. The mission's "~50 MB" estimate was off by more than an order of magnitude. |
| Model | `Xenova/all-MiniLM-L6-v2`, 90.4 MB `model.onnx` (86.2 MiB) + 0.7 MB tokenizer, downloaded on first use into the library cache (122 MB measured, of which 35 MB is a stale partial download) |
| Why needed | Semantic similarity for prompts whose wording differs from the skill description — the capability FNV-1a structurally cannot provide. Whether it pays for itself on *this* corpus is a separate question, answered below: it does not yet. |
| Fallback | `Fnv1aProvider` remains the default and is always available. Leave `SKILL_ROUTER_EMBEDDING_PROVIDER` unset — the shipped default is `bm25-only` — to keep the model out of the path entirely; removing the dependency only costs the experimental provider, because nothing else imports it. |
| Offline impact | None while the default is `bm25-only`: the hook and index builder load the ONNX provider only when `--provider onnx` or `SKILL_ROUTER_EMBEDDING_PROVIDER=onnx` is set. |

### Phase 6.10 Decision

Measured on the 130-prompt real corpus against the 60-entry index. Set Recall@5
is the expected skill in the returned top 5, over the 116 prompts that name a
skill.

| Mode | Top-1 | Set Recall@5 (116) | Median latency |
|------|-------|--------------------|----------------|
| Flat (BM25), shipped | 0.9231 | 1.0000 | 3 ms |
| Hybrid, FNV-1a, shipped weights | 0.9231 | 1.0000 | 3 ms |
| Hybrid, ONNX, shipped weights | 0.9231 | 1.0000 | 3 ms |
| Hybrid, FNV-1a, semantic 0.6 | 0.1846 | 0.8534 | 36 ms |
| Hybrid, ONNX, semantic 0.6 | 0.7615 | 0.9052 | 1445 ms |

With the shipped weights (`semantic: 0.0`) the provider is never constructed,
so the first three rows are the same run three times — that is the property of
the default, not a measurement artefact. The last two rows are the actual
provider comparison, with the channel switched on.

**Default stays `bm25-only`, and the semantic channel stays off.** The rule was
"ONNX only if Set Recall improves by more than 5 pp and latency stays under
100 ms": ONNX gains 5.18 pp over FNV-1a (0.9052 vs 0.8534) but costs 1445 ms
median, 14x the budget, and both semantic-on modes are worse than the pure-BM25
configuration that ships. ONNX stays experimental.

### Phase 7.1 Decision (D29) — the exact numbers, and what would reopen it

The Phase 6 figures this decision rests on, quoted from
[phase-6-embedding-benchmark.md](./reports/phase-6-embedding-benchmark.md)
(130-prompt real corpus, 60-entry index; Set Recall@5 is over the 116 prompts
that name a skill):

| Claim | Exact figure | Source |
|---|---|---|
| BM25 alone, the shipped default | Set Recall@5 **1.0000** (116/116), Top-1 0.9231 (120/130), 3 ms median | Result 1 table, `docs/reports/phase-6-embedding-benchmark.md:53` |
| ONNX's accuracy gain over FNV-1a, channel on | Set Recall@5 **0.9052** vs 0.8534 = **+5.18 pp** | `:73`, delta stated at `:78` |
| ONNX's latency | **1445 ms** median, 1827 ms p95 (repeat run 947 ms) | `:73` |
| The budget it had to meet | **100 ms** (the rule fixed in advance) | `:11-12` |
| How far over | **14.5x** (9.5x even on the faster repeat) | `:80` |
| Accuracy against the incumbent | both semantic-on modes are *below* pure BM25: ONNX 9.48 pp worse, FNV-1a 14.66 pp worse | `:84` |

**ONNX would be reconsidered only when all four of these hold:**

1. **Latency under 100 ms median, measured on a warm model.** The current
   1445 ms comes almost entirely from rebuilding all 60 skill vectors on every
   prompt (`buildIndex(60)` = 1407 ms) while a single embed is 5.9 ms. Caching
   the index vectors, or a smaller/quantised model, has to bring the per-prompt
   cost from ~1.4 s to under 100 ms — a 14x reduction, not a tuning knob. A
   cold first-prompt load (469 ms) also has to stop mattering, either by
   dropping it or by pre-warming outside the hook's latency path.
2. **Accuracy at or above the incumbent, not merely above FNV-1a.** The rule as
   written compares against FNV-1a, the weakest alternative, and ONNX passes
   that clause. The baseline that matters is the configuration that ships:
   Set Recall@5 **1.0000**. A candidate has to beat 1.0000 on the current
   corpus, or be shown equal on it and clearly better on one the corpus cannot
   answer.
3. **A corpus that gives BM25 something to lose.** The current 60 short,
   keyword-rich manifests over a fixed technology vocabulary leave lexical
   matching almost nothing to lose: 116 of 130 prompts name concepts the
   manifests also name. The reconsider trigger is a **paraphrase test set** —
   prompts that deliberately avoid the skill's own vocabulary — showing the
   semantic channel ahead on the cases BM25 currently gets wrong. On the
   present corpus, re-running the Phase 6 comparison is explicitly *not* a
   reason to revisit (`docs/implementation-plan.md`, Phase 7 item 9).
4. **A deployment story for 591 MB.** `@huggingface/transformers` is a hard
   `dependencies` entry today, so the install is paid whether or not ONNX is
   ever selected. Shipping the semantic path as a supported mode means making
   it optional (`optionalDependencies`) or accepting the footprint explicitly.

## API

`createProvider(type, options)` in `src/core/embeddings/provider.mjs` returns a
provider with a uniform interface:

| Member | FNV-1a | ONNX |
|--------|--------|------|
| `name` | `'fnv1a'` | `'onnx'` |
| `dimensions` | 256 | 384 |
| `isAvailable()` | always `true` | `true` only when the model is cached |
| `embed(text)` | `Float32Array` | `Promise<Float32Array>` |
| `buildIndex(skills)` | `Map<string, Float32Array>` | `Promise<Map<string, Float32Array>>` |
| `downloadModel()` | not present | `Promise<void>`, throws `ProviderNotAvailableError` on failure |

Callers that use both providers must handle the async variants
(`await` works for both a value and a promise).
