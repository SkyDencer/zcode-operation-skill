/**
 * Text utility functions for tokenization, normalization, stopword filtering,
 * and bigram extraction.
 *
 * Imports tokenize from scorer.mjs and STOPWORDS for internal use only;
 * adds complementary helpers. STOPWORDS is not re-exported — consumers
 * that need it should import directly from '../scorer.mjs'.
 */
import { tokenize as _tokenize, STOPWORDS } from '../scorer.mjs';

/**
 * Tokenize text: lowercase, split on non-alphanumeric, remove stopwords.
 * Delegates to scorer.mjs tokenize.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  return _tokenize(text);
}

/**
 * Normalize text: lowercase, collapse whitespace, trim.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  if (typeof text !== 'string') return '';
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Filter stopwords from a token array.
 *
 * @param {string[]} tokens
 * @returns {string[]}
 */
export function filterStopwords(tokens) {
  return tokens.filter((t) => !STOPWORDS.has(t));
}

/**
 * Extract bigrams from a token array.
 *
 * @param {string[]} tokens
 * @returns {string[]}
 */
export function bigrams(tokens) {
  const result = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    result.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return result;
}
