/**
 * Experimental embedding-provider policy (Phase 7.1, decision D29).
 *
 * The Phase 6 measurements decided against shipping the semantic path: ONNX
 * MiniLM gains +5.18 pp Set Recall@5 over FNV-1a with the channel on, but
 * costs 1445 ms median against a 100 ms budget, and *both* semantic-on modes
 * score below the pure-BM25 configuration that ships (Set Recall@5 1.0000).
 * The code stays; the capability is off by default and labelled experimental.
 *
 * This module owns the two things that make that label observable:
 *
 *   1. the provider registry in `config.embeddings.providers`, which maps a
 *      configuration *mode* ('bm25-only' | 'fnv1a' | 'onnx') onto the provider
 *      *type* `createProvider()` builds, and marks entries experimental;
 *   2. `emitExperimentalMode()`, which writes the `experimental_mode`
 *      telemetry event `{ event, mode, risk }` and a stderr warning when an
 *      operator explicitly selects an experimental mode.
 *
 * Fail-open contract: nothing in this module throws. A telemetry event that
 * cannot be written is dropped, never surfaced as a routing failure — the hook
 * must exit 0 with no output when it cannot compute a decision.
 */
import { logRecord } from '../telemetry/logger.mjs';

/** Mode name that means "lexical only, no semantic backend in the path". */
export const DEFAULT_MODE = 'bm25-only';

/** Telemetry event name written when an experimental mode is selected. */
export const EXPERIMENTAL_EVENT = 'experimental_mode';

/**
 * Registry used when the configuration carries no `embeddings.providers` block
 * (older or hand-built config objects). Mirrors src/config/defaults.mjs.
 */
const FALLBACK_REGISTRY = {
  'bm25-only': { type: 'fnv1a', experimental: false, risk: null },
  fnv1a: { type: 'fnv1a', experimental: false, risk: null },
  onnx: { type: 'onnx', experimental: true, risk: 'untested_scale' },
};

/**
 * Normalise a provider name: lowercase, trimmed, empty falls back to the
 * default mode.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeMode(value) {
  const raw = String(value ?? '').toLowerCase().trim();
  return raw === '' ? DEFAULT_MODE : raw;
}

/**
 * Return the provider registry from configuration, or the built-in fallback.
 *
 * @param {object} [config] — configuration object (usually `getConfig()`)
 * @returns {Record<string, {type:string, experimental:boolean, risk:string|null}>}
 */
export function getProviderRegistry(config = {}) {
  const registry = config?.embeddings?.providers;
  if (!registry || typeof registry !== 'object') return FALLBACK_REGISTRY;
  return registry;
}

/**
 * Look up one provider entry.
 *
 * Unknown modes resolve to `null` rather than throwing, so a typo in
 * `SKILL_ROUTER_EMBEDDING_PROVIDER` degrades to the caller's existing
 * "unknown provider" handling instead of crashing the hook.
 *
 * @param {object} [config]
 * @param {string} [mode] — provider mode name (defaults to `embeddings.provider`)
 * @returns {{mode:string, type:string, experimental:boolean, risk:string|null}|null}
 */
export function getProviderEntry(config = {}, mode) {
  const key = normalizeMode(mode ?? config?.embeddings?.provider);
  const entry = getProviderRegistry(config)[key];
  if (!entry || typeof entry !== 'object') return null;
  return {
    mode: key,
    type: typeof entry.type === 'string' && entry.type !== '' ? entry.type : key,
    experimental: entry.experimental === true,
    risk: typeof entry.risk === 'string' ? entry.risk : null,
  };
}

/**
 * The provider type that should actually be constructed for a mode.
 * Falls back to the mode itself when the registry has no entry, which is what
 * `createProvider()` rejects with UnknownProviderError.
 *
 * @param {object} [config]
 * @param {string} [mode]
 * @returns {string}
 */
export function resolveProviderType(config = {}, mode) {
  return getProviderEntry(config, mode)?.type ?? normalizeMode(mode ?? config?.embeddings?.provider);
}

/**
 * True when the selected mode is flagged experimental in the registry.
 *
 * @param {object} [config]
 * @param {string} [mode]
 * @returns {boolean}
 */
export function isExperimentalMode(config = {}, mode) {
  return getProviderEntry(config, mode)?.experimental === true;
}

/**
 * Build the `experimental_mode` telemetry event for the selected mode, or
 * `null` when the mode is not experimental (the normal case).
 *
 * The event shape is fixed by the Phase 7.1 contract:
 * `{ event: 'experimental_mode', mode: 'onnx', risk: 'untested_scale' }`.
 *
 * @param {object} [config]
 * @param {string} [mode]
 * @returns {{event:string, mode:string, risk:string}|null}
 */
export function experimentalModeEvent(config = {}, mode) {
  const entry = getProviderEntry(config, mode);
  if (!entry || !entry.experimental) return null;
  return {
    event: EXPERIMENTAL_EVENT,
    mode: entry.mode,
    risk: entry.risk ?? 'unknown',
  };
}

/**
 * Human-readable warning printed to stderr for an experimental mode.
 *
 * @param {{mode:string, risk:string}} event
 * @returns {string}
 */
export function experimentalWarningText(event) {
  return (
    `[skill-router] ${EXPERIMENTAL_EVENT}: embedding provider "${event.mode}" is ` +
    `EXPERIMENTAL and not recommended (risk: ${event.risk}). The default is ` +
    `"${DEFAULT_MODE}" (lexical BM25). Measured in Phase 6 it was slower than ` +
    `the 100 ms budget and no more accurate than the default; see ` +
    `docs/embeddings.md and docs/reports/phase-7.1-semantic-decision.md.`
  );
}

/**
 * Emit the experimental-mode telemetry event and stderr warning, if the
 * selected provider mode is experimental.
 *
 * Never throws and never rejects: the returned promise always resolves, with
 * the event that was emitted (or null when nothing was emitted). A logging or
 * logging-transport failure is reported through `options.onError` when the
 * caller supplies one, and is otherwise dropped — the hook must stay fail-open.
 *
 * @param {object} [config] — configuration object (usually `getConfig()`)
 * @param {object} [options]
 * @param {string} [options.mode] — override the configured mode
 * @param {Function} [options.onWarn] — stderr sink (default: console.error)
 * @param {Function} [options.onError] — failure sink for the dropped event
 * @returns {Promise<{event:string, mode:string, risk:string}|null>}
 */
export async function emitExperimentalMode(config = {}, options = {}) {
  const onWarn = options.onWarn ?? ((msg) => console.error(msg));
  const onError = options.onError ?? null;
  try {
    const event = experimentalModeEvent(config, options.mode);
    if (!event) return null;
    if (typeof onWarn === 'function') onWarn(experimentalWarningText(event));
    await logRecord(event);
    return event;
  } catch (err) {
    if (typeof onError === 'function') {
      try {
        onError(`[skill-router] experimental_mode telemetry dropped: ${err?.message ?? err}`);
      } catch {
        // Nothing further can be done; the hook must stay fail-open.
      }
    }
    return null;
  }
}
