/**
 * Tests for src/core/slm/parser.mjs
 *
 * Run: node --test tests/slm/parser.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSingleSelection, parseMultiSelection } from '../../src/core/slm/parser.mjs';

const KNOWN = ['auth-jwt', 'db-postgres', 'api-rest', 'testing-pest', 'cache-redis'];

// ─── parseSingleSelection ────────────────────────────────────────────────────

test('parseSingleSelection — clean single name', () => {
  const result = parseSingleSelection('testing-pest', KNOWN);
  assert.equal(result.skill, 'testing-pest');
  assert.equal(result.confidence, 1.0);
  assert.equal(result.raw, 'testing-pest');
});

test('parseSingleSelection — ignores trailing punctuation', () => {
  const result = parseSingleSelection('auth-jwt.', KNOWN);
  assert.equal(result.skill, 'auth-jwt');
});

test('parseSingleSelection — takes first token only', () => {
  const result = parseSingleSelection('testing-pest please use this', KNOWN);
  assert.equal(result.skill, 'testing-pest');
});

test('parseSingleSelection — empty string returns null', () => {
  const result = parseSingleSelection('', KNOWN);
  assert.equal(result.skill, null);
  assert.equal(result.confidence, 0);
});

test('parseSingleSelection — null input returns null', () => {
  const result = parseSingleSelection(null, KNOWN);
  assert.equal(result.skill, null);
});

// ─── parseMultiSelection — clean JSON ────────────────────────────────────────

test('parseMultiSelection — clean JSON parsed correctly', () => {
  const raw = JSON.stringify({
    skills: [
      { name: 'testing-pest', score: 0.92, reason: 'Laravel testing' },
      { name: 'auth-jwt', score: 0.75, reason: 'Authentication related' },
    ],
    confidence: 0.88,
  });
  const result = parseMultiSelection(raw, KNOWN);
  assert.equal(result.skills.length, 2);
  assert.equal(result.skills[0].name, 'testing-pest');
  assert.equal(result.skills[0].score, 0.92);
  assert.equal(result.confidence, 0.88);
});

// ─── parseMultiSelection — fenced JSON ───────────────────────────────────────

test('parseMultiSelection — fenced JSON parsed', () => {
  const raw = '```json\n{"skills":[{"name":"db-postgres","score":0.8,"reason":"DB work"}],"confidence":0.85}\n```';
  const result = parseMultiSelection(raw, KNOWN);
  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].name, 'db-postgres');
  assert.equal(result.skills[0].score, 0.8);
});

test('parseMultiSelection — fenced without language tag', () => {
  const raw = '```\n{"skills":[{"name":"api-rest","score":0.6}],"confidence":0.6}\n```';
  const result = parseMultiSelection(raw, KNOWN);
  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].name, 'api-rest');
});

// ─── parseMultiSelection — malformed JSON ────────────────────────────────────

test('parseMultiSelection — malformed JSON returns empty', () => {
  const result = parseMultiSelection('not json at all', KNOWN);
  assert.deepEqual(result.skills, []);
  assert.equal(result.confidence, 0);
});

test('parseMultiSelection — empty string returns empty', () => {
  const result = parseMultiSelection('', KNOWN);
  assert.deepEqual(result.skills, []);
});

test('parseMultiSelection — null input returns empty', () => {
  const result = parseMultiSelection(null, KNOWN);
  assert.deepEqual(result.skills, []);
});

// ─── parseMultiSelection — unknown skill names dropped ───────────────────────

test('parseMultiSelection — unknown skill names are dropped', () => {
  const raw = JSON.stringify({
    skills: [
      { name: 'testing-pest', score: 0.9, reason: 'valid' },
      { name: 'nonexistent-skill', score: 0.95, reason: 'not in known' },
      { name: 'also-missing', score: 0.8, reason: 'not in known' },
    ],
    confidence: 0.9,
  });
  const result = parseMultiSelection(raw, KNOWN);
  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].name, 'testing-pest');
});

// ─── parseMultiSelection — scores out of range ───────────────────────────────

test('parseMultiSelection — scores below 0.5 are dropped', () => {
  const raw = JSON.stringify({
    skills: [
      { name: 'testing-pest', score: 0.9, reason: 'high' },
      { name: 'db-postgres', score: 0.3, reason: 'low' },
      { name: 'api-rest', score: 0.49, reason: 'just below' },
    ],
    confidence: 0.9,
  });
  const result = parseMultiSelection(raw, KNOWN);
  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].name, 'testing-pest');
});

test('parseMultiSelection — negative scores dropped', () => {
  const raw = JSON.stringify({
    skills: [{ name: 'cache-redis', score: -0.1, reason: 'negative' }],
    confidence: 0.5,
  });
  const result = parseMultiSelection(raw, KNOWN);
  assert.equal(result.skills.length, 0);
});

// ─── parseMultiSelection — more than 7 → capped ─────────────────────────────

test('parseMultiSelection — more than 7 skills capped at 7', () => {
  const skills = Array.from({ length: 10 }, (_, i) => ({
    name: `skill-${String(i).padStart(3, '0')}`,
    score: 0.9 - i * 0.01,
    reason: `reason ${i}`,
  }));
  const raw = JSON.stringify({ skills, confidence: 0.95 });
  const result = parseMultiSelection(raw, skills.map((s) => s.name));
  assert.equal(result.skills.length, 7);
  assert.equal(result.skills[0].name, 'skill-000'); // highest score
});

// ─── parseMultiSelection — duplicates deduped ────────────────────────────────

test('parseMultiSelection — duplicates deduped keeping highest score', () => {
  const raw = JSON.stringify({
    skills: [
      { name: 'auth-jwt', score: 0.6, reason: 'first' },
      { name: 'auth-jwt', score: 0.9, reason: 'second higher' },
      { name: 'auth-jwt', score: 0.7, reason: 'third mid' },
    ],
    confidence: 0.9,
  });
  const result = parseMultiSelection(raw, KNOWN);
  const entries = result.skills.filter((s) => s.name === 'auth-jwt');
  assert.equal(entries.length, 1, 'only one auth-jwt entry');
  assert.equal(entries[0].score, 0.9, 'keeps highest score');
});

// ─── parseMultiSelection — sort descending ───────────────────────────────────

test('parseMultiSelection — sorted descending by score', () => {
  const raw = JSON.stringify({
    skills: [
      { name: 'cache-redis', score: 0.55, reason: 'low' },
      { name: 'testing-pest', score: 0.95, reason: 'high' },
      { name: 'db-postgres', score: 0.80, reason: 'mid' },
    ],
    confidence: 0.9,
  });
  const result = parseMultiSelection(raw, KNOWN);
  assert.equal(result.skills[0].name, 'testing-pest');
  assert.equal(result.skills[1].name, 'db-postgres');
  assert.equal(result.skills[2].name, 'cache-redis');
});

// ─── parseMultiSelection — regex fallback for trailing content ───────────────

test('parseMultiSelection — extracts first JSON object from noisy text', () => {
  const raw = 'Here is the answer: {"skills":[{"name":"api-rest","score":0.7}],"confidence":0.7} and that\'s it';
  const result = parseMultiSelection(raw, KNOWN);
  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].name, 'api-rest');
});

// ─── parseMultiSelection — empty after filtering ─────────────────────────────

test('parseMultiSelection — returns empty when all names unknown', () => {
  const raw = JSON.stringify({
    skills: [{ name: 'foo-bar', score: 0.9, reason: 'unknown' }],
    confidence: 0.9,
  });
  const result = parseMultiSelection(raw, KNOWN);
  assert.deepEqual(result.skills, []);
});

test('parseMultiSelection — returns empty when all scores below 0.5', () => {
  const raw = JSON.stringify({
    skills: [{ name: 'testing-pest', score: 0.4, reason: 'too low' }],
    confidence: 0.4,
  });
  const result = parseMultiSelection(raw, KNOWN);
  assert.deepEqual(result.skills, []);
});
