/**
 * Query cache for the Skill Router.
 *
 * Caches full route plans keyed by (hash(normalizedQuery) + indexVersion).
 * Entries have a 5-minute TTL and are auto-evicted on capacity expiry or TTL timeout.
 *
 * Key construction:
 *   cacheKey = `${indexVersion}:${sha256(normalize(query))}`
 *
 * The indexVersion is derived from a fingerprint of the skill index array,
 * ensuring cache invalidation when the index changes.
 *
 * Usage:
 *   const cache = new QueryCache({ index });
 *   const plan = await cache.getOrSet(query, async () => computePlan(query, index));
 */
import { LRUCache } from './lru.mjs';
import { normalizeText } from '../../utils/text.mjs';

// SHA-256 using Web Crypto API (available in Node >= 15)
async function sha256hex(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compute a short fingerprint of the index for cache key versioning.
 *
 * Uses FNV-1a 64-bit hash of sorted skill names for deterministic, fast
 * collision resistance without async overhead.
 *
 * @param {Array<object>} index — the skill index array
 * @returns {string} hex fingerprint (16 hex chars)
 */
export function computeIndexFingerprint(index) {
  const names = [...index].map((s) => s.name).sort().join(',');
  // FNV-1a 64-bit
  let hash = 14695981039346656031n;
  const offset = 1099511628211n;
  for (let i = 0; i < names.length; i++) {
    hash ^= BigInt(names.charCodeAt(i));
    hash = (hash * offset) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0').slice(0, 16);
}

/**
 * Cache entry shape.
 *
 * @typedef {object} CacheEntry
 * @property {any} value — the cached route plan
 * @property {number} expiresAt — timestamp (ms) when the entry expires
 */

export class QueryCache {
  /**
   * @param {object} options
   * @param {Array<object>} options.index — the skill index (used to compute fingerprint)
   * @param {number} [options.maxSize=64] — max cache entries
   * @param {number} [options.ttlMs=300000] — TTL per entry in milliseconds (default 5 min)
   */
  constructor({ index, maxSize = 64, ttlMs = 300000 } = {}) {
    if (!Array.isArray(index)) {
      throw new Error('QueryCache: index must be an array');
    }
    this._index = index;
    this._ttlMs = ttlMs;
    this._fingerprint = computeIndexFingerprint(index);
    this._store = new LRUCache({ maxSize });
    /** @type {Map<string, number>} key → expiresAt timestamp */
    this._expires = new Map();
    this._stats = { hits: 0, misses: 0 };
  }

  /**
   * The fingerprint of the index this cache was built with.
   * Call rebuild() if the index changes.
   *
   * @returns {string}
   */
  get indexVersion() {
    return this._fingerprint;
  }

  /**
   * Build a cache key from a query string and the current index version.
   *
   * @param {string} query
   * @returns {string}
   */
  _key(query) {
    const normalized = normalizeText(query);
    return `${this._fingerprint}:${normalized}`;
  }

  /**
   * Get a cached route plan, or undefined if miss/expired.
   *
   * @param {string} query
   * @returns {any|null} cached value or null
   */
  get(query) {
    const key = this._key(query);
    const expiresAt = this._expires.get(key);
    if (expiresAt === undefined) return null;
    if (Date.now() > expiresAt) {
      // TTL expired — evict
      this._store.delete(key);
      this._expires.delete(key);
      return null;
    }
    const value = this._store.get(key);
    return value !== undefined ? value : null;
  }

  /**
   * Set a cached route plan with TTL.
   *
   * @param {string} query
   * @param {any} value
   */
  set(query, value) {
    const key = this._key(query);
    this._store.set(key, value);
    this._expires.set(key, Date.now() + this._ttlMs);
  }

  /**
   * Delete a specific entry from the cache.
   *
   * @param {string} query
   * @returns {boolean} true if the key was present
   */
  delete(query) {
    const key = this._key(query);
    this._expires.delete(key);
    return this._store.delete(key);
  }

  /**
   * Number of entries currently in the cache (including expired ones not yet evicted).
   *
   * @returns {number}
   */
  get size() {
    return this._store.size;
  }

  /**
   * Remove all entries from the cache.
   */
  clear() {
    this._store.clear();
    this._expires.clear();
  }

  /**
   * Rebuild the cache fingerprint if the index has changed.
   * Call this after index rebuilds to invalidate all cached entries.
   */
  rebuild() {
    this._fingerprint = computeIndexFingerprint(this._index);
    this.clear();
  }

  /**
   * Get a cached plan or compute it via the provided factory function.
   * The result is stored in the cache before being returned.
   *
   * @param {string} query
   * @param {Function} factory — async function(query, index) → plan
   * @returns {Promise<any>} the route plan
   */
  async getOrSet(query, factory) {
    const cached = this.get(query);
    if (cached !== null) {
      return cached;
    }
    const value = await factory(query, this._index);
    this.set(query, value);
    return value;
  }

  /**
   * Statistics about cache hits and misses.
   *
   * @returns {{hits:number, misses:number, total:number, hitRate:number}}
   */
  getStats() {
    const total = this._stats.hits + this._stats.misses;
    return {
      ...this._stats,
      total,
      hitRate: total > 0 ? this._stats.hits / total : 0,
    };
  }

  /**
   * Reset hit/miss counters.
   */
  resetStats() {
    this._stats = { hits: 0, misses: 0 };
  }
}

// Patch getOrSet to track stats (done at module load)
const _origGetOrSet = QueryCache.prototype.getOrSet;
QueryCache.prototype.getOrSet = async function (query, factory) {
  const cached = this.get(query);
  if (cached !== null) {
    this._stats.hits++;
    return cached;
  }
  this._stats.misses++;
  const value = await factory(query, this._index);
  this.set(query, value);
  return value;
};
