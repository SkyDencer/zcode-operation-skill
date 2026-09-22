/**
 * Embeddings engine tests.
 *
 * Verifies:
 * - FNV-1a hash consistency
 * - Embedding dimensionality and normalization
 * - Cosine similarity symmetry and bounds
 * - Semantic similarity (react hooks closer to react components than laravel eloquent)
 * - Build performance (< 50ms for 10 skills)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  fnv1a,
  embed,
  cosineSimilarity,
  buildEmbeddingIndex,
} from '../src/core/embeddings/engine.mjs';

const BASE = resolve('.');
const INDEX_PATH = resolve(BASE, 'data/skill-index.json');
const index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));

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

// ─── Test suite ──────────────────────────────────────────────────────────────

console.log('\n=== Embeddings Engine Tests ===\n');

// 1. FNV-1a determinism
console.log('1. FNV-1a hash determinism');
assert(fnv1a('test') === fnv1a('test'), 'same input → same hash');
assert(fnv1a('abc') !== fnv1a('def'), 'different input → different hash');

// 2. Embedding dimensionality
console.log('\n2. Embedding dimensionality');
const vec = embed('hello world');
assert(vec instanceof Float32Array, 'returns Float32Array');
assert(vec.length === 256, 'length is 256');
assert(!isNaN(vec[0]), 'first element is a number');

// 3. Unit vector normalization
console.log('\n3. Unit vector normalization');
const mag = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
assert(Math.abs(mag - 1.0) < 1e-6, 'vector is normalized to unit length');

// 4. Empty string
console.log('\n4. Empty string handling');
const emptyVec = embed('');
const emptyMag = Math.sqrt(emptyVec.reduce((sum, v) => sum + v * v, 0));
assert(emptyMag === 0, 'empty string produces zero vector');

// 5. Cosine similarity symmetry
console.log('\n5. Cosine similarity symmetry');
const v1 = embed('react hooks');
const v2 = embed('react components');
const v3 = embed('laravel eloquent');
assert(
  Math.abs(cosineSimilarity(v1, v2) - cosineSimilarity(v2, v1)) < 1e-6,
  'cosineSimilarity is symmetric'
);

// 6. Cosine similarity bounded [0, 1]
console.log('\n6. Cosine similarity bounded [0, 1]');
for (let i = 0; i < 100; i++) {
  const a = embed(`random text ${i}`);
  const b = embed(`another random text ${i * 7}`);
  const sim = cosineSimilarity(a, b);
  if (sim < 0 || sim > 1) {
    assert(false, `cosineSimilarity bounded [0,1] — got ${sim}`);
    break;
  }
  if (i === 99) assert(true, 'cosineSimilarity bounded [0, 1] for 100 random pairs');
}

// 7. Self-similarity
console.log('\n7. Self-similarity');
assert(
  Math.abs(cosineSimilarity(v1, v1) - 1.0) < 1e-6,
  'cosineSimilarity of vector with itself is 1'
);

// 8. Semantic relatedness
console.log('\n8. Semantic relatedness');
const simReactHooks_ReactComponents = cosineSimilarity(
  embed('react hooks'),
  embed('react components')
);
const simReactHooks_LaravelEloquent = cosineSimilarity(
  embed('react hooks'),
  embed('laravel eloquent')
);
assert(
  simReactHooks_ReactComponents > simReactHooks_LaravelEloquent,
  '"react hooks" is closer to "react components" than to "laravel eloquent"'
);
console.log(
  `    react hooks ↔ react components: ${simReactHooks_ReactComponents.toFixed(4)}`
);
console.log(
  `    react hooks ↔ laravel eloquent: ${simReactHooks_LaravelEloquent.toFixed(4)}`
);

// 9. buildEmbeddingIndex returns Map
console.log('\n9. buildEmbeddingIndex');
const embIndex = buildEmbeddingIndex(index);
assert(embIndex instanceof Map, 'returns a Map');
assert(embIndex.size === index.length, 'Map size equals number of skills');
for (const skill of index) {
  const skillVec = embIndex.get(skill.name);
  assert(skillVec instanceof Float32Array, `skill "${skill.name}" has embedding`);
}

// 10. Build performance
console.log('\n10. Build performance');
const smallSkills = index.slice(0, 10);
const startTime = performance.now();
buildEmbeddingIndex(smallSkills);
const elapsed = performance.now() - startTime;
assert(elapsed < 50, `buildEmbeddingIndex(10 skills) < 50ms (${elapsed.toFixed(2)}ms)`);

// 11. Full corpus build
console.log('\n11. Full corpus build');
const fullStart = performance.now();
const fullIndex = buildEmbeddingIndex(index);
const fullElapsed = performance.now() - fullStart;
assert(fullIndex.size === index.length, `full corpus: ${fullIndex.size} embeddings`);
console.log(`    Full corpus build: ${fullElapsed.toFixed(2)}ms`);

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
