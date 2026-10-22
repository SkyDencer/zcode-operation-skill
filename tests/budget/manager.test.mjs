/**
 * Budget manager tests.
 *
 * Verifies fitWithinBudget (P6-H-002 drop semantics):
 * - Under-budget: returns all skills unmodified
 * - Over-budget: drops whole skills lowest-score-first (no truncation)
 * - Hard limit: selected total is always ≤ maxChars
 * - Reject-all: the top skill alone over the budget ⇒ nothing selected
 * - Empty input returns empty
 *
 * WHY the over-budget assertions changed: the old truncate-to-quota path
 * could return more characters than maxChars (the per-skill floor × count
 * was never checked against the total) and split skills mid-paragraph.
 * P6-H-002 makes the budget a hard limit: skills are either injected whole
 * or dropped, ordered by score.
 */
import { fitWithinBudget, defaultMaxChars } from '../../src/core/budget/manager.mjs';

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

console.log('\n=== Budget Manager Tests (P6-H-002 drop semantics) ===\n');

// 1. Default constants
console.log('1. Default constants');
assert(defaultMaxChars === 24000, 'defaultMaxChars === 24000');

// 2. Empty input
console.log('\n2. Empty input');
const empty = fitWithinBudget([]);
assert(empty.selected.length === 0, 'empty input → empty selected');
assert(empty.totalChars === 0, 'empty input → totalChars 0');
assert(empty.droppedCount === 0, 'empty input → droppedCount 0');
assert(empty.rejected === false, 'empty input → not rejected');

const nullInput = fitWithinBudget(null);
assert(nullInput.selected.length === 0, 'null input → empty selected');
assert(nullInput.rejected === false, 'null input → not rejected');

// 3. All skills under budget
console.log('\n3. Under-budget: all skills retained');
const skills = [
  { name: 'A', content: 'Short content A' },
  { name: 'B', content: 'Short content B' },
  { name: 'C', content: 'Short content C' },
];
const r3 = fitWithinBudget(skills, { maxChars: 10000 });
assert(r3.selected.length === 3, 'all 3 skills retained');
assert(r3.selected[0].content === 'Short content A', 'first skill content unchanged');
assert(r3.selected[2].content === 'Short content C', 'third skill content unchanged');
assert(r3.totalChars === skills.reduce((s, sk) => s + sk.content.length, 0), 'totalChars equals raw sum');
assert(r3.droppedCount === 0, 'no drops under budget');
assert(r3.rejected === false, 'not rejected under budget');
console.log(`    Total chars: ${r3.totalChars}`);

// 4. Over budget: whole skills dropped, never truncated
console.log('\n4. Over budget: lowest skills dropped whole');
const shortParagraphs = [
  { name: 'X', content: 'X'.repeat(100) + '\n\n' + 'Y'.repeat(100) },  // 202 chars
  { name: 'Y', content: 'A'.repeat(100) + '\n\n' + 'B'.repeat(100) },  // 202 chars
  { name: 'Z', content: 'M'.repeat(100) + '\n\n' + 'N'.repeat(100) },  // 202 chars
];
// Total = 606, budget = 600 → over. No scores ⇒ input (rank) order.
// X (202) fits, Y (202) fits (404), Z would make 606 > 600 → dropped.
// P6-H-002: Y is kept WHOLE (old behavior truncated it to 100 chars).
const r4 = fitWithinBudget(shortParagraphs, { maxChars: 600 });
assert(r4.selected.length === 2, '2 of 3 skills kept, lowest dropped');
assert(r4.selected.map((s) => s.name).join(',') === 'X,Y', 'kept in rank order (X, Y)');
assert(r4.selected[0].content.length === 202, 'kept skill is whole, never truncated');
assert(r4.totalChars === 404, `totalChars is ${r4.totalChars} (2 × 202, was 300 under truncation)`);
assert(r4.droppedCount === 1, 'one skill dropped');
assert(r4.rejected === false, 'not rejected (something was selected)');
assert(r4.totalChars <= 600, 'hard limit: total ≤ maxChars');
console.log(`    Total chars after budget: ${r4.totalChars}`);

// 5. Score ordering drives the drop order
console.log('\n5. Higher-scoring skills are kept before lower ones');
const scored = [
  { name: 'low', content: 'l'.repeat(400), score: 0.4 },
  { name: 'high', content: 'h'.repeat(400), score: 0.9 },
  { name: 'mid', content: 'm'.repeat(400), score: 0.7 },
];
// Total 1200, budget 900 → keep high (400) + mid (400) = 800; low dropped.
const r5 = fitWithinBudget(scored, { maxChars: 900 });
assert(r5.selected.map((s) => s.name).join(',') === 'high,mid', 'kept in score order (high, mid)');
assert(r5.droppedCount === 1, 'lowest-score skill dropped');
assert(r5.totalChars === 800, `totalChars is ${r5.totalChars}`);
assert(r5.totalChars <= 900, 'hard limit holds');

// 6. Single skill over the budget → reject-all
console.log('\n6. Top skill alone over budget → rejected');
const solo = [{ name: 'Solo', content: 'S'.repeat(10000) }];
const r6 = fitWithinBudget(solo, { maxChars: 3000 });
assert(r6.selected.length === 0, 'nothing selected (old behavior kept the whole 10000-char skill)');
assert(r6.rejected === true, 'rejected flag set');
assert(r6.droppedCount === 1, 'the sole skill is counted as dropped');
assert(r6.totalChars === 0, 'totalChars is 0 on rejection');
console.log(`    Rejected: ${r6.rejected}`);

// 7. Mixed sizes — under budget, all kept whole
console.log('\n7. Mixed skill sizes under budget');
const mixed = [
  { name: 'Small', content: 'abc\ndef\nghi' },                          // 11 chars
  { name: 'Medium', content: 'M'.repeat(200) + '\n\n' + 'N'.repeat(200) }, // 402 chars
  { name: 'Large', content: 'L'.repeat(200) + '\n\n' + 'O'.repeat(200) },  // 402 chars
];
const r7 = fitWithinBudget(mixed, { maxChars: 3000 });
assert(r7.totalChars === 815, 'total equals raw sum (under budget)');
assert(r7.selected.length === 3, 'all 3 skills still present');
assert(r7.selected[0].content === 'abc\ndef\nghi', 'small skill unchanged');

// 7b. Same mixed but tight budget: first (unscored ⇒ rank order) kept whole
console.log('\n7b. Tight budget: rank-order drop, no truncation');
const mixedTight = [
  { name: 'Small', content: 'abc' },                     // 3 chars
  { name: 'Medium', content: 'M'.repeat(500) },          // 500 chars
  { name: 'Large', content: 'L'.repeat(500) },            // 500 chars
];
// Total 1003, budget 500. Unscored ⇒ input order. Small (3) fits,
// Medium (500 → 503 > 500) does not → Medium and Large both dropped.
// P6-H-002: the old path kept all three whole (1003 > 500, hard limit broken).
const r7b = fitWithinBudget(mixedTight, { maxChars: 500 });
assert(r7b.selected.map((s) => s.name).join(',') === 'Small', 'only the first skill fits and is kept');
assert(r7b.totalChars === 3, `totalChars is ${r7b.totalChars} (was 1003 — over budget!)`);
assert(r7b.droppedCount === 2, 'two skills dropped');
assert(r7b.totalChars <= 500, 'hard limit holds');
console.log(`    Total chars (tight): ${r7b.totalChars}`);

// 8. Boundary: raw total exactly at the budget fits under the budget
console.log('\n8. Boundary: total == maxChars is not over budget');
const boundary = [
  { name: 'A', content: 'a'.repeat(50) },
  { name: 'B', content: 'b'.repeat(50) },
];
const r8 = fitWithinBudget(boundary, { maxChars: 100 });
assert(r8.selected.length === 2, 'both skills retained at the exact boundary');
assert(r8.totalChars === 100, 'totalChars equals maxChars');
assert(r8.droppedCount === 0, 'no drops at the boundary');

// 9. Name fields preserved on drop
console.log('\n9. Names preserved');
assert(r5.selected.map((s) => s.name).includes('high'), 'kept names preserved');

// Summary
console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) process.exit(1);
