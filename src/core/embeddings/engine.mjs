/**
 * Embeddings engine — local, zero-dependency character n-gram hashing.
 *
 * Uses FNV-1a to hash character 2-grams, 3-grams, word tokens, and
 * word bigrams into a fixed-length Float32Array vector, normalized
 * to unit length. Cosine similarity between two unit vectors is
 * equivalent to their dot product, bounded to [0, 1].
 */

import { readFileSync } from 'node:fs';
import { getDefaults } from '../../config/defaults.mjs';

const { dimensions, ngramSizes, hashSeed } = getDefaults().embeddings;

// ─── FNV-1a 32-bit ───────────────────────────────────────────────────────────

/**
 * Compute the FNV-1a 32-bit hash of a string.
 * @param {string} str
 * @returns {number} unsigned 32-bit integer
 */
export function fnv1a(str) {
  let hash = hashSeed >>> 0; // ensure unsigned 32-bit
  for (let i = 0; i < str.length; i++) {
    const byte = str.charCodeAt(i) & 0xff;
    hash ^= byte;
    // FNV prime 2166136261, masked to 32-bit
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

// ─── embed() ─────────────────────────────────────────────────────────────────

/**
 * Extract character n-grams from text.
 * @param {string} text
 * @param {number[]} sizes
 * @returns {string[]}
 */
function characterNgrams(text, sizes) {
  const lower = text.toLowerCase();
  const ngrams = new Set();
  for (const n of sizes) {
    if (n > lower.length) continue;
    for (let i = 0; i <= lower.length - n; i++) {
      ngrams.add(lower.slice(i, i + n));
    }
  }
  return [...ngrams];
}

/**
 * Embed a text string into a fixed-length Float32Array.
 *
 * Character 2-grams and 3-grams are hashed into vector buckets via FNV-1a,
 * then the vector is normalized to unit length. Word tokens and bigrams
 * are also hashed to provide stronger lexical signal for multi-word phrases.
 *
 * @param {string} text
 * @returns {Float32Array} unit vector of length `dimensions`
 */
export function embed(text) {
  const vec = new Float32Array(dimensions);
  const lower = text.toLowerCase();

  // Character n-grams (2-grams, 3-grams)
  for (const n of ngramSizes) {
    for (let i = 0; i <= lower.length - n; i++) {
      const h = fnv1a(lower.slice(i, i + n)) % dimensions;
      vec[h] += 0.5;
    }
  }

  // Word tokens and bigrams for stronger lexical signal
  const tokens = lower.split(/[^a-z0-9]+/).filter((t) => t.length > 0);
  for (const t of tokens) {
    const h = fnv1a(t) % dimensions;
    vec[h] += 1.0;
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    const h = fnv1a(tokens[i] + ' ' + tokens[i + 1]) % dimensions;
    vec[h] += 0.5;
  }

  // Normalize to unit length
  let mag = 0;
  for (let i = 0; i < dimensions; i++) {
    mag += vec[i] * vec[i];
  }
  mag = Math.sqrt(mag);
  if (mag > 0) {
    for (let i = 0; i < dimensions; i++) {
      vec[i] /= mag;
    }
  }

  return vec;
}

// ─── cosineSimilarity() ──────────────────────────────────────────────────────

/**
 * Compute cosine similarity between two unit vectors.
 *
 * Since both inputs are expected to be normalized to unit length,
 * this is equivalent to the dot product, bounded to [0, 1].
 *
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number} cosine similarity in [0, 1]
 */
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  // Clamp to [0, 1] to guard against floating-point drift
  return Math.max(0, Math.min(1, dot));
}

// ─── buildEmbeddingIndex() ───────────────────────────────────────────────────

/**
 * Build an embedding index from an array of skill objects.
 *
 * Reads each skill's SKILL.md file (using the skill's `path` field)
 * to get the full text including frontmatter and body content.
 * Each skill is embedded from its complete text, then normalized
 * to a unit vector.
 *
 * Returns a Map keyed by skill name, mapping to its Float32Array embedding.
 * Also writes the index to data/skill-embeddings.json on disk.
 *
 * @param {Array<{name:string, description:string, keywords:string[], path:string}>} skills
 * @returns {Map<string, Float32Array>}
 */
export function buildEmbeddingIndex(skills) {
  const index = new Map();

  for (const skill of skills) {
    let combined = '';
    // Prefer reading the full SKILL.md if the path exists
    if (skill.path && skill.path.endsWith('SKILL.md')) {
      try {
        combined = readFileSync(skill.path, 'utf-8');
      } catch {
        // Fall back to name + description + keywords
        combined = `${skill.name} ${skill.description} ${(skill.keywords || []).join(' ')}`;
      }
    } else {
      combined = `${skill.name} ${skill.description} ${(skill.keywords || []).join(' ')}`;
    }
    const vector = embed(combined);
    index.set(skill.name, vector);
  }

  return index;
}
