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
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { ProviderNotAvailableError } from '../errors.mjs';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

/**
 * Resolve the transformers library cache directory synchronously.
 *
 * @returns {string}
 */
function resolveCacheDir() {
  try {
    const req = createRequire(import.meta.url);
    const mod = req('@huggingface/transformers');
    return mod.env.cacheDir || resolve('node_modules/@huggingface/transformers/.cache');
  } catch {
    return resolve('node_modules/@huggingface/transformers/.cache');
  }
}

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

  /**
   * @param {object} [options] — provider options
   * @param {string} [options.cacheDir] — override the default cache directory
   */
  constructor(options = {}) {
    this.#cacheDir = options.cacheDir || resolveCacheDir();
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
   * Looks for model.onnx inside the transformers cache directory.
   * @returns {boolean}
   */
  isAvailable() {
    if (!this.#cacheDir || !existsSync(this.#cacheDir)) return false;
    try {
      const entries = this.#findModelOnnx(this.#cacheDir);
      return entries.length > 0;
    } catch {
      return false;
    }
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
   * Resolves when the model is loaded (cached or freshly downloaded).
   * Rejects gracefully with a informative message when offline.
   *
   * @returns {Promise<void>}
   */
  async downloadModel() {
    try {
      const pipeline = await this.#ensurePipeline();
      void pipeline; // pipeline is cached in #pipeline
    } catch (err) {
      if (err.message.includes('fetch') || err.message.includes('network')) {
        throw new ProviderNotAvailableError(
          `ONNX model download failed: ${err.message}. ` +
            'Ensure internet connectivity and retry.'
        );
      }
      throw err;
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
    const pipeline = await this.#ensurePipeline();
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
    const pipeline = await this.#ensurePipeline();
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
   * Ensure the transformers pipeline is loaded, caching the promise.
   *
   * @returns {Promise<object>}
   */
  async #ensurePipeline() {
    if (this.#pipeline) return this.#pipeline;
    if (this.#loadPromise) return this.#loadPromise;
    this.#loadPromise = import('@huggingface/transformers').then(
      (mod) => mod.pipeline('feature-extraction', MODEL_ID)
    );
    try {
      this.#pipeline = await this.#loadPromise;
    } finally {
      this.#loadPromise = null;
    }
    return this.#pipeline;
  }

  /**
   * Recursively search for model.onnx files under a directory.
   *
   * @param {string} dir
   * @returns {string[]}
   */
  #findModelOnnx(dir) {
    const results = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      try {
        const isDirectory = existsSync(full) && statSync(full).isDirectory();
        if (entry === 'model.onnx' && existsSync(full) && !isDirectory) {
          results.push(full);
        } else if (isDirectory && readdirSync(full).length > 0) {
          results.push(...this.#findModelOnnx(full));
        }
      } catch {
        // Skip entries that cannot be stat'd
      }
    }
    return results;
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
