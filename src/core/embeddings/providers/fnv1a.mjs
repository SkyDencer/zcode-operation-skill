/**
 * FNV-1a embedding provider — wraps the legacy engine as a Provider.
 *
 * Produces identical 256-dimensional vectors to the original
 * `src/core/embeddings/engine.mjs` for full backward compatibility.
 */
import { embed as fnv1aEmbed, buildEmbeddingIndex as fnv1aBuildIndex } from '../engine.mjs';
import { getDefaults } from '../../../config/defaults.mjs';

const { dimensions } = getDefaults().embeddings;

/**
 * FNV-1a n-gram embedding provider.
 *
 * Implements the Provider interface:
 *   - embed(text) → Float32Array
 *   - dimensions  → number
 *   - isAvailable() → true (zero-dependency, always available)
 *   - name        → 'fnv1a'
 *   - buildIndex(skills) → Map<string, Float32Array>
 */
export class Fnv1aProvider {
  /** @returns {string} */
  get name() {
    return 'fnv1a';
  }

  /** @returns {number} */
  get dimensions() {
    return dimensions;
  }

  /**
   * Returns true — this provider has no external dependencies.
   * @returns {boolean}
   */
  isAvailable() {
    return true;
  }

  /**
   * Embed a text string into a fixed-length Float32Array.
   *
   * @param {string} text
   * @returns {Float32Array}
   */
  embed(text) {
    return fnv1aEmbed(text);
  }

  /**
   * Build an embedding index from a skill array.
   *
   * @param {Array<{name:string, path:string, description:string, keywords:string[]}>} skills
   * @returns {Map<string, Float32Array>}
   */
  buildIndex(skills) {
    return fnv1aBuildIndex(skills);
  }
}
