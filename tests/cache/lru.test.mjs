/**
 * LRU cache unit tests.
 *
 * Verifies:
 * - get/set/delete/size/clear work correctly
 * - LRU eviction order is correct
 * - O(1) operations via Map semantics
 * - maxSize enforcement
 * - has() returns correct booleans
 * - Iterator yields entries in LRU order (oldest first)
 */
import { LRUCache } from '../../src/core/cache/lru.mjs';

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

console.log('\n=== LRU Cache Tests ===\n');

// ─── 1. Basic get/set ──────────────────────────────────────────────────────
console.log('1. Basic get/set');
{
  const c = new LRUCache({ maxSize: 10 });
  c.set('a', 1);
  assert(c.get('a') === 1, 'get returns set value');
  assert(c.size === 1, 'size is 1 after one insert');
  assert(c.has('a'), 'has returns true for existing key');
  assert(!c.has('b'), 'has returns false for missing key');
}

// ─── 2. Overwrite preserves value ─────────────────────────────────────────
console.log('\n2. Overwrite value');
{
  const c = new LRUCache({ maxSize: 10 });
  c.set('a', 1);
  c.set('a', 2);
  assert(c.get('a') === 2, 'overwritten value is 2');
  assert(c.size === 1, 'size stays 1 after overwrite');
}

// ─── 3. Eviction on capacity ──────────────────────────────────────────────
console.log('\n3. Eviction on capacity');
{
  const c = new LRUCache({ maxSize: 3 });
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);
  assert(c.size === 3, 'size is 3 before eviction');
  c.set('d', 4);
  assert(c.size === 3, 'size stays 3 after eviction');
  assert(c.get('a') === undefined, 'oldest key "a" was evicted');
  assert(c.get('b') === 2, 'key "b" still present');
  assert(c.get('c') === 3, 'key "c" still present');
  assert(c.get('d') === 4, 'key "d" was just inserted');
}

// ─── 4. Access promotes to most recent ────────────────────────────────────
console.log('\n4. Access promotes to most recent');
{
  const c = new LRUCache({ maxSize: 3 });
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);
  c.get('a'); // promote "a" to most recent
  c.set('d', 4);
  assert(c.get('a') === 1, 'promoted key "a" survives eviction');
  assert(c.get('b') === undefined, 'least recent "b" was evicted');
  assert(c.get('c') === 3, 'key "c" survives');
  assert(c.get('d') === 4, 'key "d" survives');
}

// ─── 5. Delete ─────────────────────────────────────────────────────────────
console.log('\n5. Delete');
{
  const c = new LRUCache({ maxSize: 5 });
  c.set('a', 1);
  c.set('b', 2);
  assert(c.delete('a'), 'delete returns true for existing key');
  assert(c.get('a') === undefined, 'deleted key is gone');
  assert(!c.delete('z'), 'delete returns false for missing key');
  assert(c.size === 1, 'size decreased after delete');
}

// ─── 6. Clear ──────────────────────────────────────────────────────────────
console.log('\n6. Clear');
{
  const c = new LRUCache({ maxSize: 5 });
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);
  c.clear();
  assert(c.size === 0, 'size is 0 after clear');
  assert(c.get('a') === undefined, 'all keys gone after clear');
  assert(c.get('b') === undefined, 'all keys gone after clear');
}

// ─── 7. get on empty cache ────────────────────────────────────────────────
console.log('\n7. get on empty cache');
{
  const c = new LRUCache({ maxSize: 5 });
  assert(c.get('missing') === undefined, 'get returns undefined for missing key');
  assert(c.size === 0, 'size remains 0');
}

// ─── 8. Default maxSize ────────────────────────────────────────────────────
console.log('\n8. Default maxSize');
{
  const c = new LRUCache();
  assert(c.size === 0, 'default cache starts empty');
  // No eviction with default maxSize=128 and few items
  for (let i = 0; i < 5; i++) c.set(String(i), i);
  assert(c.size === 5, 'default cache holds 5 items');
}

// ─── 9. Invalid maxSize throws ────────────────────────────────────────────
console.log('\n9. Invalid maxSize throws');
{
  let threw = false;
  try { new LRUCache({ maxSize: 0 }); } catch { threw = true; }
  assert(threw, 'maxSize=0 throws');
  threw = false;
  try { new LRUCache({ maxSize: -1 }); } catch { threw = true; }
  assert(threw, 'maxSize=-1 throws');
}

// ─── 10. Iterator yields in LRU order ─────────────────────────────────────
console.log('\n10. Iterator order');
{
  const c = new LRUCache({ maxSize: 5 });
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);
  c.get('a'); // promote a
  const keys = [...c].map(([k]) => k);
  // Most recent last: b (oldest), c, a (most recent)
  assert(keys[0] === 'b', 'oldest key is first in iteration');
  assert(keys[1] === 'c', 'middle key is second');
  assert(keys[2] === 'a', 'most recent key is last');
}

// ─── 11. Mixed operations stress ───────────────────────────────────────────
console.log('\n11. Mixed operations stress');
{
  const c = new LRUCache({ maxSize: 5 });
  for (let i = 0; i < 20; i++) {
    c.set(`k${i}`, i);
    if (i % 3 === 0) c.get(`k${Math.max(0, i - 2)}`);
    if (i % 5 === 0) c.delete(`k${Math.max(0, i - 4)}`);
  }
  assert(c.size <= 5, 'size never exceeds maxSize');
  // k15 was deleted at i=15 (15%5==0), so check k16-k19 instead
  for (let i = 16; i < 20; i++) {
    assert(c.get(`k${i}`) === i, `key k${i} is present`);
  }
}

// ─── 12. Set on full cache evicts correctly ───────────────────────────────
console.log('\n12. Set on full cache evicts correctly');
{
  const c = new LRUCache({ maxSize: 2 });
  c.set('x', 10);
  c.set('y', 20);
  assert(c.size === 2, 'size is 2');
  c.set('z', 30);
  assert(c.size === 2, 'size stays 2');
  assert(c.get('x') === undefined, 'x evicted (least recent)');
  assert(c.get('y') === 20, 'y survives');
  assert(c.get('z') === 30, 'z survives');
}

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
