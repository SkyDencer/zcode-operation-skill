/**
 * Truncator tests.
 *
 * Verifies paragraph-safe truncation:
 * - Text shorter than budget passes through unchanged
 * - Text longer than budget is truncated at paragraph boundaries
 * - First paragraph kept whole even if it exceeds budget (never split mid-paragraph)
 * - Empty / invalid inputs handled gracefully
 */
import { truncateAtParagraph, charCount } from '../../src/core/budget/truncator.mjs';

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

console.log('\n=== Truncator Tests ===\n');

// 1. Short text passes through
console.log('1. Short text passthrough');
const short = 'Hello world\n\nThis is a short paragraph.';
const r1 = truncateAtParagraph(short, 1000);
assert(r1 === short, 'text shorter than budget is unchanged');

// 2. Exact-length text passes through
console.log('\n2. Exact-length text');
const exact = 'exact text';
const r2 = truncateAtParagraph(exact, exact.length);
assert(r2 === exact, 'text exactly at budget is unchanged');

// 3. Truncation at paragraph boundary
console.log('\n3. Paragraph-boundary truncation');
const multiPara = 'Para one.\n\nPara two with more words.\n\nPara three is the longest paragraph here.';
const r3 = truncateAtParagraph(multiPara, 20);
assert(!r3.includes('Para three'), 'over-budget content is excluded');
assert(r3.length <= 20, 'result length <= budget');
assert(!r3.includes('\n\nPara'), 'truncated at paragraph boundary, not mid-para');
console.log(`    Result (${r3.length} chars): ${JSON.stringify(r3)}`);

// 4. First paragraph kept whole even if it exceeds budget
console.log('\n4. First paragraph exceeds budget');
const bigFirst = 'A'.repeat(100) + '\n\n' + 'B'.repeat(200);
const r4 = truncateAtParagraph(bigFirst, 50);
assert(r4.length === 100, 'first full paragraph kept even when exceeding budget');
assert(!r4.includes('B'), 'second paragraph excluded');
console.log(`    Result (${r4.length} chars): ${JSON.stringify(r4.slice(0, 60))}...`);

// 5. Empty input
console.log('\n5. Empty / invalid inputs');
assert(truncateAtParagraph('', 100) === '', 'empty string → empty');
assert(truncateAtParagraph(null, 100) === '', 'null → empty');
assert(truncateAtParagraph(undefined, 100) === '', 'undefined → empty');
assert(truncateAtParagraph('hello', 0) === '', 'maxChars=0 → empty');
assert(truncateAtParagraph('hello', -5) === '', 'negative maxChars → empty');

// 6. Single long paragraph, over budget — kept whole (never split mid-paragraph)
console.log('\n6. Single long paragraph');
const singleLong = 'A'.repeat(500);
const r6 = truncateAtParagraph(singleLong, 100);
assert(r6.length === 500, 'single paragraph that exceeds budget is kept whole (no mid-para split)');
console.log(`    Result length: ${r6.length} (budget was 100)`);

// 7. Multiple paragraphs, fits exactly
console.log('\n7. Multiple paragraphs fitting exactly');
const p1 = 'First';
const p2 = 'Second';
const p3 = 'Third';
const combined = p1 + '\n\n' + p2 + '\n\n' + p3;
const r7 = truncateAtParagraph(combined, combined.length);
assert(r7 === combined, 'all paragraphs kept when within budget');

// 8. Multiple paragraphs, tight budget keeps only first
console.log('\n8. Tight budget keeps only first paragraph');
const r8 = truncateAtParagraph(combined, 6); // "First" is 5 chars
assert(r8 === 'First', 'only first paragraph kept when budget is tight');
assert(r8.length <= 6, 'result ≤ budget');

// 9. charCount helper
console.log('\n9. charCount helper');
assert(charCount('') === 0, 'charCount("") === 0');
assert(charCount('hello') === 5, 'charCount("hello") === 5');
assert(charCount('こんにちは') === 5, 'charCount handles unicode');

// 10. Paragraphs with trailing whitespace/newlines
console.log('\n10. Whitespace handling in paragraphs');
const withWs = 'Para 1  \n\n  Para 2  \n\nPara 3';
const r10 = truncateAtParagraph(withWs, 15);
assert(r10.length <= 15, 'result within budget');
console.log(`    Result: ${JSON.stringify(r10)}`);

// Summary
console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) process.exit(1);
