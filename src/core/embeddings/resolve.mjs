/**
 * Embedding provider resolution with graceful fallback.
 *
 * The hook must never fail because a semantic backend is missing. This
 * module turns the `embeddings` block of the configuration into a provider
 * instance that is safe to use right now:
 *
 *   - the configured mode ('bm25-only' | 'fnv1a' | 'onnx') is mapped through
 *     the registry in `config.embeddings.providers` to a provider type, which
 *     is then constructed and probed with `isAvailable()`;
 *   - when the probe fails (e.g. `SKILL_ROUTER_EMBEDDING_PROVIDER=onnx` with
 *     no model in the transformers cache) and `fallbackToFnv1a` is not
 *     disabled, the FNV-1a provider is returned instead;
 *   - when no provider can be produced, `provider` is null and the caller
 *     should degrade to pure BM25.
 *
 * `requested` is the mode the configuration asked for; `used` is the provider
 * type that was actually constructed. They differ only for alias modes such as
 * `bm25-only`, which the registry maps onto the FNV-1a provider.
 *
 * Resolution never loads a model: `isAvailable()` is a filesystem probe, so
 * a cold ONNX cache costs one directory scan and no network access.
 */
import { createProvider } from './provider.mjs';
import { normalizeMode, resolveProviderType } from './experimental.mjs';

/**
 * Resolve a usable embedding provider from configuration.
 *
 * @param {object} [config] — configuration object (usually `getConfig()`)
 * @param {object} [options] — resolution options
 * @param {Function} [options.createProvider] — provider factory (injectable for tests)
 * @param {object} [options.providerOptions] — options passed to the factory
 * @param {Function} [options.onWarn] — warning sink (default: console.error)
 * @returns {{provider: object|null, requested: string, used: string, fellBack: boolean, warning: string|null}}
 *   `warning` is non-null when the requested provider could not be used.
 */
export function resolveProvider(config = {}, options = {}) {
  const factory = options.createProvider ?? createProvider;
  const onWarn = options.onWarn ?? ((msg) => console.error(msg));

  const embeddings = config.embeddings ?? {};
  // `requested` is the configured MODE ('bm25-only' | 'fnv1a' | 'onnx');
  // `type` is the provider the registry maps it onto. They differ only for
  // mode names that are aliases (Phase 7.1 decision D29: 'bm25-only' and
  // 'fnv1a' both build the FNV-1a provider).
  const requested = normalizeMode(embeddings.provider ?? 'fnv1a');
  const type = resolveProviderType({ embeddings }, requested);
  const fallbackToFnv1a = embeddings.fallbackToFnv1a !== false;

  /** @type {string|null} */
  let warning = null;
  /**
   * Record and emit a degradation warning.
   * @param {string} reason
   * @param {Error} [err]
   */
  const warn = (reason, err) => {
    warning =
      `[skill-router] embedding provider "${requested}" unavailable: ${reason}` +
      `${err ? ` (${err.message})` : ''}; ` +
      (fallbackToFnv1a ? 'falling back to fnv1a' : 'no fallback configured');
    onWarn(warning);
  };

  try {
    const provider = factory(type, options.providerOptions ?? {});
    if (typeof provider?.isAvailable === 'function' && !provider.isAvailable()) {
      throw new Error('isAvailable() returned false — model is not cached');
    }
    return { provider, requested, used: type, fellBack: false, warning: null };
  } catch (err) {
    warn('not usable', err);
  }

  if (!fallbackToFnv1a || type === 'fnv1a') {
    // FNV-1a itself failed, or the operator disabled the fallback:
    // the caller degrades to pure BM25.
    return { provider: null, requested, used: 'none', fellBack: false, warning };
  }
  try {
    const fallback = factory('fnv1a', options.providerOptions ?? {});
    return { provider: fallback, requested, used: 'fnv1a', fellBack: true, warning };
  } catch (err) {
    warn('fnv1a fallback also failed', err);
    return { provider: null, requested, used: 'none', fellBack: true, warning };
  }
}
