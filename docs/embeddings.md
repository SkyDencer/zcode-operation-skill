# Embeddings

The Skill Router supports two embedding backends, selected with the
`SKILL_ROUTER_EMBEDDING_PROVIDER` environment variable (default: `fnv1a`) or
the `--provider` flag of `hooks/build-index.mjs`.

| Provider | Dims | Dependency | Cached | Speed | Quality |
|----------|------|------------|--------|-------|---------|
| `fnv1a` (default) | 256 | none | n/a | 0.08 ms per embed, 51 ms for 60 skills (measured) | lexical only |
| `onnx` (opt-in) | 384 | `@huggingface/transformers` (591 MB installed) | yes, 122 MB | 5.9 ms per embed warm, 1407 ms to build 60 skills (measured) | semantic + lexical |

Measured on Windows 10 / Node 24, corpus of 60 skills (54 leaf + 6 routers),
`Xenova/all-MiniLM-L6-v2`. Sub-Phase 6.10 measured cold start, warm inference
and the accuracy comparison; see the decision at the bottom of this file.

## FNV-1a provider (default)

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

## ONNX provider (opt-in)

Uses the [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2)
sentence-transformer through `@huggingface/transformers`, producing 384-dim
mean-pooled, L2-normalised vectors.

```
node hooks/build-index.mjs --provider onnx
```

Writes `data/skill-embeddings-384.json` (384-dim).

### Enabling

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

- **FNV-1a** — the default. No disk, no network, no startup cost, and the
  frozen BM25 baseline (92.31% Top-1) does not depend on it.
- **ONNX** — opt-in via `SKILL_ROUTER_EMBEDDING_PROVIDER=onnx`. It is a genuine
  semantic backend, but on this corpus it is not worth its cost; the numbers
  are in the Sub-Phase 6.10 decision below.

The semantic channel is disabled by default (`embeddings.weights: { bm25: 1.0, semantic: 0.0 }`). Enable it with `SKILL_ROUTER_RRF_SEMANTIC_WEIGHT=0.6` and `SKILL_ROUTER_RRF_BM25_WEIGHT=0.4` to test hybrid retrieval — but expect it to *lower* accuracy on the current corpus.

Full decision rationale: [docs/reports/phase-6-embedding-benchmark.md](./reports/phase-6-embedding-benchmark.md)

## Dependency justification

Required by the Phase 6 hard rules for every new runtime dependency.

| Item | Value |
|------|-------|
| Package | `@huggingface/transformers` |
| Version | 4.3.0 (latest stable) — declared as `^4.3.0` in `package.json` |
| Install size | **591 MB** measured (`du -sm node_modules`): `@huggingface/transformers` 135 MB, `onnxruntime-node` 288 MB, `onnxruntime-web` 141 MB, plus tokenizers/jinja/sharp/protobufjs. The mission's "~50 MB" estimate was off by more than an order of magnitude. |
| Model | `Xenova/all-MiniLM-L6-v2`, 90.4 MB `model.onnx` (86.2 MiB) + 0.7 MB tokenizer, downloaded on first use into the library cache (122 MB measured, of which 35 MB is a stale partial download) |
| Why needed | Semantic similarity for prompts whose wording differs from the skill description — the capability FNV-1a structurally cannot provide. Whether it pays for itself on *this* corpus is a separate question, answered below: it does not yet. |
| Fallback | `Fnv1aProvider` remains the default and is always available. Set `SKILL_ROUTER_EMBEDDING_PROVIDER=fnv1a` (the default) to disable the model entirely; removing the dependency only costs the opt-in provider, because nothing else imports it. |
| Offline impact | None while the default is `fnv1a`: the hook and index builder load the ONNX provider only when `--provider onnx` or `SKILL_ROUTER_EMBEDDING_PROVIDER=onnx` is set. |

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

**Default stays `fnv1a`, and the semantic channel stays off.** The rule was
"ONNX only if Set Recall improves by more than 5 pp and latency stays under
100 ms": ONNX gains 5.18 pp over FNV-1a (0.9052 vs 0.8534) but costs 1445 ms
median, 14x the budget, and both semantic-on modes are worse than the pure-BM25
configuration that ships. ONNX stays opt-in.

What would change the answer: a paraphrase test set (prompts that avoid the
skill's own vocabulary), and caching the skill vectors instead of rebuilding
them per prompt — that rebuild is the entire 1.4 s per prompt, a single embed
being 5.9 ms.

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
