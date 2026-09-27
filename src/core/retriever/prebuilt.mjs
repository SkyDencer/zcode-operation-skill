/**
 * Prebuilt parsed BM25 index (Sub-Phase 7.6).
 *
 * rankSkills() re-derives the corpus-side work on every call: weighted
 * per-doc token arrays (name x3, description x2, keywords x1), the corpus
 * IDF map, and a fresh per-doc term-frequency map. That is cheap at 54
 * skills and dominant at 1000 (measured: rankSkills p95 136 ms in-process,
 * vs ~10 ms for the scoring loop alone). Since a ZCode hook spawn is a
 * fresh process, the only useful cache for that work is on disk: the index
 * builders (hooks/build-index.mjs, src/cli/reindex.mjs) write
 * data/skill-index.prebuilt.json next to the index, and the hook feeds it
 * back into rankSkills() through options._prebuilt.
 *
 * The prebuilt structure holds the corpus side only — the term-frequency
 * pairs, the weighted doc length, and the field-weight stamp. Everything
 * that depends on the live document set (IDF, average doc length) is
 * recomputed for the exact subset being scored, so the scoring arithmetic
 * is bit-identical to the slow path: same weights, same tokenization,
 * same formula, same normalization. Any mismatch (stale fingerprint,
 * changed field weights, missing file, malformed shape) invalidates the
 * cache and the caller falls back to the slow path — the hook never fails
 * because of the cache.
 *
 * The fixture build script (tests/fixtures/large-index/build.mjs) writes a
 * matching prebuilt file for the 1000-skill test index.
 */
import { resolveFieldWeight } from '../../scorer.mjs';
import { buildWeightedDocTokens } from './bm25.mjs';
import { getDefaults } from '../../config/defaults.mjs';
import { computeIndexFingerprint } from '../cache/query-cache.mjs';

/** Schema version of the prebuilt file; bump on any shape change. */
export const PREBUILT_VERSION = 1;

/**
 * Build the serializable corpus side of the index.
 *
 * Docs align positionally with `index`: docs[i] belongs to index[i].
 * `tf` is a sorted [term, count] pair list of the weighted token array.
 *
 * The weighted array is produced by the SAME function the slow rankSkills
 * path uses (`buildWeightedDocTokens` with the active field weights), not a
 * re-implementation — the name/description fields repeat their token array
 * `fieldLength × reps` times (a legacy quirk), and only keywords repeat
 * `reps` times per token. Re-deriving that by hand is how a silent ranking
 * drift would sneak in; calling the real function guarantees the cached
 * corpus side is bit-identical to what the slow path would build.
 *
 * @param {Array<{name:string, description:string, keywords?:string[]}>} index
 * @returns {{version:number, n:number, fingerprint:string, fieldWeights:object, docs:Array<{tf:*, len:number}>}}
 */
export function buildPrebuiltIndex(index) {
  const weights = getDefaults().bm25;

  const docs = index.map((skill) => {
    // Exactly the tokens the slow path scores.
    const combined = buildWeightedDocTokens(skill, weights);
    const tf = new Map();
    for (const t of combined) tf.set(t, (tf.get(t) || 0) + 1);
    // Stable serialization order: sort by term.
    const pairs = [...tf.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return { tf: pairs, len: combined.length };
  });

  // Stamp the resolved integer weights so the consumer can reject a stale
  // cache after an adaptive-weights change (data/weights.json).
  return {
    version: PREBUILT_VERSION,
    n: index.length,
    fingerprint: computeIndexFingerprint(index),
    fieldWeights: {
      name: resolveFieldWeight(weights.nameWeight),
      description: resolveFieldWeight(weights.descriptionWeight),
      keywords: resolveFieldWeight(weights.keywordWeight),
    },
    docs,
  };
}

/**
 * Prepare a prebuilt structure for a live document subset (e.g. the
 * hook's leaf-only index), or null when it must not be used.
 *
 * Validation, in order:
 *   1. version, shape, and n against the FULL array the producer saw;
 *   2. fingerprint of that full array;
 *   3. the stamped integer field weights against the active defaults.
 * IDF and avgDocLen are then recomputed over the subset, because rankSkills
 * scores over the subset it is handed — a cached corpus-wide IDF would
 * silently change the ranking.
 *
 * @param {Array<object>} fullIndex — the array the prebuilt was built from
 * @param {Array<object>} subset — the array rankSkills will actually score
 * @param {object} [prebuilt] — parsed prebuilt file (or null)
 * @returns {object|null} { docs: Array<{skill, tf: Map, len}>, idf: Map, avgDocLen } or null
 */
export function preparePrebuiltFor(fullIndex, subset, prebuilt) {
  if (!prebuilt || prebuilt.version !== PREBUILT_VERSION) return null;
  if (!Array.isArray(prebuilt.docs) || prebuilt.docs.length !== fullIndex.length) return null;
  if (typeof prebuilt.fingerprint !== 'string' || computeIndexFingerprint(fullIndex) !== prebuilt.fingerprint) return null;
  const active = getDefaults().bm25;
  const stamps = prebuilt.fieldWeights ?? {};
  if (
    stamps.name !== resolveFieldWeight(active.nameWeight) ||
    stamps.description !== resolveFieldWeight(active.descriptionWeight) ||
    stamps.keywords !== resolveFieldWeight(active.keywordWeight)
  ) {
    return null;
  }

  // Map full-array positions to prebuilt docs by name (names are unique:
  // the builders resolve collisions before writing the index).
  const docByName = new Map();
  fullIndex.forEach((entry, i) => {
    if (!docByName.has(entry.name)) docByName.set(entry.name, i);
  });

  const docs = [];
  for (const entry of subset) {
    const i = docByName.get(entry.name);
    if (i === undefined) return null; // subset entry missing from prebuilt: stale
    const tfMap = new Map(prebuilt.docs[i].tf);
    docs.push({ skill: entry, tf: tfMap, len: prebuilt.docs[i].len });
  }

  // Recompute df/IDF over the subset (same formula as src/scorer.mjs).
  const N = docs.length;
  const df = new Map();
  for (const d of docs) {
    for (const [term] of d.tf) df.set(term, (df.get(term) || 0) + 1);
  }
  const idf = new Map();
  for (const [term, docFreq] of df) {
    idf.set(term, Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1));
  }
  const avgDocLen =
    N > 0 ? docs.reduce((s, d) => s + d.len, 0) / N : 1;

  return { docs, idf, avgDocLen };
}
