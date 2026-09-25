/**
 * ONNX embedding provider stub.
 *
 * Placeholder for Sub-Phase 6.8 where a real ONNX transformer model
 * (e.g. Xenova/all-MiniLM-L6-v2) will be integrated. Until then, every
 * public method throws ProviderNotAvailableError to signal that the
 * provider is not yet implemented.
 */
import { ProviderNotAvailableError } from '../errors.mjs';

/**
 * ONNX embedding provider stub.
 *
 * All operations throw ProviderNotAvailableError because the actual
 * model integration is deferred to Sub-Phase 6.8.
 */
export class OnnxProvider {
  /** @returns {string} */
  get name() {
    return 'onnx';
  }

  /**
   * Dimensionality of the ONNX model output (384 for MiniLM-L6-v2).
   * @returns {number}
   */
  get dimensions() {
    return 384;
  }

  /**
   * Returns false — the ONNX model has not been downloaded yet.
   * @returns {boolean}
   */
  isAvailable() {
    return false;
  }

  /**
   * Throws ProviderNotAvailableError — stub not yet implemented.
   *
   * @param {string} _text
   * @returns {never}
   */
  embed(_text) {
    throw new ProviderNotAvailableError(
      'ONNX embedding provider is not yet implemented. ' +
        'Run Sub-Phase 6.8 to install @huggingface/transformers and download the model.'
    );
  }

  /**
   * Throws ProviderNotAvailableError — stub not yet implemented.
   *
   * @param {_skills} _skills
   * @returns {never}
   */
  buildIndex(_skills) {
    throw new ProviderNotAvailableError(
      'ONNX embedding provider is not yet implemented. ' +
        'Run Sub-Phase 6.8 to install @huggingface/transformers and download the model.'
    );
  }
}
