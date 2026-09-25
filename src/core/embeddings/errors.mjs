/**
 * Embedding provider error classes.
 *
 * Custom errors for the provider abstraction so callers can distinguish
 * between an unavailable provider and a configuration mistake.
 */

/**
 * Thrown when a requested embedding provider is not available.
 *
 * This covers two cases:
 * 1. The provider implementation has not been installed (e.g. ONNX model missing).
 * 2. The provider type is unknown and no matching factory exists.
 */
class ProviderNotAvailableError extends Error {
  /**
   * @param {string} [message] — human-readable explanation
   */
  constructor(message = 'Embedding provider is not available') {
    super(message);
    this.name = 'ProviderNotAvailableError';
  }
}

/**
 * Thrown when the factory receives an unknown provider type string.
 */
class UnknownProviderError extends Error {
  /**
   * @param {string} type — the unrecognized provider type
   */
  constructor(type) {
    super(`Unknown embedding provider type: ${type}`);
    this.name = 'UnknownProviderError';
  }
}

export { ProviderNotAvailableError, UnknownProviderError };
