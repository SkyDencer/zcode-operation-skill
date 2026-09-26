/**
 * Embedding provider factory and abstract interface.
 *
 * Provides a single entry point for obtaining an embedding provider instance
 * by type name. Each provider exposes a uniform API regardless of backend.
 *
 * Public API:
 *   - createProvider(type, options) → Provider
 *   - Provider.embed(text)           → Float32Array | Promise<Float32Array>
 *   - Provider.dimensions            → number
 *   - Provider.isAvailable()         → boolean
 *   - Provider.name                  → string
 *   - Provider.buildIndex(skills)    → Map<string, Float32Array> | Promise<Map>
 *
 * The default provider is controlled by the environment variable
 * SKILL_ROUTER_EMBEDDING_PROVIDER. Supported values: 'bm25-only' (default,
 * Phase 7.1 decision D29), 'fnv1a' (alias of 'bm25-only') and 'onnx'
 * (experimental). When unset, 'fnv1a' is used for backward compatibility.
 */
import { UnknownProviderError } from './errors.mjs';
import { Fnv1aProvider } from './providers/fnv1a.mjs';
import { OnnxProvider } from './providers/onnx.mjs';
import { DEFAULT_MODE } from './experimental.mjs';

const DEFAULT_PROVIDER_TYPE =
  process.env.SKILL_ROUTER_EMBEDDING_PROVIDER?.toLowerCase().trim() || 'fnv1a';

// ─── createProvider() ────────────────────────────────────────────────────────

/**
 * Factory: return a new embedding provider instance by type name.
 *
 * Known types:
 *   - `'fnv1a'`     — zero-dependency n-gram hasher (always available)
 *   - `'bm25-only'` — the shipped mode name for the same FNV-1a provider
 *   - `'onnx'`      — ONNX transformer model (~384-dim, experimental, requires
 *                     a downloaded model; see docs/embeddings.md)
 *
 * @param {'bm25-only'|'fnv1a'|'onnx'} [type] — provider type name (default from env)
 * @param {object} [options] — provider-specific options
 * @returns {object} provider instance satisfying the Provider interface
 * @throws {UnknownProviderError} when type is not recognised
 */
export function createProvider(type = DEFAULT_PROVIDER_TYPE, options = {}) {
  switch (type.toLowerCase().trim()) {
    case 'fnv1a':
    case DEFAULT_MODE:
      return new Fnv1aProvider();
    case 'onnx':
      return new OnnxProvider(options);
    default:
      throw new UnknownProviderError(type);
  }
}
