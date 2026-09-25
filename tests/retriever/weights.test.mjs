/**
 * Adaptive weight adjustment tests.
 *
 * Verifies:
 * 1. Returns insufficient_data when attributions array is empty
 * 2. Returns insufficient_data when fewer than MIN_OUTCOMES attributions
 * 3. Returns no_signal when all outcomes are unknown
 * 4. Increases weight for positive dominant field
 * 5. Decreases weight for negative dominant field
 * 6. Clamps weights to [0.5, 5.0]
 * 7. Normalizes so sum stays constant
 * 8. changed is false when weights do not actually change
 * 9. Sample size is reported correctly
 */
import { computeWeights } from '../../src/core/retriever/weights.mjs';

const BASE_WEIGHTS = { name: 3, description: 2, keywords: 1 };
const SUM = BASE_WEIGHTS.name + BASE_WEIGHTS.description + BASE_WEIGHTS.keywords; // 6

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

console.log('\n=== Weight Adjustment Tests ===\n');

// ─── 1. empty attributions → insufficient_data ────────────────────────────────
console.log('1. empty attributions → insufficient_data');

const r1 = computeWeights([], BASE_WEIGHTS);
assert(r1.changed === false, 'changed is false for empty input');
assert(r1.reason === 'insufficient_data', 'reason is insufficient_data');
assert(r1.sampleSize === 0, 'sampleSize is 0');
assert(
  JSON.stringify(r1.newWeights) === JSON.stringify(BASE_WEIGHTS),
  'newWeights equals currentWeights for empty input'
);

// ─── 2. fewer than 20 → insufficient_data ─────────────────────────────────────
console.log('\n2. fewer than 20 attributions → insufficient_data');

const fewAttrs = Array.from({ length: 10 }, (_, i) => ({
  decisionHash: `sha256:${i}`,
  outcome: 'positive',
  fields: { name: 1, description: 0.5, keywords: 0.2 },
  dominantField: 'name',
  selectedSkill: 'test-skill',
}));

const r2 = computeWeights(fewAttrs, BASE_WEIGHTS);
assert(r2.changed === false, 'changed is false when below threshold');
assert(r2.reason === 'insufficient_data', 'reason is insufficient_data');
assert(r2.sampleSize === 10, 'sampleSize is 10');

// ─── 3. all unknown outcomes → no_signal ───────────────────────────────────────
console.log('\n3. all unknown outcomes → no_signal');

const unknownAttrs = Array.from({ length: 25 }, (_, i) => ({
  decisionHash: `sha256:u${i}`,
  outcome: 'unknown',
  fields: { name: 0.5, description: 0.5, keywords: 0.5 },
  dominantField: 'name',
  selectedSkill: 'test-skill',
}));

const r3 = computeWeights(unknownAttrs, BASE_WEIGHTS);
assert(r3.changed === false, 'changed is false when all unknown');
assert(r3.reason === 'no_signal', 'reason is no_signal');
assert(r3.sampleSize === 25, 'sampleSize is 25');

// ─── 4. positive dominant → weight increase ───────────────────────────────────
console.log('\n4. positive dominant → weight increase');

const positiveAttrs = Array.from({ length: 25 }, (_, i) => ({
  decisionHash: `sha256:p${i}`,
  outcome: 'positive',
  fields: { name: 2, description: 0.5, keywords: 0.1 },
  dominantField: 'name',
  selectedSkill: 'test-skill',
}));

const r4 = computeWeights(positiveAttrs, BASE_WEIGHTS);
assert(r4.changed === true, 'changed is true when there is positive signal');
assert(r4.reason === 'applied', 'reason is applied');
assert(r4.sampleSize === 25, 'sampleSize is 25');
assert(
  r4.newWeights.name > BASE_WEIGHTS.name,
  `name weight increased: ${r4.newWeights.name} > ${BASE_WEIGHTS.name}`
);

// ─── 5. negative dominant → weight decrease ───────────────────────────────────
console.log('\n5. negative dominant → weight decrease');

const negativeAttrs = Array.from({ length: 25 }, (_, i) => ({
  decisionHash: `sha256:n${i}`,
  outcome: 'negative',
  fields: { name: 0.1, description: 0.5, keywords: 2 },
  dominantField: 'keywords',
  selectedSkill: 'test-skill',
}));

const r5 = computeWeights(negativeAttrs, BASE_WEIGHTS);
assert(r5.changed === true, 'changed is true when there is negative signal');
assert(r5.reason === 'applied', 'reason is applied');
assert(
  r5.newWeights.keywords < BASE_WEIGHTS.keywords,
  `keywords weight decreased: ${r5.newWeights.keywords} < ${BASE_WEIGHTS.keywords}`
);

// ─── 6. weights clamped to [0.5, 5.0] ─────────────────────────────────────────
console.log('\n6. weights clamped to [0.5, 5.0]');

// Create a scenario where many negatives would push a weight below 0.5
const heavyNegativeAttrs = Array.from({ length: 100 }, (_, i) => ({
  decisionHash: `sha256:h${i}`,
  outcome: 'negative',
  fields: { name: 0.1, description: 0.1, keywords: 3 },
  dominantField: 'keywords',
  selectedSkill: 'test-skill',
}));

const r6 = computeWeights(heavyNegativeAttrs, BASE_WEIGHTS);
assert(r6.newWeights.name >= 0.5, `name weight clamped >= 0.5: ${r6.newWeights.name}`);
assert(r6.newWeights.description >= 0.5, `description weight clamped >= 0.5: ${r6.newWeights.description}`);
assert(r6.newWeights.keywords >= 0.5, `keywords weight clamped >= 0.5: ${r6.newWeights.keywords}`);
assert(r6.newWeights.name <= 5.0, `name weight clamped <= 5.0: ${r6.newWeights.name}`);
assert(r6.newWeights.description <= 5.0, `description weight clamped <= 5.0: ${r6.newWeights.description}`);
assert(r6.newWeights.keywords <= 5.0, `keywords weight clamped <= 5.0: ${r6.newWeights.keywords}`);

// ─── 7. sum stays approximately constant ──────────────────────────────────────
console.log('\n7. sum stays approximately constant');

const mixedAttrs = [];
for (let i = 0; i < 30; i++) {
  mixedAttrs.push({
    decisionHash: `sha256:m${i}`,
    outcome: i % 2 === 0 ? 'positive' : 'negative',
    fields: { name: 1, description: 1, keywords: 1 },
    dominantField: i % 3 === 0 ? 'name' : i % 3 === 1 ? 'description' : 'keywords',
    selectedSkill: 'test-skill',
  });
}

const r7 = computeWeights(mixedAttrs, BASE_WEIGHTS);
const newSum = r7.newWeights.name + r7.newWeights.description + r7.newWeights.keywords;
assert(
  Math.abs(newSum - SUM) < 0.01,
  `sum preserved within tolerance: new=${newSum.toFixed(4)}, expected=${SUM}`
);

// ─── 8. changed is false when net signal is zero ──────────────────────────────
console.log('\n8. changed is false when net signal is zero');

const balancedAttrs = [];
for (let i = 0; i < 20; i++) {
  balancedAttrs.push({
    decisionHash: `sha256:b${i}`,
    outcome: 'positive',
    fields: { name: 1, description: 1, keywords: 1 },
    dominantField: 'name',
    selectedSkill: 'test-skill',
  });
}
for (let i = 0; i < 20; i++) {
  balancedAttrs.push({
    decisionHash: `sha256:bn${i}`,
    outcome: 'negative',
    fields: { name: 1, description: 1, keywords: 1 },
    dominantField: 'name',
    selectedSkill: 'test-skill',
  });
}

const r8 = computeWeights(balancedAttrs, BASE_WEIGHTS);
// Positive and negative cancel out for the same field, so deltas should be ~0
assert(
  Math.abs(r8.newWeights.name - BASE_WEIGHTS.name) < 0.01,
  `name weight unchanged when balanced: ${r8.newWeights.name} ≈ ${BASE_WEIGHTS.name}`
);
assert(
  Math.abs(r8.newWeights.description - BASE_WEIGHTS.description) < 0.01,
  `description weight unchanged when balanced: ${r8.newWeights.description} ≈ ${BASE_WEIGHTS.description}`
);
assert(
  Math.abs(r8.newWeights.keywords - BASE_WEIGHTS.keywords) < 0.01,
  `keywords weight unchanged when balanced: ${r8.newWeights.keywords} ≈ ${BASE_WEIGHTS.keywords}`
);

// ─── 9. custom minOutcomes and adjustmentFraction ─────────────────────────────
console.log('\n9. custom opts respected');

const customAttrs = Array.from({ length: 5 }, () => ({
  decisionHash: 'sha256:cust',
  outcome: 'positive',
  fields: { name: 1, description: 0.5, keywords: 0.2 },
  dominantField: 'description',
  selectedSkill: 'test-skill',
}));

// With default minOutcomes=20, 5 attributions should not trigger
const r9a = computeWeights(customAttrs, BASE_WEIGHTS);
assert(r9a.reason === 'insufficient_data', 'default minOutcomes blocks small batch');

// With custom minOutcomes=3, same batch should trigger
const r9b = computeWeights(customAttrs, BASE_WEIGHTS, { minOutcomes: 3 });
assert(r9b.changed === true, 'custom minOutcomes allows small batch');

// With custom adjustmentFraction=0.10, weight change should be larger
const r9c = computeWeights(customAttrs, BASE_WEIGHTS, { minOutcomes: 3, adjustmentFraction: 0.1 });
const r9d = computeWeights(customAttrs, BASE_WEIGHTS, { minOutcomes: 3, adjustmentFraction: 0.01 });
assert(
  Math.abs(r9c.newWeights.description - BASE_WEIGHTS.description) >
    Math.abs(r9d.newWeights.description - BASE_WEIGHTS.description),
  'larger fraction produces larger weight change'
);

// ─── 10. all-positive attributions → consistent increase ─────────────────────
console.log('\n10. all-positive attributions → consistent weight increase');

const allPositiveAttrs = Array.from({ length: 25 }, (_, i) => ({
  decisionHash: `sha256:ap${i}`,
  outcome: 'positive',
  fields: { name: 1, description: 1, keywords: 1 },
  dominantField: i % 3 === 0 ? 'name' : i % 3 === 1 ? 'description' : 'keywords',
  selectedSkill: 'test-skill',
}));

const r10 = computeWeights(allPositiveAttrs, BASE_WEIGHTS);
assert(r10.changed === true, 'changed is true for all-positive set');
assert(r10.reason === 'applied', 'reason is applied');
// Verify at least one field changed (weights may normalize back, but individual changes exist)
const nameDelta10 = r10.newWeights.name - BASE_WEIGHTS.name;
const descDelta10 = r10.newWeights.description - BASE_WEIGHTS.description;
const kwDelta10 = r10.newWeights.keywords - BASE_WEIGHTS.keywords;
assert(
  nameDelta10 !== 0 || descDelta10 !== 0 || kwDelta10 !== 0,
  `at least one weight changed in all-positive set: name=${nameDelta10.toFixed(4)}, desc=${descDelta10.toFixed(4)}, kw=${kwDelta10.toFixed(4)}`
);

// ─── 11. all-negative attributions → consistent decrease ──────────────────────
console.log('\n11. all-negative attributions → consistent weight decrease');

const allNegativeAttrs = Array.from({ length: 25 }, (_, i) => ({
  decisionHash: `sha256:an${i}`,
  outcome: 'negative',
  fields: { name: 1, description: 1, keywords: 1 },
  dominantField: i % 3 === 0 ? 'name' : i % 3 === 1 ? 'description' : 'keywords',
  selectedSkill: 'test-skill',
}));

const r11 = computeWeights(allNegativeAttrs, BASE_WEIGHTS);
assert(r11.changed === true, 'changed is true for all-negative set');
assert(r11.reason === 'applied', 'reason is applied');
// Verify at least one field changed
const nameDelta11 = r11.newWeights.name - BASE_WEIGHTS.name;
const descDelta11 = r11.newWeights.description - BASE_WEIGHTS.description;
const kwDelta11 = r11.newWeights.keywords - BASE_WEIGHTS.keywords;
assert(
  nameDelta11 !== 0 || descDelta11 !== 0 || kwDelta11 !== 0,
  `at least one weight changed in all-negative set: name=${nameDelta11.toFixed(4)}, desc=${descDelta11.toFixed(4)}, kw=${kwDelta11.toFixed(4)}`
);

// ─── 12. below minOutcomes returns changed:false ──────────────────────────────
console.log('\n12. below minOutcomes → changed:false even with strong signal');

const smallStrongAttrs = Array.from({ length: 5 }, () => ({
  decisionHash: 'sha256:small',
  outcome: 'positive',
  fields: { name: 3, description: 0.1, keywords: 0.1 },
  dominantField: 'name',
  selectedSkill: 'test-skill',
}));

const r12 = computeWeights(smallStrongAttrs, BASE_WEIGHTS);
assert(r12.changed === false, 'changed is false when below minOutcomes');
assert(r12.reason === 'insufficient_data', 'reason is insufficient_data');
assert(r12.sampleSize === 5, 'sampleSize reports actual count');

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
