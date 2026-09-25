/**
 * ONNX embedding provider using @huggingface/transformers.
 *
 * Loads the Xenova/all-MiniLM-L6-v2 model (384-dimensional embeddings)
 * on first use. The model is cached locally by the transformers library
 * and reused across calls.
 *
 * The provider is opt-in: set SKILL_ROUTER_EMBEDDING_PROVIDER=onnx to
 * enable it. The default remains Fnv1aProvider for backward compatibility.
 */
import { ProviderNotAvailableError } from '../errors.mjs';
import { isModelCached, resolveCacheDir } from './onnx-cache.mjs';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

/**
 * Text used to force the lazy model load in `downloadModel()`.
 * Never embedded; its only job is to make the library fetch the weights.
 */
const WARMUP_TEXT = 'warmup';

/**
 * ONNX embedding provider.
 *
 * Implements the Provider interface:
 *   - embed(text) → Float32Array(384) — throws if model not cached
 *   - dimensions  → 384
 *   - isAvailable() → true if the model is cached locally
 *   - name        → 'onnx'
 *   - downloadModel() → downloads model on first use (async)
 *   - buildIndex(skills) → Map<string, Float32Array> (async)
 */
export class OnnxProvider {
  /** @private {object|null} */
  #pipeline = null;
  /** @private {Promise<object>|null} */
  #loadPromise = null;
  /** @private {string} */
  #cacheDir;
  /** @private {string|null} */
  #cacheDirOverride = null;

  /**
   * @param {object} [options] — provider options
   * @param {string} [options.cacheDir] — override the default cache directory.
   *   Applied to the transformers library as `env.cacheDir` when the pipeline
   *   is created, so the availability probe and the loader agree.
   */
  constructor(options = {}) {
    this.#cacheDir = options.cacheDir || resolveCacheDir();
    this.#cacheDirOverride = options.cacheDir || null;
  }

  /** @returns {string} */
  get name() {
    return 'onnx';
  }

  /** @returns {number} */
  get dimensions() {
    return EMBEDDING_DIM;
  }

  /**
   * Check whether the ONNX model is cached locally.
   *
   * Looks for a `model.onnx` file anywhere under the transformers cache
   * directory.
   *
   * @returns {boolean}
   */
  isAvailable() {
    return isModelCached(this.#cacheDir);
  }

  /**
   * Embed a single text string into a 384-dimensional unit vector.
   *
   * Synchronously checks isAvailable() first. If the model is not cached,
   * throws ProviderNotAvailableError immediately. Otherwise loads (or
   * reuses) the pipeline and returns the embedding.
   *
   * @param {string} text
   * @returns {Float32Array}
   * @throws {ProviderNotAvailableError} when the model is not cached
   */
  embed(text) {
    if (!this.isAvailable()) {
      throw new ProviderNotAvailableError(
        'ONNX model is not cached locally. Call downloadModel() first, ' +
          'or set SKILL_ROUTER_EMBEDDING_PROVIDER=onnx after downloading.'
      );
    }
    return this.#embedAsync(text);
  }

  /**
   * Build an embedding index for an array of skills.
   *
   * Synchronously checks isAvailable() first. If the model is not cached,
   * throws ProviderNotAvailableError immediately.
   *
   * @param {Array<{name:string, description:string, keywords:string[]}>} skills
   * @returns {Map<string, Float32Array>}
   * @throws {ProviderNotAvailableError} when the model is not cached
   */
  buildIndex(skills) {
    if (!this.isAvailable()) {
      throw new ProviderNotAvailableError(
        'ONNX model is not cached locally. Call downloadModel() first.'
      );
    }
    return this.#buildIndexAsync(skills);
  }

  /**
   * Explicitly trigger model download.
   *
   * The transformers library builds the pipeline lazily: creating it fetches
   * nothing, and the model files are only requested on the first inference
   * call. A one-sentence warm-up run is therefore what actually triggers the
   * download; without it this method would resolve on a machine that has no
   * network at all.
   *
   * Rejects with ProviderNotAvailableError for every failure mode — offline
   * network, missing remote access, or a corrupt cache entry — so callers
   * never see a raw library error.
   *
   * @returns {Promise<void>}
   * @throws {ProviderNotAvailableError} when the model cannot be loaded
   */
  async downloadModel() {
    try {
      const pipeline = await this.#ensurePipeline();
      await pipeline(WARMUP_TEXT, { pooling: 'mean' });
    } catch (err) {
      throw this.#unavailable(err);
    }
  }

  // ─── private async helpers ────────────────────────────────────────────────

  /**
   * Internal async embed implementation (called after isAvailable check).
   *
   * @param {string} text
   * @returns {Float32Array}
   */
  async #embedAsync(text) {
    const pipeline = await this.#loadPipeline();
    const result = await pipeline(text, { pooling: 'mean' });
    const cd = result.ort_tensor.cpuData;
    const vec = new Float32Array(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      vec[i] = cd[String(i)];
    }
    return this.#normalize(vec);
  }

  /**
   * Internal async buildIndex implementation (called after isAvailable check).
   *
   * @param {Array<{name:string, description:string, keywords:string[]}>} skills
   * @returns {Promise<Map<string, Float32Array>>}
   */
  async #buildIndexAsync(skills) {
    const pipeline = await this.#loadPipeline();
    const texts = skills.map(
      (s) => `${s.name} ${s.description} ${(s.keywords || []).join(' ')}`
    );
    const results = await pipeline(texts, { pooling: 'mean' });
    const idx = new Map();
    const cd = results.ort_tensor.cpuData;
    for (let i = 0; i < skills.length; i++) {
      const vec = new Float32Array(EMBEDDING_DIM);
      const offset = i * EMBEDDING_DIM;
      for (let j = 0; j < EMBEDDING_DIM; j++) {
        vec[j] = cd[String(offset + j)];
      }
      idx.set(skills[i].name, this.#normalize(vec));
    }
    return idx;
  }

  /**
   * Load the pipeline, converting any library error into a
   * ProviderNotAvailableError with actionable guidance.
   *
   * @returns {Promise<object>}
   * @throws {ProviderNotAvailableError}
   */
  async #loadPipeline() {
    try {
      return await this.#ensurePipeline();
    } catch (err) {
      throw this.#unavailable(err);
    }
  }

  /**
   * Wrap a library error into a ProviderNotAvailableError.
   *
   * The underlying library throws a variety of messages depending on the
   * failure (fetch errors, `local_files_only` rejections, tokenizer
   * problems). Callers only need to handle one error type.
   *
   * @param {unknown} err
   * @returns {ProviderNotAvailableError}
   */
  #unavailable(err) {
    return new ProviderNotAvailableError(
      `ONNX model "${MODEL_ID}" could not be loaded: ${err?.message ?? err}. ` +
        'The first load needs network access; if the model is already ' +
        'cached this indicates a corrupt cache entry (delete the cache ' +
        'directory under node_modules/@huggingface/transformers/.cache). ' +
        'Set SKILL_ROUTER_EMBEDDING_PROVIDER=fnv1a to stay offline.'
    );
  }

  /**
   * Ensure the transformers pipeline is loaded, caching the promise.
   *
   * An explicit `cacheDir` is pushed into the library environment before the
   * pipeline is created; otherwise the library keeps its own default and the
   * provider's availability probe would be looking in a different place from
   * the loader.
   *
   * @returns {Promise<object>}
   */
  async #ensurePipeline() {
    if (this.#pipeline) return this.#pipeline;
    if (this.#loadPromise) return this.#loadPromise;
    this.#loadPromise = import('@huggingface/transformers').then((mod) => {
      if (this.#cacheDirOverride) {
        mod.env.cacheDir = this.#cacheDirOverride;
      }
      return mod.pipeline('feature-extraction', MODEL_ID);
    });
    try {
      this.#pipeline = await this.#loadPromise;
    } finally {
      this.#loadPromise = null;
    }
    return this.#pipeline;
  }

  /**
   * Normalize a Float32Array to unit length.
   *
   * @param {Float32Array} vec
   * @returns {Float32Array}
   */
  #normalize(vec) {
    let mag = 0;
    for (let i = 0; i < vec.length; i++) {
      mag += vec[i] * vec[i];
    }
    mag = Math.sqrt(mag);
    if (mag > 0) {
      for (let i = 0; i < vec.length; i++) {
        vec[i] /= mag;
      }
    }
    return vec;
  }
}
