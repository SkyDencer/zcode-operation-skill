/**
 * corpus-sampler.mjs — Stratified corpus sampler for scale benchmarks.
 *
 * Provides `sampleCorpus(skills, size, seed)` which returns a deterministic
 * subset of the supplied skill index. The selection is stratified by primary
 * domain so that every stratum contributes proportionally — an unstratified
 * draw would let the 198 unmarked skills swamp the 54 domain-tagged ones at
 * every scale point, making the small-N rows meaningless.
 *
 * The PRNG is Mulberry32; no call to `Math.random()` is ever made, so the
 * same `(skills, size, seed)` trio always yields the same subset.
 *
 * Exported: `sampleCorpus(skills, size, seed = 42) -> Array<skill>`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Mulberry32 PRNG — no Math.random, fully deterministic ─────────────────────
/**
 * Create a Mulberry32 PRNG seeded with `seed`.
 *
 * @param {number} seed — integer seed
 * @returns {() => number} next value in [0, 1)
 */
function createRng(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Stratum helpers ────────────────────────────────────────────────────────────
/**
 * Return the primary-domain stratum key for a skill.
 *
 * Unmarked skills (no domains at all) fall into the `'__none__'` stratum so
 * they are sampled as one group rather than being scattered across individual
 * empty lists.
 *
 * @param {{domains?: string[]}} skill
 * @returns {string}
 */
function stratumKey(skill) {
  const domains = Array.isArray(skill.domains) ? skill.domains : [];
  return domains.length > 0 ? domains[0] : '__none__';
}

/**
 * Partition `skills` into strata keyed by primary domain.
 *
 * @param {Array<object>} skills
 * @returns {Map<string, Array<object>>}
 */
function buildStrata(skills) {
  const strata = new Map();
  for (const skill of skills) {
    const key = stratumKey(skill);
    const bucket = strata.get(key) || [];
    bucket.push(skill);
    strata.set(key, bucket);
  }
  // Sort each bucket by name for determinism before any RNG shuffle
  for (const bucket of strata.values()) {
    bucket.sort((a, b) => a.name.localeCompare(b.name));
  }
  return strata;
}

// ── Reservoir-style stratified sample ─────────────────────────────────────────
/**
 * Fisher-Yates shuffle in place, driven by the supplied PRNG.
 *
 * @template T
 * @param {T[]} arr
 * @param {() => number} rng
 */
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Stratified sample: guarantee at least one member of every stratum, then
 * fill the remainder proportionally.
 *
 * @param {Array<object>} skills
 * @param {number} size — desired subset size
 * @param {number} seed
 * @returns {Array<object>}
 */
export function sampleCorpus(skills, size, seed = 42) {
  const rng = createRng(seed);
  const strata = buildStrata(skills);
  const keys = [...strata.keys()].sort(); // deterministic key order
  const total = skills.length;

  // Guard: size cannot exceed the corpus
  const target = Math.min(size, total);

  // Minimum one from each non-empty stratum, capped at stratum size
  const floor = keys.map((k) => Math.min(1, strata.get(k).length));
  const floorTotal = floor.reduce((a, b) => a + b, 0);

  // Proportional share of the remaining slots
  const remaining = target - floorTotal;
  /** @type {number[]} */
  const shares = keys.map((k) => strata.get(k).length);
  const shareTotal = shares.reduce((a, b) => a + b, 0);

  /** @type {number[]} */
  let allocations;
  if (shareTotal === 0 || remaining === 0) {
    allocations = keys.map(() => 0);
  } else {
    allocations = keys.map((k, i) =>
      Math.max(0, Math.round((shares[i] / shareTotal) * remaining))
    );
    // Fix rounding drift: adjust the largest stratum to hit the target exactly
    const allocTotal = allocations.reduce((a, b) => a + b, 0);
    const drift = remaining - allocTotal;
    if (drift !== 0) {
      const largestIdx = allocations.indexOf(Math.max(... allocations));
      allocations[largestIdx] += drift;
    }
  }

  // Draw samples
  /** @type {Array<object>} */
  const result = [];
  for (const key of keys) {
    const bucket = strata.get(key);
    const draw = floor[key === keys[0] ? 0 : keys.indexOf(key)] + allocations[keys.indexOf(key)];
    // Simplified: use pre-computed floor
    const f = floor[keys.indexOf(key)];
    const a = allocations[keys.indexOf(key)];
    const totalDraw = f + a;
    shuffle(bucket, rng);
    result.push(...bucket.slice(0, totalDraw));
  }

  // Final shuffle of the combined result for uniformity within strata
  shuffle(result, rng);
  return result.slice(0, target);
}

// ── CLI entry (smoke test) ────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const indexPath = resolve('data/skill-index.json');
  const skills = JSON.parse(readFileSync(indexPath, 'utf-8'));
  const leaves = skills.filter((s) => !s.name.startsWith('router-'));
  const sizes = [54, 200, 500, 1000];
  for (const n of sizes) {
    const sample = sampleCorpus(leaves, n, 42);
    const strata = buildStrata(sample);
    const summary = [...strata.entries()]
      .map(([k, v]) => `${k}=${v.length}`)
      .join(', ');
    console.log(`N=${n}  actual=${sample.length}  ${summary}`);
  }
}
