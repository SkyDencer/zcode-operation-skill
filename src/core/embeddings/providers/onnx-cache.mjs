/**
 * Model-cache helpers for the ONNX embedding provider.
 *
 * `@huggingface/transformers` keeps downloaded models in its own cache
 * directory (by default `node_modules/@huggingface/transformers/.cache/`,
 * resolved from the library's own `env.cacheDir`), laid out as
 * `<cacheDir>/<org>/<repo>/onnx/model.onnx`. The provider has to answer
 * "is the model already on disk?" synchronously, before any pipeline exists,
 * so these helpers work purely on the filesystem.
 *
 * The probe is model-specific on purpose. Answering "some model.onnx exists"
 * would let a machine that has, say, a sentence-transformer cached but not
 * Xenova/all-MiniLM-L6-v2 pass the check, after which the first real
 * embedding would try to fetch the model over the network — inside a
 * UserPromptSubmit hook.
 */
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const FALLBACK_CACHE_DIR = 'node_modules/@huggingface/transformers/.cache';
/** Hugging Face repo id of the model this provider loads. */
export const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

/**
 * Resolve the transformers library cache directory synchronously.
 *
 * Reads the library's own `env.cacheDir` so the probe and the loader agree.
 * Falls back to the documented default when the library cannot be loaded.
 *
 * @returns {string}
 */
export function resolveCacheDir() {
  try {
    const req = createRequire(import.meta.url);
    const mod = req('@huggingface/transformers');
    return mod.env.cacheDir || resolve(FALLBACK_CACHE_DIR);
  } catch {
    return resolve(FALLBACK_CACHE_DIR);
  }
}

/**
 * Report whether a model file is present in a cache directory.
 *
 * Only the layout the transformers library actually writes is considered:
 * `<cacheDir>/<org>/<repo>/onnx/model.onnx`. A recursively-found
 * `model.onnx` belonging to some other repository does not count, because
 * this probe is what decides whether the hook will attempt a network fetch.
 *
 * @param {string|null|undefined} cacheDir
 * @param {string} [modelId] — Hugging Face repo id (default: Xenova/all-MiniLM-L6-v2)
 * @returns {boolean}
 */
export function isModelCached(cacheDir, modelId = MODEL_ID) {
  if (!cacheDir || !existsSync(cacheDir)) return false;
  const repoPath = join(cacheDir, ...modelId.split('/'));
  const candidates = [
    join(repoPath, 'onnx', 'model.onnx'),
    join(repoPath, 'model.onnx'),
    join(repoPath, 'onnx', 'model_quantized.onnx'),
  ];
  return candidates.some((p) => {
    try {
      return existsSync(p) && statSync(p).isFile();
    } catch {
      return false;
    }
  });
}
