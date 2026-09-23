/**
 * LRU (Least Recently Used) cache with configurable max size.
 *
 * Uses a Map to achieve O(1) get/set/delete operations.
 * The most recently accessed item is always at the end.
 *
 * Usage:
 *   const cache = new LRUCache({ maxSize: 100 });
 *   cache.set('key', 'value');
 *   const value = cache.get('key');       // returns 'value', promotes to recent
 *   cache.delete('key');
 *   cache.clear();
 *   const size = cache.size;              // number of entries
 */

export class LRUCache {
  /**
   * @param {object} options
   * @param {number} [options.maxSize=128] — maximum number of entries
   */
  constructor({ maxSize = 128 } = {}) {
    if (!Number.isInteger(maxSize) || maxSize < 1) {
      throw new Error(`LRUCache: maxSize must be a positive integer, got ${maxSize}`);
    }
    this._maxSize = maxSize;
    /** @type {Map<string, any>} */
    this._map = new Map();
  }

  /**
   * Get a value by key. Moves the entry to the end (most recent).
   * Returns undefined if not found.
   *
   * @param {string} key
   * @returns {any}
   */
  get(key) {
    if (!this._map.has(key)) return undefined;
    // Move to end (most recent)
    const value = this._map.get(key);
    this._map.delete(key);
    this._map.set(key, value);
    return value;
  }

  /**
   * Set a value by key. If key already exists, updates and marks as most recent.
   * If at capacity, evicts the least recently used entry first.
   *
   * @param {string} key
   * @param {any} value
   */
  set(key, value) {
    // If key already exists, delete first so we can re-insert at end
    if (this._map.has(key)) {
      this._map.delete(key);
    } else if (this._map.size >= this._maxSize) {
      // Evict least recently used (first entry in Map)
      const firstKey = this._map.keys().next().value;
      this._map.delete(firstKey);
    }
    this._map.set(key, value);
  }

  /**
   * Delete a key from the cache.
   *
   * @param {string} key
   * @returns {boolean} true if the key was present
   */
  delete(key) {
    return this._map.delete(key);
  }

  /**
   * Number of entries currently in the cache.
   *
   * @returns {number}
   */
  get size() {
    return this._map.size;
  }

  /**
   * Whether the cache contains the given key.
   *
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this._map.has(key);
  }

  /**
   * Remove all entries from the cache.
   */
  clear() {
    this._map.clear();
  }

  /**
   * Return an iterator over [key, value] pairs in LRU order (oldest first).
   *
   * @returns {IterableIterator<[string, any]>}
   */
  *[Symbol.iterator]() {
    yield* this._map;
  }
}
