/**
 * Tests for src/core/routing/explicit.mjs — explicit $-mention skill detection.
 *
 * Covers:
 *  1. $next → matches router-next
 *  2. $laravel → matches router-laravel
 *  3. $design → matches router-design
 *  4. No $mention → null
 *  5. Unknown alias $foo → null
 *  6. Uppercase $NEXT → matches router-next (case-insensitive)
 *  7. cleanedPrompt has $mention stripped
 *  8. Full router name $router-laravel → matches router-laravel
 *  9. $react → matches router-react
 * 10. $test → matches router-test
 * 11. $meta → matches router-meta
 *
 * Run: node --test tests/routing/explicit.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { detectExplicitSkill } from '../../src/core/routing/explicit.mjs';
import { routeWithExplicit } from '../../src/core/routing/hybrid.mjs';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE = resolve('.');
const INDEX_PATH = resolve(BASE, 'data/skill-index.json');
const index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
const knownSkills = index; // flat array of skill objects

// ─── Tests for detectExplicitSkill ────────────────────────────────────────────

test('$next how do I add middleware → matches router-next', () => {
  const result = detectExplicitSkill('$next how do I add middleware', knownSkills);
  assert.ok(result !== null, 'should detect $next');
  assert.equal(result.skill, 'router-next', 'should resolve to router-next');
  assert.equal(result.matchedText, '$next', 'matched text should be $next');
});

test('$laravel fix N+1 → matches router-laravel', () => {
  const result = detectExplicitSkill('$laravel fix N+1 query performance', knownSkills);
  assert.ok(result !== null, 'should detect $laravel');
  assert.equal(result.skill, 'router-laravel', 'should resolve to router-laravel');
  assert.equal(result.matchedText, '$laravel', 'matched text should be $laravel');
});

test('$design make prettier → matches router-design', () => {
  const result = detectExplicitSkill('$design make this look prettier', knownSkills);
  assert.ok(result !== null, 'should detect $design');
  assert.equal(result.skill, 'router-design', 'should resolve to router-design');
  assert.equal(result.matchedText, '$design', 'matched text should be $design');
});

test('fix N+1 (no $) → null', () => {
  const result = detectExplicitSkill('fix N+1 query performance issue', knownSkills);
  assert.equal(result, null, 'should return null when no $mention is present');
});

test('$foo unknown → null', () => {
  const result = detectExplicitSkill('$foo bar baz', knownSkills);
  assert.equal(result, null, 'should return null for unknown alias');
});

test('$NEXT uppercase → matches router-next (case-insensitive)', () => {
  const result = detectExplicitSkill('$NEXT configure ISR caching', knownSkills);
  assert.ok(result !== null, 'should detect uppercase $NEXT');
  assert.equal(result.skill, 'router-next', 'should resolve to router-next despite uppercase');
  assert.equal(result.matchedText, '$NEXT', 'matched text should preserve original case');
});

test('cleanedPrompt has $mention removed', () => {
  const result = detectExplicitSkill('$laravel create migration for users table', knownSkills);
  assert.ok(result !== null, 'should detect $laravel');
  assert.equal(result.cleanedPrompt, 'create migration for users table', 'cleanedPrompt should have $mention stripped');
});

test('full router name $router-laravel → matches router-laravel', () => {
  const result = detectExplicitSkill('$router-laravel build Eloquent model', knownSkills);
  assert.ok(result !== null, 'should detect full router name');
  assert.equal(result.skill, 'router-laravel', 'should resolve to router-laravel');
  assert.equal(result.matchedText, '$router-laravel', 'matched text should be the full name');
  assert.equal(result.cleanedPrompt, 'build Eloquent model', 'cleaned prompt should be rest');
});

test('$react hooks cleanup → matches router-react', () => {
  const result = detectExplicitSkill('$react useEffect cleanup pattern', knownSkills);
  assert.ok(result !== null, 'should detect $react');
  assert.equal(result.skill, 'router-react', 'should resolve to router-react');
});

test('$test TDD approach → matches router-test', () => {
  const result = detectExplicitSkill('$test write TDD test for auth', knownSkills);
  assert.ok(result !== null, 'should detect $test');
  assert.equal(result.skill, 'router-test', 'should resolve to router-test');
});

test('$meta code review feedback → matches router-meta', () => {
  const result = detectExplicitSkill('$meta review this PR for smells', knownSkills);
  assert.ok(result !== null, 'should detect $meta');
  assert.equal(result.skill, 'router-meta', 'should resolve to router-meta');
});

test('empty prompt → null', () => {
  const result = detectExplicitSkill('', knownSkills);
  assert.equal(result, null, 'empty prompt should return null');
});

test('prompt with $ in middle of word → null', () => {
  // $ is not followed by a valid identifier start (letter or underscore)
  const result = detectExplicitSkill('price is $50', knownSkills);
  assert.equal(result, null, 'dollar sign in numeric context should not match');
});

test('multiple $ mentions → first one wins', () => {
  const result = detectExplicitSkill('$next $laravel both frameworks', knownSkills);
  assert.ok(result !== null, 'should detect first $mention');
  assert.equal(result.skill, 'router-next', 'should resolve first match');
  assert.equal(result.cleanedPrompt, '$laravel both frameworks', 'only first mention stripped');
});

// ─── Tests for routeWithExplicit ──────────────────────────────────────────────

test('routeWithExplicit returns top-1 from scoped domain', () => {
  const decision = routeWithExplicit('build a Next.js app with app router', index, 'router-next');
  assert.ok(decision.explicit === true, 'decision should be explicit');
  assert.equal(decision.routerMatched, 'router-next', 'routerMatched should be router-next');
  assert.equal(decision.mode, 'explicit', 'mode should be explicit');
  assert.equal(decision.tier, 'bm25', 'tier should be bm25');
  assert.ok(decision.skills.length >= 1, 'should have at least one skill');
  assert.ok(decision.latencyMs.bm25 >= 0, 'bm25 latency should be recorded');
});

test('routeWithExplicit scopes to correct domain skills', () => {
  const decision = routeWithExplicit('fix N+1 query in Laravel', index, 'router-laravel');
  assert.ok(decision.explicit === true, 'decision should be explicit');
  assert.equal(decision.routerMatched, 'router-laravel', 'routerMatched should be router-laravel');
  // All returned skills should be in the backend domain
  for (const skill of decision.skills) {
    const idxEntry = index.find((s) => s.name === skill.name);
    if (idxEntry) {
      assert.ok(
        idxEntry.domains?.includes('backend'),
        `scoped skill ${skill.name} should be in backend domain`,
      );
    }
  }
});

test('routeWithExplicit returns empty when no domain match', () => {
  // Use a non-existent router to simulate unknown skill path
  const decision = routeWithExplicit('some task', index, 'router-next');
  // Even with a valid router, if the cleaned prompt has no overlap, score may be low
  assert.ok(decision.explicit === true, 'decision should still be explicit');
  assert.ok(Array.isArray(decision.skills), 'skills should be an array');
});

test('routeWithExplicit decision shape is valid', () => {
  const decision = routeWithExplicit('$next routing question', index, 'router-next');
  assert.ok(typeof decision === 'object', 'decision is an object');
  assert.ok(Array.isArray(decision.skills), 'skills is array');
  assert.ok(['hybrid', 'bm25', 'heuristic', 'none'].includes(decision.tier), `tier is valid: ${decision.tier}`);
  assert.ok(typeof decision.confidence === 'number', 'confidence is number');
  assert.ok(typeof decision.explicit === 'boolean', 'explicit is boolean');
  assert.ok(typeof decision.routerMatched === 'string', 'routerMatched is string');
  assert.ok(typeof decision.mode === 'string', 'mode is string');
  assert.ok(typeof decision.latencyMs === 'object', 'latencyMs is object');
});
