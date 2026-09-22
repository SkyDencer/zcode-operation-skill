/**
 * Text utility functions for tokenization, normalization, stopword filtering,
 * and bigram extraction.
 *
 * Re-exports tokenize from scorer.mjs and adds complementary helpers.
 */
import { tokenize as _tokenize } from '../scorer.mjs';

/** Common English stopwords to filter out during tokenization. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'not',
  'no', 'nor', 'so', 'if', 'then', 'than', 'that', 'this', 'what',
  'when', 'where', 'which', 'who', 'whom', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'only',
  'own', 'same', 'too', 'very', 'just', 'about', 'above', 'after', 'again',
  'also', 'any', 'because', 'before', 'between', 'during', 'into', 'its',
  'it\'s', 'my', 'your', 'his', 'her', 'our', 'their', 'we', 'they', 'you',
  'i', 'me', 'him', 'them', 'us', 'up', 'out', 'over', 'under', 'further',
  'once', 'here', 'there', 'through', 'while', 's', 't', 've', 're', 'll',
  'd', 'm',
]);

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
