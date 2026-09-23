/**
 * Tests for src/index/dedupe.mjs — resolveCollisions
 */
import { resolveCollisions } from '../../src/index/dedupe.mjs';
import { strict as assert } from 'node:assert';

// ─── Helpers ────────────────────────────────────────────────────────────────

function skill(name, source = 'project', overrides = {}) {
  return {
    name,
    description: `Description for ${name}`,
    keywords: [name],
    domains: ['test'],
    path: `data/skills/${source}/${name}/SKILL.md`,
    version: '0.1.0',
    source,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

function testNoCollisions() {
  const entries = [
    skill('backend-api', 'project'),
    skill('frontend-react', 'project'),
    skill('zcode-shared', 'zcode-user'),
  ];

  const result = resolveCollisions(entries);

  assert.strictEqual(result.length, 3, 'should keep all entries when no collisions');
  const byName = new Map(result.map((s) => [s.name, s.source]));
  assert.strictEqual(byName.get('backend-api'), 'project');
  assert.strictEqual(byName.get('frontend-react'), 'project');
  assert.strictEqual(byName.get('zcode-shared'), 'zcode-user');

  console.log('  ✓ testNoCollisions');
}

function testProjectWinsCollision() {
  const entries = [
    skill('auth-middleware', 'project', { description: 'Project auth desc' }),
    skill('auth-middleware', 'zcode-user', { description: 'ZCode auth desc' }),
  ];

  const result = resolveCollisions(entries);

  assert.strictEqual(result.length, 1, 'should deduplicate to single entry');
  assert.strictEqual(result[0].name, 'auth-middleware');
  assert.strictEqual(result[0].source, 'project', 'project should win over zcode-user');
  assert.strictEqual(result[0].description, 'Project auth desc');

  console.log('  ✓ testProjectWinsCollision');
}

function testZcodeUserKeptWhenNoProject() {
  const entries = [
    skill('unique-tool', 'zcode-user', { description: 'ZCode-only tool' }),
  ];

  const result = resolveCollisions(entries);

  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].source, 'zcode-user');

  console.log('  ✓ testZcodeUserKeptWhenNoProject');
}

function testProjectReplacesLaterZcodeUser() {
  // zcode-user listed first, then project — project should still win
  const entries = [
    skill('shared-lib', 'zcode-user', { description: 'ZCode version' }),
    skill('shared-lib', 'project', { description: 'Project version' }),
  ];

  const result = resolveCollisions(entries);

  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].source, 'project');
  assert.strictEqual(result[0].description, 'Project version');

  console.log('  ✓ testProjectReplacesLaterZcodeUser');
}

function testMultipleCollisions() {
  const entries = [
    skill('api-client', 'project'),
    skill('api-client', 'zcode-user'),
    skill('db-migrate', 'project'),
    skill('db-migrate', 'zcode-user'),
    skill('standalone', 'project'),
  ];

  const result = resolveCollisions(entries);

  assert.strictEqual(result.length, 3, 'should have 3 unique skills after dedup');
  const byName = new Map(result.map((s) => [s.name, s.source]));
  assert.strictEqual(byName.get('api-client'), 'project');
  assert.strictEqual(byName.get('db-migrate'), 'project');
  assert.strictEqual(byName.get('standalone'), 'project');

  console.log('  ✓ testMultipleCollisions');
}

function testEmptyInput() {
  const result = resolveCollisions([]);
  assert.strictEqual(result.length, 0);
  console.log('  ✓ testEmptyInput');
}

function testSingleEntry() {
  const entries = [skill('lonely', 'project')];
  const result = resolveCollisions(entries);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].source, 'project');
  console.log('  ✓ testSingleEntry');
}

function testPreservesAllFields() {
  const original = skill('preserved', 'project', {
    description: 'my desc',
    keywords: ['kw1', 'kw2'],
    domains: ['domain-a'],
    path: 'custom/path/SKILL.md',
    version: '1.2.3',
  });
  const entries = [original];
  const result = resolveCollisions(entries);

  assert.strictEqual(result[0].name, 'preserved');
  assert.strictEqual(result[0].description, 'my desc');
  assert.deepEqual(result[0].keywords, ['kw1', 'kw2']);
  assert.deepEqual(result[0].domains, ['domain-a']);
  assert.strictEqual(result[0].path, 'custom/path/SKILL.md');
  assert.strictEqual(result[0].version, '1.2.3');
  assert.strictEqual(result[0].source, 'project');

  console.log('  ✓ testPreservesAllFields');
}

function testUnknownSourceTreatedAsLowest() {
  // A source not in SOURCE_PRIORITY should lose to project
  const entries = [
    skill('other-skill', 'project'),
    skill('other-skill', 'unknown-source'),
  ];

  const result = resolveCollisions(entries);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].source, 'project');

  console.log('  ✓ testUnknownSourceTreatedAsLowest');
}

// ─── Main ───────────────────────────────────────────────────────────────────

function runAll() {
  console.log('\n[dedupe.test] Running resolveCollisions tests:');
  testNoCollisions();
  testProjectWinsCollision();
  testZcodeUserKeptWhenNoProject();
  testProjectReplacesLaterZcodeUser();
  testMultipleCollisions();
  testEmptyInput();
  testSingleEntry();
  testPreservesAllFields();
  testUnknownSourceTreatedAsLowest();
  console.log('[dedupe.test] All 9 tests passed.\n');
}

runAll();
