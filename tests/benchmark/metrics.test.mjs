/**
 * Tests for the benchmark helper modules (Sub-Phase 6.10).
 *
 * Sub-Phase 6.10 grades the FNV-1a and ONNX providers on **Set Recall**, which
 * `tests/run-benchmark.mjs` did not compute before: it reported Top-1 and
 * Recall@3 only, which cannot distinguish a provider that finds the right
 * skill in position 4 from one that misses it. These tests pin the Set Recall
 * convention (top-5 returned set, negative prompts scored on the abstention
 * decision) and the corpus helpers the harness now imports.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expectedSetFor, gradePrompt, summarizeSetRecall } from '../benchmark/metrics.mjs';
import { parseFrontmatter, loadSkillsFromDir } from '../benchmark/corpus.mjs';

const index = JSON.parse(readFileSync(resolve('data/skill-index.json'), 'utf-8'));

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.error(`  ✗ ${message}`); }
}

console.log('\n=== Benchmark metrics tests ===\n');

// 1. Expected-set expansion.
console.log('1. Expected set expansion');
assert(expectedSetFor('backend-eloquent', index).size === 1, 'a single skill name expands to one entry');
assert(expectedSetFor(null, index).size === 0, 'a null expectation expands to the empty set (negative prompt)');
assert(expectedSetFor(undefined, index).size === 0, 'an undefined expectation expands to the empty set');
const multi = expectedSetFor('multi:backend', index);
const backendSkills = index.filter((s) => s.domains.includes('backend'));
assert(multi.size === backendSkills.length, `multi:backend expands to every backend skill (${multi.size})`);
assert(backendSkills.every((s) => multi.has(s.name)), 'every backend skill is in the expanded set');

// 2. Grading a skill prompt.
console.log('2. Grading a skill prompt');
const hit = gradePrompt('backend-eloquent', ['a', 'b', 'backend-eloquent', 'd', 'e'], false, index);
assert(hit.kind === 'skill', 'a named expectation is graded as a skill prompt');
assert(hit.recall === 1, 'expected skill in the top 5 scores 1');
const miss = gradePrompt('backend-eloquent', ['a', 'b', 'c', 'd', 'e'], false, index);
assert(miss.recall === 0, 'expected skill outside the top 5 scores 0');
const partial = gradePrompt('multi:backend', backendSkills.map((s) => s.name), false, index);
assert(partial.recall > 0 && partial.recall < 1, `a multi-domain prompt scores a fraction (${partial.recall.toFixed(3)})`);
assert(partial.expectedCount === backendSkills.length, 'the expected count is the expanded domain size');
const beyond = gradePrompt('backend-eloquent', ['x', 'y', 'z', 'w', 'backend-eloquent', 'sixth'], false, index);
assert(beyond.recall === 1, 'only the first five names count as the returned set');

// 3. Grading a negative prompt.
console.log('3. Grading a negative prompt');
const abstained = gradePrompt(null, [], true, index);
assert(abstained.kind === 'negative', 'a null expectation is graded as a negative prompt');
assert(abstained.recall === 1, 'abstaining on a negative prompt scores 1');
const surfaced = gradePrompt(null, ['backend-eloquent'], false, index);
assert(surfaced.recall === 0, 'surfacing a skill on a negative prompt scores 0');

// 4. Aggregation.
console.log('4. Aggregation');
const rows = [
  { setRecall: 1, setKind: 'skill' },
  { setRecall: 0, setKind: 'skill' },
  { setRecall: 1, setKind: 'negative' },
];
const agg = summarizeSetRecall(rows);
assert(agg.skillPrompts === 2, `skill prompts counted (${agg.skillPrompts})`);
assert(agg.negativePrompts === 1, `negative prompts counted (${agg.negativePrompts})`);
assert(agg.skillHits === 1, `skill hits counted (${agg.skillHits})`);
assert(agg.negativeHits === 1, `abstentions counted (${agg.negativeHits})`);
assert(agg.setRecallSkillPrompts === 0.5, 'skill-prompt Set Recall is the mean over skill prompts only');
assert(agg.setRecall === 0.6667, 'overall Set Recall is the mean over every prompt');
const empty = summarizeSetRecall([]);
assert(empty.setRecall === 0 && empty.skillPrompts === 0, 'an empty run aggregates to zeros, not NaN');

// 5. Corpus helpers.
console.log('5. Corpus helpers');
const fm = parseFrontmatter('---\nname: demo-skill\ndescription: A demo\nkeywords:\n  - one\n  - two\ndomains:\n  - backend\n---\n\nBody text.\n');
assert(fm.name === 'demo-skill', 'frontmatter scalars parse');
assert(Array.isArray(fm.keywords) && fm.keywords.length === 2, 'frontmatter lists parse');
assert(parseFrontmatter('no frontmatter here').name === undefined, 'a document without frontmatter yields {}');
const realSkills = loadSkillsFromDir(resolve('data/skills'));
assert(realSkills.length === 54, `the project leaf corpus is 54 SKILL.md files (got ${realSkills.length})`);
assert(
  realSkills.every((s, i) => i === 0 || realSkills[i - 1].name.localeCompare(s.name) <= 0),
  'loaded skills are sorted by name'
);

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
