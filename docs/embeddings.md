/**
 * Embedding providers — FNV-1a and ONNX.
 *
 * The Skill Router supports two embedding backends, selected via the
 * SKILL_ROUTER_EMBEDDING_PROVIDER environment variable (default: `fnv1a`).
 *
 * | Provider   | Dims | Dependency | Cached | Speed     | Quality      |
 * |------------|------|------------|--------|-----------|--------------|
 * | `fnv1a`    | 256  | none       | N/A    | instant   | lexical only |
 * | `onnx`     | 384  | @huggingface/transformers (~50 MB) + model (~22 MB) | on first use | ~1.5 s cold, ~10 ms warm | semantic + lexical |
 *
 * ## FNV-1a Provider (default)
 *
 * Zero-dependency character n-gram hasher. Produces deterministic 256-dim
 * unit vectors from name/description/keywords text. Fast, offline, but
 * purely lexical — does not capture semantic similarity.
 *
 * ```
 * set SKILL_ROUTER_EMBEDDING_PROVIDER=fnv1a   # default
 * node hooks/build-index.mjs --provider fnv1a
 * ```
 *
 * ## ONNX Provider (opt-in)
 *
 * Uses the [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2)
 * model via `@huggingface/transformers`. Downloads the ~22 MB ONNX model on
 * first use and caches it in `node_modules/@huggingface/transformers/.cache/`.
 * Subsequent builds reuse the cache.
 *
 * ```
 * set SKILL_ROUTER_EMBEDDING_PROVIDER=onnx
 * node hooks/build-index.mjs --provider onnx
 * ```
 *
 * The ONNX provider writes `data/skill-embeddings-384.json` (384-dim vectors);
 * the Fnv1a provider writes `data/skill-embeddings.json` (256-dim vectors).
 *
 * ### Dependency justification
 *
 * | Item               | Value                                              |
 * |--------------------|----------------------------------------------------|
 * | Package            | @huggingface/transformers                          |
 * | Version            | 4.3.0 (latest stable)                              |
 * | Install size       | ~96 MB (includes ONNX runtime + transformers code) |
 * | Model              | Xenova/all-MiniLM-L6-v2 (~22 MB, downloaded once)  |
 * | Why needed         | FNV-1a embeddings underperform BM25 on Set Recall; real embeddings capture semantic similarity required for multi-skill routing on ambiguous prompts |
 * | Fallback           | Fnv1aProvider remains the default; set FNN1A to disable the real model |
 *
 * ### Disk usage
 *
 * - Package: ~96 MB under `node_modules/@huggingface/transformers/`
 * - Model cache: ~90 MB for `model.onnx` under `.cache/Xenova/all-MiniLM-L6-v2/onnx/`
 * - Total first-run overhead: ~186 MB
 *
 * ### Offline / cold-start behaviour
 *
 * - `OnnxProvider.isAvailable()` returns `false` until the model is cached.
 * - `downloadModel()` attempts to fetch the model; if the network is offline
 *   it throws `ProviderNotAvailableError` with a clear message.
 * - `embed()` and `buildIndex()` throw `ProviderNotAvailableError` when the
 *   model is not yet cached, preventing silent fallback to zero vectors.
 *
 * ## When to use which
 *
 * - **FNV-1a** — fast builds, no extra disk, good lexical match; use as
 *   default or when disk/network constraints are tight.
 * - **ONNX** — best Set Recall and semantic recall; use when the ~186 MB
 *   overhead is acceptable and semantic similarity matters (ambiguous
 *   multi-skill prompts).
 */
