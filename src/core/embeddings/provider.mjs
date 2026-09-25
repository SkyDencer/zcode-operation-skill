/**
 * Embedding provider factory and abstract interface.
 *
 * Provides a single entry point for obtaining an embedding provider instance
 * by type name. Each provider exposes a uniform API regardless of backend.
 *
 * Public API:
 *   - createProvider(type, options) → Provider
 *   - Provider.embed(text)           → Float32Array
 *   - Provider.dimensions            → number
 *   - Provider.isAvailable()         → boolean
 *   - Provider.name                  → string
 *   - Provider.buildIndex(skills)    → Map<string, Float32Array>
 */
import { UnknownProviderError } from './errors.mjs';
import { Fnv1aProvider } from './providers/fnv1a.mjs';
import { OnnxProvider } from './providers/onnx.mjs';

// ─── createProvider() ────────────────────────────────────────────────────────

/**
 * Factory: return a new embedding provider instance by type name.
 *
 * Known types:
 *   - `'fnv1a'` — zero-dependency n-gram hasher (default, always available)
 *   - `'onnx'`  — ONNX transformer model (stub; throws until Sub-Phase 6.8)
 *
 * @param {'fnv1a'|'onnx'} type — provider type name
 * @param {object} [options] — provider-specific options (reserved for future use)
 * @returns {object} provider instance satisfying the Provider interface
 * @throws {UnknownProviderError} when type is not recognised
 */
export function createProvider(type, options = {}) {
  switch (type) {
    case 'fnv1a':
      return new Fnv1aProvider();
    case 'onnx':
      return new OnnxProvider(options);
    default:
      throw new UnknownProviderError(type);
  }
}
