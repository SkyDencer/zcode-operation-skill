/**
 * Tests for src/core/slm/prompt-builder.mjs
 *
 * Run: node --test tests/slm/prompt-builder.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSelectorPrompt,
  buildMultiSelectorPrompt,
  EmptyTaskError,
  EmptyCandidatesError,
} from '../../src/core/slm/prompt-builder.mjs';

const CANDIDATES_5 = [
  { name: 'auth-jwt', description: 'JWT authentication and token management' },
  { name: 'db-postgres', description: 'PostgreSQL query building and migrations' },
  { name: 'api-rest', description: 'REST API design patterns and validation' },
  { name: 'testing-pest', description: 'Pest test framework for Laravel' },
  { name: 'cache-redis', description: 'Redis caching strategies and eviction' },
];

const CANDIDATES_100 = Array.from({ length: 100 }, (_, i) => ({
  name: `skill-${String(i).padStart(3, '0')}`,
  description: `Description for skill number ${i} with some extra detail about what it does`,
}));

const LONG_DESC = 'x'.repeat(300);

test('buildSelectorPrompt — well-formed prompt with 5 candidates', () => {
  const { system, user } = buildSelectorPrompt('Write a login endpoint', CANDIDATES_5);

  assert.equal(
    system,
    'You are a skill router. Reply with ONLY the exact name of the single best matching skill. No punctuation. No explanation.',
  );
  assert.ok(user.includes('Available skills:'), 'user contains skills header');
  assert.ok(user.includes('auth-jwt'), 'user contains first candidate name');
  assert.ok(user.includes('testing-pest'), 'user contains testing-pest');
  assert.ok(user.includes('Task: "Write a login endpoint"'), 'user contains task');
  assert.ok(user.endsWith('Best skill:'), 'user ends with selection prompt');
});

test('buildSelectorPrompt — truncates to 30 candidates when given 100', () => {
  const { user } = buildSelectorPrompt('do something', CANDIDATES_100);

  // Count skill entries in user message (lines starting with "- ")
  const skillLines = user.split('\n').filter((l) => l.startsWith('- '));
  assert.equal(skillLines.length, 30, 'exactly 30 candidates in prompt');
  assert.ok(user.includes('skill-000'), 'first candidate included');
  assert.ok(!user.includes('skill-099'), '30th+ candidate excluded');
});

test('buildSelectorPrompt — rejects empty task', () => {
  assert.throws(
    () => buildSelectorPrompt('', CANDIDATES_5),
    (err) => err instanceof EmptyTaskError,
  );
  assert.throws(
    () => buildSelectorPrompt('   ', CANDIDATES_5),
    (err) => err instanceof EmptyTaskError,
  );
  assert.throws(
    () => buildSelectorPrompt(null, CANDIDATES_5),
    (err) => err instanceof EmptyTaskError,
  );
});

test('buildSelectorPrompt — rejects empty candidates', () => {
  assert.throws(
    () => buildSelectorPrompt('write a test', []),
    (err) => err instanceof EmptyCandidatesError,
  );
  assert.throws(
    () => buildSelectorPrompt('write a test', null),
    (err) => err instanceof EmptyCandidatesError,
  );
});

test('buildSelectorPrompt — truncates descriptions to 200 chars', () => {
  const { user } = buildSelectorPrompt('test', [{ name: 'long-desc-skill', description: LONG_DESC }]);
  // The description part should be truncated (ends with ellipsis).
  const match = user.match(/long-desc-skill: (.+)/);
  assert.ok(match, 'found description in user message');
  assert.ok(match[1].endsWith('…'), 'truncated description ends with ellipsis');
  assert.ok(match[1].length <= 203, 'truncated description is ~200 chars (+ ellipsis)');
});

test('buildMultiSelectorPrompt — well-formed JSON prompt', () => {
  const { system, user } = buildMultiSelectorPrompt('Add unit tests', CANDIDATES_5);

  assert.ok(
    system.includes('{"skills":'),
    'system mentions JSON shape',
  );
  assert.ok(system.includes('"confidence"'), 'system mentions confidence field');
  assert.ok(system.includes('No markdown fences'), 'system forbids fences');
  assert.ok(user.includes('Available skills:'), 'user lists skills');
  assert.ok(user.includes('Task: "Add unit tests"'), 'user contains task');
  assert.ok(user.endsWith('Best skills (JSON):'), 'user ends with JSON prompt');
});

test('buildMultiSelectorPrompt — same caps and truncation as single', () => {
  const { user } = buildMultiSelectorPrompt('x', CANDIDATES_100);
  const skillLines = user.split('\n').filter((l) => l.startsWith('- '));
  assert.equal(skillLines.length, 30, 'multi also caps at 30');

  const { user: u2 } = buildMultiSelectorPrompt('x', [
    { name: 'a', description: LONG_DESC },
  ]);
  const m = u2.match(/a: (.+)/);
  assert.ok(m[1].endsWith('…'), 'multi also truncates descriptions');
});
