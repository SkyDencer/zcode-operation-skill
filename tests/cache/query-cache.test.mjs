/**
 * Query cache unit tests.
 *
 * Verifies:
 * - Cache key construction (index fingerprint + normalized query)
 * - get/set/delete semantics
 * - TTL expiry behavior
 * - Auto-eviction on capacity
 * - getOrSet with factory function
 * - Stats tracking (hits, misses, hit rate)
 * - rebuild() invalidates old entries
 * - clear() empties the cache
 */
import { QueryCache, computeIndexFingerprint } from '../../src/core/cache/query-cache.mjs';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log('  ✓', message);
  } else {
    failed++;
    console.error('  ✗', message);
  }
}

const INDEX_A = [
  { name: 'skill-alpha', description: 'does alpha', keywords: ['alpha'], domains: ['dom'], path: 'p', version: '1' },
  { name: 'skill-beta', description: 'does beta', keywords: ['beta'], domains: ['dom'], path: 'p', version: '1' },
];

const INDEX_B = [
  { name: 'skill-gamma', description: 'does gamma', keywords: ['gamma'], domains: ['dom'], path: 'p', version: '1' },
];

console.log('\n=== Query Cache Tests ===\n');

// ─── 1. Index fingerprint is deterministic ────────────────────────────────
console.log('1. computeIndexFingerprint is deterministic');
{
  const f1 = computeIndexFingerprint(INDEX_A);
  const f2 = computeIndexFingerprint(INDEX_A);
  assert(typeof f1 === 'string', 'fingerprint is a string');
  assert(f1.length > 0, 'fingerprint is non-empty');
  assert(f1 === f2, 'same index produces same fingerprint');
  assert(f1 !== computeIndexFingerprint(INDEX_B), 'different index produces different fingerprint');
}

// ─── 2. Basic get/set ──────────────────────────────────────────────────────
console.log('\n2. Basic get/set');
{
  const c = new QueryCache({ index: INDEX_A, maxSize: 10, ttlMs: 5000 });
  assert(c.get('hello') === null, 'get returns null for uncached query');
  c.set('hello', { plan: 'x' });
  assert(c.get('hello')?.plan === 'x', 'get returns cached value');
  assert(c.size === 1, 'size is 1');
}

// ─── 3. Case-insensitive normalization ─────────────────────────────────────
console.log('\n3. Case-insensitive normalization');
{
  const c = new QueryCache({ index: INDEX_A, maxSize: 10, ttlMs: 5000 });
  c.set('Hello World', { plan: 'first' });
  assert(c.get('hello world')?.plan === 'first', 'normalized match after case change');
  assert(c.get('HELLO WORLD')?.plan === 'first', 'normalized match with all caps');
  assert(c.size === 1, 'size is 1 (normalized to same key)');
}

// ─── 4. Whitespace normalization ───────────────────────────────────────────
console.log('\n4. Whitespace normalization');
{
  const c = new QueryCache({ index: INDEX_A, maxSize: 10, ttlMs: 5000 });
  c.set('build  a  laravel  api', { plan: 'x' });
  assert(c.get('build a laravel api')?.plan === 'x', 'collapsed whitespace matches');
  assert(c.size === 1, 'single entry after whitespace normalization');
}

// ─── 5. TTL expiry ────────────────────────────────────────────────────────
console.log('\n5. TTL expiry');
{
  const c = new QueryCache({ index: INDEX_A, maxSize: 10, ttlMs: 50 });
  c.set('test', { plan: 'ephemeral' });
  assert(c.get('test')?.plan === 'ephemeral', 'value present before TTL');
  await new Promise((r) => setTimeout(r, 60));
  assert(c.get('test') === null, 'value expired after TTL');
  assert(c.size === 0, 'expired entry removed from size');
}

// ─── 6. getOrSet — cache hit ───────────────────────────────────────────────
console.log('\n6. getOrSet — cache hit');
{
  const c = new QueryCache({ index: INDEX_A, maxSize: 10, ttlMs: 5000 });
  const factory = async (q, idx) => ({ query: q, fromFactory: true });
  const r1 = await c.getOrSet('query1', factory);
  assert(r1.fromFactory === true, 'first call goes through factory');
  const r2 = await c.getOrSet('query1', factory);
  assert(r2.fromFactory === true, 'second call returns cached value');
  const stats = c.getStats();
  assert(stats.hits === 1, `stats hits=1 (got ${stats.hits})`);
  assert(stats.misses === 1, `stats misses=1 (got ${stats.misses})`);
}

// ─── 7. getOrSet — cache miss ─────────────────────────────────────────────
console.log('\n7. getOrSet — cache miss');
{
  const c = new QueryCache({ index: INDEX_A, maxSize: 10, ttlMs: 5000 });
  const factory = async (q) => ({ result: q });
  const r = await c.getOrSet('new-query', factory);
  assert(r.result === 'new-query', 'miss calls factory and returns result');
  const stats = c.getStats();
  assert(stats.misses === 1, `stats misses=1 (got ${stats.misses})`);
  assert(stats.hits === 0, `stats hits=0 (got ${stats.hits})`);
}

// ─── 8. Capacity eviction ─────────────────────────────────────────────────
console.log('\n8. Capacity eviction');
{
  const c = new QueryCache({ index: INDEX_A, maxSize: 3, ttlMs: 5000 });
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);
  assert(c.size === 3, 'size is 3');
  c.set('d', 4);
  assert(c.size === 3, 'size stays 3 after overflow');
  assert(c.get('a') === null, 'LRU key "a" evicted');
  assert(c.get('b') !== null, 'key "b" survives');
  assert(c.get('c') !== null, 'key "c" survives');
  assert(c.get('d') === 4, 'key "d" survives');
}

// ─── 9. Access promotes during capacity pressure ──────────────────────────
console.log('\n9. Access promotes during capacity pressure');
{
  const c = new QueryCache({ index: INDEX_A, maxSize: 3, ttlMs: 5000 });
  c.set('x', 1);
  c.set('y', 2);
  c.set('z', 3);
  c.get('x'); // promote x
  c.set('w', 4);
  assert(c.get('x') !== null, 'promoted key "x" survives eviction');
  assert(c.get('y') === null, 'least recent "y" evicted');
}

// ─── 10. Delete ────────────────────────────────────────────────────────────
console.log('\n10. Delete');
{
  const c = new QueryCache({ index: INDEX_A, maxSize: 10, ttlMs: 5000 });
  c.set('del-me', { v: 1 });
  assert(c.delete('del-me'), 'delete returns true');
  assert(c.get('del-me') === null, 'deleted key is null');
  assert(!c.delete('del-me'), 'delete returns false on already-deleted key');
}

// ─── 11. Clear ─────────────────────────────────────────────────────────────
console.log('\n11. Clear');
{
  const c = new QueryCache({ index: INDEX_A, maxSize: 10, ttlMs: 5000 });
  c.set('a', 1);
  c.set('b', 2);
  c.clear();
  assert(c.size === 0, 'size is 0 after clear');
  assert(c.get('a') === null, 'a is null after clear');
  assert(c.get('b') === null, 'b is null after clear');
  // Stats preserved after clear
  const stats = c.getStats();
  assert(stats.hits >= 0, 'stats still accessible after clear');
}

// ─── 12. resetStats ────────────────────────────────────────────────────────
console.log('\n12. resetStats');
{
  const c = new QueryCache({ index: INDEX_A, maxSize: 10, ttlMs: 5000 });
  c.set('q1', 'v1');
  c.get('q1');
  c.get('q1');
  c.resetStats();
  const s = c.getStats();
  assert(s.hits === 0, `hits reset to 0 (got ${s.hits})`);
  assert(s.misses === 0, `misses reset to 0 (got ${s.misses})`);
  assert(s.total === 0, `total reset to 0 (got ${s.total})`);
}

// ─── 13. rebuild invalidates old fingerprint ──────────────────────────────
console.log('\n13. rebuild invalidates old fingerprint');
{
  const c = new QueryCache({ index: INDEX_A, maxSize: 10, ttlMs: 5000 });
  const fpBefore = c.indexVersion;
  c.set('cached-query', { plan: 'old' });
  assert(c.get('cached-query')?.plan === 'old', 'value cached before rebuild');
  // Mutate the index to force a different fingerprint
  INDEX_A.push({ name: 'skill-new', description: 'new', keywords: ['new'], domains: ['dom'], path: 'p', version: '1' });
  c.rebuild();
  assert(c.indexVersion !== fpBefore, 'fingerprint changed after rebuild');
  assert(c.get('cached-query') === null, 'cached value gone after rebuild');
  assert(c.size === 0, 'cache empty after rebuild');
  // Restore original index
  INDEX_A.pop();
}

// ─── 14. indexVersion consistency ──────────────────────────────────────────
console.log('\n14. indexVersion consistency');
{
  const c = new QueryCache({ index: INDEX_A, maxSize: 10, ttlMs: 5000 });
  assert(typeof c.indexVersion === 'string', 'indexVersion is string');
  assert(c.indexVersion.length > 0, 'indexVersion is non-empty');
}

// ─── 15. Large number of entries ───────────────────────────────────────────
console.log('\n15. Large number of entries (stress)');
{
  const c = new QueryCache({ index: INDEX_A, maxSize: 50, ttlMs: 5000 });
  for (let i = 0; i < 100; i++) {
    c.set(`q-${i}`, { score: i });
  }
  assert(c.size === 50, 'size capped at maxSize after 100 inserts');
  // Recent entries should be present
  assert(c.get('q-99')?.score === 99, 'most recent entry present');
  assert(c.get('q-98')?.score === 98, 'second most recent present');
  // Oldest entries should be gone
  assert(c.get('q-0') === null, 'oldest entry evicted');
}

// ─── 16. Empty index throws ────────────────────────────────────────────────
console.log('\n16. Empty index throws');
{
  let threw = false;
  try { new QueryCache({ index: 'not-an-array' }); } catch { threw = true; }
  assert(threw, 'non-array index throws');
}

// ─── 17. getStats with mixed hits/misses ──────────────────────────────────
console.log('\n17. getStats with mixed hits/misses');
{
  const c = new QueryCache({ index: INDEX_A, maxSize: 10, ttlMs: 5000 });
  const factory = async (q) => ({ q });
  await c.getOrSet('h1', factory);
  await c.getOrSet('h1', factory);
  await c.getOrSet('h2', factory);
  await c.getOrSet('h2', factory);
  await c.getOrSet('h3', factory);
  const s = c.getStats();
  assert(s.hits === 2, `hits=2 (got ${s.hits})`);
  assert(s.misses === 3, `misses=3 (got ${s.misses})`);
  assert(s.total === 5, `total=5 (got ${s.total})`);
  assert(Math.abs(s.hitRate - 0.4) < 0.001, `hitRate=0.4 (got ${s.hitRate.toFixed(4)})`);
}

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
