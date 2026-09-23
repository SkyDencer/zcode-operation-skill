/**
 * Budget manager tests.
 *
 * Verifies fitWithinBudget:
 * - Under-budget: returns all skills unmodified
 * - Over-budget: truncates each skill to equal share, respects minPerSkill
 * - Paragraphs longer than quota are kept whole (never split mid-paragraph)
 * - Empty input returns empty
 * - Config options are honored
 */
import { fitWithinBudget, defaultMaxChars, defaultMinPerSkill } from '../../src/core/budget/manager.mjs';

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

console.log('\n=== Budget Manager Tests ===\n');

// 1. Default constants
console.log('1. Default constants');
assert(defaultMaxChars === 24000, 'defaultMaxChars === 24000');
assert(defaultMinPerSkill === 500, 'defaultMinPerSkill === 500');

// 2. Empty input
console.log('\n2. Empty input');
const empty = fitWithinBudget([]);
assert(empty.selected.length === 0, 'empty input → empty selected');
assert(empty.totalChars === 0, 'empty input → totalChars 0');

const nullInput = fitWithinBudget(null);
assert(nullInput.selected.length === 0, 'null input → empty selected');

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
console.log(`    Total chars: ${r3.totalChars}`);

// 4. Over budget with short paragraphs (truncation works when paragraphs < quota)
console.log('\n4. Over budget: short paragraphs get truncated');
const shortParagraphs = [
  { name: 'X', content: 'X'.repeat(100) + '\n\n' + 'Y'.repeat(100) },  // 202 chars
  { name: 'Y', content: 'A'.repeat(100) + '\n\n' + 'B'.repeat(100) },  // 202 chars
  { name: 'Z', content: 'M'.repeat(100) + '\n\n' + 'N'.repeat(100) },  // 202 chars
];
// Total = 606, budget = 600, so over budget. Quota = floor(600/3) = 200, minPerSkill=0 → 200.
// Each has two 100-char paragraphs. First para (100) fits in 200 quota.
// Second para (100+2=102) would bring total to 202 > 200, so excluded.
const r4 = fitWithinBudget(shortParagraphs, { maxChars: 600, minPerSkill: 0 });
assert(r4.selected.length === 3, 'all 3 skills still selected');
assert(r4.selected[0].content.length === 100, 'first skill: first para kept (100 chars)');
assert(r4.selected[1].content.length === 100, 'second skill: first para kept (100 chars)');
assert(r4.selected[2].content.length === 100, 'third skill: first para kept (100 chars)');
assert(r4.totalChars === 300, `totalChars is ${r4.totalChars} (3 × 100)`);
console.log(`    Total chars after budget: ${r4.totalChars}`);

// 5. minPerSkill floor with short paragraphs
console.log('\n5. minPerSkill floor');
const manyShort = Array.from({ length: 10 }, (_, i) => ({
  name: `S${i}`,
  content: 'data'.repeat(25), // 100 chars each
}));
const r5 = fitWithinBudget(manyShort, { maxChars: 1500, minPerSkill: 200 });
// 1500 / 10 = 150 per skill, but minPerSkill = 200, so each gets 200.
// Each skill is 100 chars (< 200), so kept whole.
assert(r5.selected.length === 10, 'all 10 skills still selected');
assert(r5.selected[0].content.length === 100, 'each skill kept whole (100 < 200 quota)');
assert(r5.totalChars === 1000, `totalChars is ${r5.totalChars} (10 × 100)`);
console.log(`    Total chars: ${r5.totalChars}`);

// 6. Single skill with single long paragraph (kept whole, cannot split)
console.log('\n6. Single skill, single long paragraph');
const single = [{ name: 'Solo', content: 'S'.repeat(10000) }];
const r6 = fitWithinBudget(single, { maxChars: 3000 });
assert(r6.selected.length === 1, 'single skill retained');
assert(r6.selected[0].content.length === 10000, 'single long paragraph kept whole (> budget)');
assert(r6.totalChars === 10000, 'totalChars equals skill content length');
console.log(`    Total chars: ${r6.totalChars} (paragraph > budget, kept whole)`);

// 7. Mixed sizes — under budget, all kept whole
console.log('\n7. Mixed skill sizes');
const mixed = [
  { name: 'Small', content: 'abc\ndef\nghi' },                          // 11 chars
  { name: 'Medium', content: 'M'.repeat(200) + '\n\n' + 'N'.repeat(200) }, // 402 chars
  { name: 'Large', content: 'L'.repeat(200) + '\n\n' + 'O'.repeat(200) },  // 402 chars
];
// Total = 11 + 402 + 402 = 815. Budget = 3000. Under budget!
const r7 = fitWithinBudget(mixed, { maxChars: 3000 });
assert(r7.totalChars === 815, 'total equals raw sum (under budget)');
assert(r7.selected.length === 3, 'all 3 skills still present');
assert(r7.selected[0].content === 'abc\ndef\nghi', 'small skill unchanged');
console.log(`    Total chars: ${r7.totalChars}`);

// 7b. Same mixed but with tight budget — tests truncation
const mixedTight = [
  { name: 'Small', content: 'abc' },                     // 3 chars
  { name: 'Medium', content: 'M'.repeat(500) },          // 500 chars
  { name: 'Large', content: 'L'.repeat(500) },           // 500 chars
];
// Total = 1003, budget = 500. Quota = floor(500/3) = 166, minPerSkill=500 → 500.
// Each gets 500. Small (3) fits. Medium (500) fits. Large (500) fits.
// Total = 1003 > 500, but paragraphs kept whole since each ≤ quota.
const r7b = fitWithinBudget(mixedTight, { maxChars: 500 });
assert(r7b.totalChars === 1003, 'all skills kept (paragraphs ≤ quota)');
assert(r7b.selected.length === 3, 'all 3 skills still present');
console.log(`    Total chars (tight): ${r7b.totalChars}`);

// 8. Option overrides with multi-paragraph content that can be truncated
console.log('\n8. Custom maxChars with truncatable paragraphs');
const r8 = fitWithinBudget(
  [{ name: 'K', content: 'Part A\n\nPart B\n\nPart C' }],
  { maxChars: 15, minPerSkill: 0 }
);
// maxChars=15, minPerSkill=0. Quota = max(15, 0) = 15.
// Para 1 "Part A" = 6 chars. Para 2 "Part B" = 6 chars. 6+2+6=14 ≤ 15. Para 3 "Part C" = 6 chars. 14+2+6=22 > 15.
assert(r8.selected.length === 1, 'skill retained');
assert(!r8.selected[0].content.includes('Part C'), 'third paragraph excluded');
assert(r8.totalChars <= 15, 'total within budget');
console.log(`    Result (${r8.totalChars} chars): ${JSON.stringify(r8.selected[0].content)}`);

// 9. Paragraph-safe truncation preserves paragraph boundaries
console.log('\n9. Paragraph-safe truncation with multi-para content');
const paraContent = 'First paragraph.\n\nSecond paragraph here.\n\nThird paragraph is very long and should be truncated cleanly at paragraph boundaries.';
const r9 = fitWithinBudget([{ name: 'P', content: paraContent }], { maxChars: 50, minPerSkill: 0 });
// Para 1: "First paragraph." = 18 chars. Para 2: "Second paragraph here." = 22 chars. 18+2+22=42 ≤ 50.
// Para 3: "Third paragraph..." = 86 chars. 42+2+86=130 > 50. So para 3 excluded.
assert(r9.totalChars <= 50, 'result within 50-char budget');
assert(!r9.selected[0].content.includes('Third'), 'third paragraph excluded');
assert(r9.selected[0].content.includes('First'), 'first paragraph kept');
console.log(`    Result (${r9.totalChars} chars): ${JSON.stringify(r9.selected[0].content)}`);

// 10. Name fields preserved
console.log('\n10. Name fields preserved after truncation');
const names = r8.selected.map((s) => s.name);
assert(names.includes('K'), 'name field preserved');

// Summary
console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) process.exit(1);
