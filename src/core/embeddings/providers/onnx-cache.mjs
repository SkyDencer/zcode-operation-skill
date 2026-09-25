/**
 * Model-cache helpers for the ONNX embedding provider.
 *
 * `@huggingface/transformers` keeps downloaded models in its own cache
 * directory (by default `node_modules/@huggingface/transformers/.cache/`,
 * resolved from the library's own `env.cacheDir`). The provider has to answer
 * "is the model already on disk?" synchronously, before any pipeline exists,
 * so these helpers work purely on the filesystem.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const FALLBACK_CACHE_DIR = 'node_modules/@huggingface/transformers/.cache';

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
 * Recursively collect every `model.onnx` file under a directory.
 *
 * @param {string} dir
 * @returns {string[]} absolute paths (empty when the directory is unreadable)
 */
function findModelOnnx(dir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      const isDirectory = statSync(full).isDirectory();
      if (entry === 'model.onnx' && !isDirectory) {
        results.push(full);
      } else if (isDirectory) {
        results.push(...findModelOnnx(full));
      }
    } catch {
      // Skip entries that cannot be stat'd (permissions, races, broken links)
    }
  }
  return results;
}

/**
 * Report whether a model file is present in a cache directory.
 *
 * @param {string|null|undefined} cacheDir
 * @returns {boolean}
 */
export function isModelCached(cacheDir) {
  if (!cacheDir || !existsSync(cacheDir)) return false;
  try {
    return findModelOnnx(cacheDir).length > 0;
  } catch {
    return false;
  }
}
