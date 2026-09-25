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
  'i', 'me', 'him', 'them', 'us', 'up', 'out', 'over', 'under', 'again',
  'further', 'once', 'here', 'there', 'through', 'while', 'been', 's', 't',
  've', 're', 'll', 'd', 'm',
]);

/**
 * Tokenize text: lowercase, split on non-alphanumeric, remove stopwords.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  if (typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

/**
 * Normalise a BM25 field weight into a positive integer token-multiplicity.
 *
 * Field weights are applied by repeating a field's tokens (see
 * buildWeightedDocTokens in src/core/retriever/bm25.mjs), so the weight must
 * be an integer >= 1. Adaptive tuning (src/core/retriever/weights.mjs) and
 * data/weights.json can produce fractional values (e.g. 2.71 / 0.57); passing
 * those straight into `Array(n * w)` or `String.repeat(w)` throws a RangeError
 * and takes retrieval down with it.
 *
 * @param {number|string|undefined} weight — configured field weight
 * @returns {number} integer >= 1 (non-numeric / non-positive values fall back to 1)
 */
export function resolveFieldWeight(weight) {
  const n = typeof weight === 'number' ? weight : Number(weight);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.round(n));
}

/**
 * Compute IDF for each term across an array of document token arrays.
 * IDF(q) = ln((N - df(q) + 0.5) / (df(q) + 0.5) + 1)
 * @param {string[][]} docs  — array of token arrays
 * @returns {Map<string, number>}
 */
export function computeIdf(docs) {
  const N = docs.length;
  const df = new Map();

  for (const docTokens of docs) {
    const seen = new Set(docTokens);
    for (const token of seen) {
      df.set(token, (df.get(token) || 0) + 1);
    }
  }

  const idf = new Map();
  for (const [term, docFreq] of df) {
    idf.set(term, Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1));
  }

  return idf;
}

/**
 * Compute BM25 score for one document against query tokens.
 * @param {string[]} queryTokens
 * @param {string[]} docTokens
 * @param {Map<string, number>} idf
 * @param {number} avgDocLen
 * @param {number} k1
 * @param {number} b
 * @returns {number}
 */
export function bm25(queryTokens, docTokens, idf, avgDocLen, k1 = 1.5, b = 0.75) {
  let score = 0;
  const docLen = docTokens.length;
  if (docLen === 0 || queryTokens.length === 0) return 0;

  // Count term frequencies in this document
  const tf = new Map();
  for (const t of docTokens) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }

  for (const q of queryTokens) {
    const idfVal = idf.get(q) ?? 0;
    const termFreq = tf.get(q) ?? 0;
    if (termFreq === 0) continue;

    const numerator = termFreq * (k1 + 1);
    const denominator =
      termFreq +
      k1 * (1 - b + b * (docLen / avgDocLen));
    score += idfVal * (numerator / denominator);
  }

  return score;
}
