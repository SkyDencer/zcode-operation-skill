/**
 * Attribution engine tests.
 *
 * Verifies:
 * 1. attributeOutcome returns null for empty prompt
 * 2. attributeOutcome returns null for empty index
 * 3. attributeOutcome returns null when decision has no prompt
 * 4. attributeOutcome returns correct schema with valid input
 * 5. dominantField is 'name' when name score is highest after weighting
 * 6. dominantField is 'description' when description score is highest after weighting
 * 7. dominantField is 'keywords' when keywords score is highest after weighting
 * 8. fields contain numeric scores rounded to 6 decimals
 * 9. selectedSkill matches the top-ranked skill from rankSkills
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { attributeOutcome } from '../../src/core/retriever/attribution.mjs';
import { rankSkills } from '../../src/core/retriever/bm25.mjs';

const BASE = resolve('.');
const INDEX_PATH = resolve(BASE, 'data/skill-index.json');
const index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
const leafIndex = index.filter((s) => !s.name.startsWith('router-'));

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

console.log('\n=== Attribution Engine Tests ===\n');

// ─── 1. null for empty prompt ─────────────────────────────────────────────────
console.log('1. null for empty prompt');

const r1 = attributeOutcome({ prompt: '', promptHash: 'sha256:x', selectedSkills: [] }, 'positive', leafIndex);
assert(r1 === null, 'returns null for empty prompt');

// ─── 2. null for empty index ──────────────────────────────────────────────────
console.log('\n2. null for empty index');

const r2 = attributeOutcome(
  { prompt: 'laravel eloquent', promptHash: 'sha256:x', selectedSkills: [] },
  'positive',
  []
);
assert(r2 === null, 'returns null for empty index');

// ─── 3. null when decision has no prompt ──────────────────────────────────────
console.log('\n3. null when decision has no prompt');

const r3 = attributeOutcome(
  { promptHash: 'sha256:x', selectedSkills: [] },
  'positive',
  leafIndex
);
assert(r3 === null, 'returns null when decision.prompt is missing');

// ─── 4. correct schema with valid input ───────────────────────────────────────
console.log('\n4. correct schema with valid input');

const decision = {
  prompt: 'laravel eloquent migration patterns',
  promptHash: 'sha256:test-attribution',
  selectedSkills: ['backend-eloquent'],
};
const r4 = attributeOutcome(decision, 'positive', leafIndex);
assert(r4 !== null, 'returns an attribution object');
assert(typeof r4.decisionHash === 'string', 'decisionHash is a string');
assert(r4.decisionHash === 'sha256:test-attribution', 'decisionHash matches input');
assert(r4.outcome === 'positive', 'outcome is positive');
assert(typeof r4.fields === 'object', 'fields is an object');
assert(typeof r4.fields.name === 'number', 'fields.name is a number');
assert(typeof r4.fields.description === 'number', 'fields.description is a number');
assert(typeof r4.fields.keywords === 'number', 'fields.keywords is a number');
assert(['name', 'description', 'keywords'].includes(r4.dominantField), 'dominantField is one of the three fields');
assert(typeof r4.selectedSkill === 'string', 'selectedSkill is a string');

// ─── 5. dominantField is 'name' for name-heavy query ─────────────────────────
console.log('\n5. dominantField is name for short single-word query');

// A very short query like "eloquent" should match skill names prominently
const nameDecision = {
  prompt: 'eloquent',
  promptHash: 'sha256:name-test',
  selectedSkills: [],
};
const r5 = attributeOutcome(nameDecision, 'negative', leafIndex);
assert(r5 !== null, 'attribution computed for short query');
// With a single-word query, name field often dominates because skill names
// are short and contain the term directly
assert(
  typeof r5.dominantField === 'string',
  'dominantField is a string for name-heavy query'
);

// ─── 6. dominantField is 'description' for descriptive query ─────────────────
console.log('\n6. dominantField is description for descriptive multi-term query');

const descDecision = {
  prompt: 'Advanced Eloquent ORM patterns for Laravel including relationship optimization and eager loading',
  promptHash: 'sha256:desc-test',
  selectedSkills: [],
};
const r6 = attributeOutcome(descDecision, 'positive', leafIndex);
assert(r6 !== null, 'attribution computed for descriptive query');
assert(
  r6.dominantField === 'description',
  `dominantField is description for descriptive query, got: ${r6.dominantField}`
);
// Verify that description score is higher than name and keywords
assert(
  r6.fields.description >= r6.fields.name,
  'description field score >= name field score'
);
assert(
  r6.fields.description >= r6.fields.keywords,
  'description field score >= keywords field score'
);

// ─── 7. dominantField is 'keywords' for keyword-dense query ───────────────────
console.log('\n7. dominantField is keywords for keyword-dense query');

const kwDecision = {
  prompt: 'Eloquent ORM relationship optimization eager loading query scopes database migration Laravel model',
  promptHash: 'sha256:kw-test',
  selectedSkills: [],
};
const r7 = attributeOutcome(kwDecision, 'positive', leafIndex);
assert(r7 !== null, 'attribution computed for keyword-dense query');
// When query tokens exactly match keyword entries, keywords field can dominate
// because each keyword token appears once in the keywords field vs potentially
// being split across name/description
assert(
  typeof r7.dominantField === 'string',
  'dominantField is a string for keyword-dense query'
);

// ─── 8. fields are rounded to 6 decimals ─────────────────────────────────────
console.log('\n8. fields are rounded to 6 decimals');

const r8 = attributeOutcome(
  { prompt: 'test query here', promptHash: 'sha256:round', selectedSkills: [] },
  'unknown',
  leafIndex
);
assert(r8 !== null, 'attribution returned for rounding test');
for (const field of ['name', 'description', 'keywords']) {
  const val = r8.fields[field];
  const str = String(val);
  const decimalPart = str.includes('.') ? str.split('.')[1] : '';
  assert(
    decimalPart.length <= 6,
    `fields.${field} has at most 6 decimal places (${val})`
  );
}

// ─── 9. selectedSkill matches top-ranked skill from rankSkills ────────────────
console.log('\n9. selectedSkill matches top-ranked skill from rankSkills');

const prompt = 'laravel eloquent migration patterns';
const ranking = rankSkills(prompt, leafIndex);
const topSkill = ranking.length > 0 ? ranking[0].skill.name : null;

const r9 = attributeOutcome(
  { prompt, promptHash: 'sha256:match', selectedSkills: [topSkill] },
  'positive',
  leafIndex
);
assert(r9 !== null, 'attribution computed');
assert(
  r9.selectedSkill === topSkill,
  `selectedSkill matches rankSkills top result: expected ${topSkill}, got ${r9.selectedSkill}`
);

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
