# Embeddings

The Skill Router supports two embedding backends, selected with the
`SKILL_ROUTER_EMBEDDING_PROVIDER` environment variable (default: `fnv1a`) or
the `--provider` flag of `hooks/build-index.mjs`.

| Provider | Dims | Dependency | Cached | Speed | Quality |
|----------|------|------------|--------|-------|---------|
| `fnv1a` (default) | 256 | none | n/a | 0.1 s for 60 skills (measured) | lexical only |
| `onnx` (opt-in) | 384 | `@huggingface/transformers` | yes, 122 MB | 2.0 s for 60 skills with a warm cache (measured) | semantic + lexical |

Measured on Windows 10 / Node 24, corpus of 60 skills (54 leaf + 6 routers),
`hooks/build-index.mjs`. Cold-start timing (first download included) is not
recorded here; Sub-Phase 6.10 measures it.

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
| `Xenova/all-MiniLM-L6-v2/onnx/model.onnx` | 90.4 MB |
| `Xenova/all-MiniLM-L6-v2/tokenizer.json` | 0.7 MB |
| `config.json` + `tokenizer_config.json` | < 1 KB |
| Cache total | ~122 MB |

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
- **ONNX** — available for experimentation via `SKILL_ROUTER_EMBEDDING_PROVIDER=onnx`. Not recommended as default: Phase 6.10 benchmark showed no Set Recall improvement over FNV-1a (both 92.31% on 130-prompt real corpus) when semantic weight is 0.0, and significant overhead (254 MB disk, 396 ms cold embed latency).

The semantic channel is disabled by default (`embeddings.weights: { bm25: 1.0, semantic: 0.0 }`). Enable it with `SKILL_ROUTER_RRF_SEMANTIC_WEIGHT=0.6` and `SKILL_ROUTER_RRF_BM25_WEIGHT=0.4` to test hybrid retrieval — but expect no accuracy gain on the current corpus.

Full decision rationale: [docs/reports/phase-6-embedding-benchmark.md](./reports/phase-6-embedding-benchmark.md)

## Dependency justification

Required by the Phase 6 hard rules for every new runtime dependency.

| Item | Value |
|------|-------|
| Package | `@huggingface/transformers` |
| Version | 4.3.0 (latest stable) — declared as `^4.3.0` in `package.json` |
| Install size | **132 MB** measured (`du -sm node_modules/@huggingface`) |
| Model | `Xenova/all-MiniLM-L6-v2`, 90.4 MB `model.onnx` + 0.7 MB tokenizer, downloaded on first use into the library cache |
| Why needed | The FNV-1a n-gram embeddings underperform BM25 on Set Recall. Real sentence embeddings capture semantic similarity, which multi-skill routing needs on prompts whose wording differs from the skill description. `@huggingface/transformers` is the maintained successor to `@xenova/transformers` and ships the ONNX runtime, so no separate runtime is required. |
| Fallback | `Fnv1aProvider` remains the default and is always available. Set `SKILL_ROUTER_EMBEDDING_PROVIDER=fnv1a` (the default) to disable the model entirely; removing the dependency only costs the opt-in provider, because nothing else imports it. |
| Offline impact | None while the default is `fnv1a`: the hook and index builder load the ONNX provider only when `--provider onnx` or `SKILL_ROUTER_EMBEDDING_PROVIDER=onnx` is set. |

### Phase 6.10 Decision

Benchmark results (130-prompt real corpus, 54 leaf skills):

| Mode | Top-1 | Set Recall | Median Latency |
|------|-------|------------|----------------|
| BM25 (flat) | 92.31% | 92.31% | 3 ms |
| Hybrid (FNV-1a, semantic=0) | 92.31% | 92.31% | 3 ms |
| Hybrid (ONNX, semantic=0) | 92.31% | 92.31% | 3 ms |

ONNX does **not** improve Set Recall over FNV-1a when semantic weight is 0.0 (default). A weight sweep showed semantic embeddings were a net negative for Top-1 at every weight configuration. Per the sub-phase rule — switch only if Set Recall improves by >5 pp and latency stays <100 ms — the threshold is not met.

Default remains `fnv1a`. Semantic channel can be enabled for experimentation but is not recommended for production.

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
