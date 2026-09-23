/**
 * Tests for src/routing/selector.mjs
 *
 * Verifies router selection at corpus sizes: 10, 50, 100, 200, 500, 1000
 */
import { strict as assert } from 'node:assert';
import { selectRouter } from '../../src/routing/selector.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

function eq(actual, expected, msg) {
  assert.strictEqual(actual, expected, msg ?? `expected ${expected}, got ${actual}`);
}

console.log('\n=== Router Selector Tests ===\n');

// ── Default behavior: flat at every corpus size ──────────────────────────────
test('corpusSize=10 → flat', () => eq(selectRouter(10), 'flat'));
test('corpusSize=50 → flat', () => eq(selectRouter(50), 'flat'));
test('corpusSize=100 → flat', () => eq(selectRouter(100), 'flat'));
test('corpusSize=200 → flat', () => eq(selectRouter(200), 'flat'));
test('corpusSize=500 → flat', () => eq(selectRouter(500), 'flat'));
test('corpusSize=1000 → flat', () => eq(selectRouter(1000), 'flat'));

// ── Explicit mode override ───────────────────────────────────────────────────
test('mode=flat overrides corpus size', () =>
  eq(selectRouter(1000, { mode: 'flat' }), 'flat'));
test('mode=hierarchical overrides corpus size', () =>
  eq(selectRouter(10, { mode: 'hierarchical' }), 'hierarchical'));

// ── Experimental flag ────────────────────────────────────────────────────────
test('experimental=true → hierarchical even at small corpus', () =>
  eq(selectRouter(10, { experimental: true }), 'hierarchical'));
test('experimental=true → hierarchical even at large corpus', () =>
  eq(selectRouter(1000, { experimental: true }), 'hierarchical'));

// ── experimental + mode interaction ──────────────────────────────────────────
test('experimental=true with mode=flat → flat', () =>
  eq(selectRouter(100, { experimental: true, mode: 'flat' }), 'flat'));
test('experimental=false with mode=hierarchical → hierarchical', () =>
  eq(selectRouter(100, { experimental: false, mode: 'hierarchical' }), 'hierarchical'));

// ── Edge cases ───────────────────────────────────────────────────────────────
test('corpusSize=0 → flat', () => eq(selectRouter(0), 'flat'));
test('corpusSize=1 → flat', () => eq(selectRouter(1), 'flat'));
test('corpusSize=10000 → flat', () => eq(selectRouter(10000), 'flat'));

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\nResults`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}\n`);

if (failed > 0) {
  process.exit(1);
}
