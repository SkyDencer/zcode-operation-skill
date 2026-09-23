/**
 * Deploy planner tests.
 *
 * Tests:
 *   1. planDeploy returns correct add/update/unchanged lists
 *   2. Empty zcodeDir -> all routers added
 *   3. Existing routers -> all unchanged
 *   4. Modified router -> update detected
 *   5. Warnings on missing SKILL.md
 *   6. Deterministic sorting
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planDeploy } from '../../src/deploy/planner.mjs';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, 'tmp');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.error(`  ✗ ${message}`); }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.error(`  ✗ ${message} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`); }
}

function cleanTmp() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

function join(...parts) { return resolve(TMP, ...parts); }

function hash(content) {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

function writeRouter(dir, name, content) {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, 'SKILL.md'), content, 'utf-8');
}

function writeMeta(dir, name, contentHash) {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, '.skill-router-meta.json'), JSON.stringify({
    source: 'router-skills', managedBy: 'zcode-skill-router', hash: contentHash,
  }, null, 2) + '\n', 'utf-8');
}

// ── Helper: create a project with router-skills ───────────────────────────────

function createTestProject(baseDir) {
  const routerSkillsDir = join(baseDir, 'router-skills');
  mkdirSync(routerSkillsDir, { recursive: true });
  return routerSkillsDir;
}

// ── 1. Correct add/update/unchanged classification ─────────────────────────────

console.log('\n=== 1. Correct Classification ===');

cleanTmp();
const base1 = join('base-1');
const projectDir1 = join(base1, 'project');
const mirrorDir1 = join(base1, 'mirror');
const rsDir1 = createTestProject(projectDir1);

writeRouter(rsDir1, 'router-next', '# Next Router\nContent A');
writeRouter(rsDir1, 'router-react', '# React Router\nContent B');
writeRouter(rsDir1, 'router-laravel', '# Laravel Router\nContent C');

// Mirror has next (same) and react (different) and an extra router-meta
writeMeta(mirrorDir1, 'router-next', hash('# Next Router\nContent A'));
writeMeta(mirrorDir1, 'router-react', hash('# React Router\nOLD CONTENT'));
writeRouter(mirrorDir1, 'router-meta', '# Meta Router\nContent'); // no meta = unmanaged

const plan1 = planDeploy(projectDir1, mirrorDir1);

assertEqual(plan1.routers.add.length, 1, 'one add (laravel not in mirror)');
assertEqual(plan1.routers.add[0].name, 'router-laravel', 'add is router-laravel');
assertEqual(plan1.routers.update.length, 1, 'one update (react)');
assertEqual(plan1.routers.update[0].name, 'router-react', 'update is router-react');
assertEqual(plan1.routers.unchanged.length, 1, 'one unchanged (next)');
assertEqual(plan1.routers.unchanged[0].name, 'router-next', 'unchanged is router-next');
assert(plan1.warnings.length === 0, 'no warnings (user-managed mirror dir not in source)');

// ── 2. Empty zcodeDir -> all routers added ─────────────────────────────────────

console.log('\n=== 2. Empty Mirror (All Add) ===');

cleanTmp();
const base2 = join('base-2');
const projectDir2 = join(base2, 'project');
const mirrorDir2 = join(base2, 'mirror');
const rsDir2 = createTestProject(projectDir2);

writeRouter(rsDir2, 'router-next', '# Next Router\nContent');
writeRouter(rsDir2, 'router-test', '# Test Router\nContent');

const plan2 = planDeploy(projectDir2, mirrorDir2);

assertEqual(plan2.routers.add.length, 2, 'two adds');
assertEqual(plan2.routers.add.map((e) => e.name).sort().join(','), 'router-next,router-test', 'add names correct');
assertEqual(plan2.routers.update.length, 0, 'no updates');
assertEqual(plan2.routers.unchanged.length, 0, 'no unchanged');

// ── 3. Existing matching routers -> all unchanged ──────────────────────────────

console.log('\n=== 3. All Unchanged ===');

cleanTmp();
const base3 = join('base-3');
const projectDir3 = join(base3, 'project');
const mirrorDir3 = join(base3, 'mirror');
const rsDir3 = createTestProject(projectDir3);

const content = '# Router\nSome content';
writeRouter(rsDir3, 'router-next', content);

const h = hash(content);
writeMeta(mirrorDir3, 'router-next', h);

const plan3 = planDeploy(projectDir3, mirrorDir3);

assertEqual(plan3.routers.add.length, 0, 'no adds');
assertEqual(plan3.routers.update.length, 0, 'no updates');
assertEqual(plan3.routers.unchanged.length, 1, 'one unchanged');
assertEqual(plan3.routers.unchanged[0].name, 'router-next', 'unchanged name correct');

// ── 4. Modified router -> update detected ──────────────────────────────────────

console.log('\n=== 4. Modified Router (Update) ===');

cleanTmp();
const base4 = join('base-4');
const projectDir4 = join(base4, 'project');
const mirrorDir4 = join(base4, 'mirror');
const rsDir4 = createTestProject(projectDir4);

writeRouter(rsDir4, 'router-next', '# Next Router v2\nUpdated content');
writeMeta(mirrorDir4, 'router-next', hash('# Next Router v1\nOriginal content'));

const plan4 = planDeploy(projectDir4, mirrorDir4);

assertEqual(plan4.routers.update.length, 1, 'one update detected');
assertEqual(plan4.routers.update[0].name, 'router-next', 'update name correct');
assert(plan4.routers.update[0].hash.length === 64, 'hash is 64-char hex');

// ── 5. Warnings on missing SKILL.md ────────────────────────────────────────────

console.log('\n=== 5. Missing SKILL.md Warning ===');

cleanTmp();
const base5 = join('base-5');
const projectDir5 = join(base5, 'project');
const mirrorDir5 = join(base5, 'mirror');
const rsDir5 = createTestProject(projectDir5);

mkdirSync(join(rsDir5, 'router-empty'), { recursive: true });
// No SKILL.md in router-empty

const plan5 = planDeploy(projectDir5, mirrorDir5);

assert(plan5.warnings.some((w) => w.includes('router-empty')), 'warning for missing SKILL.md');
assertEqual(plan5.routers.add.length, 0, 'no add for empty router');

// ── 6. Deterministic sorting ───────────────────────────────────────────────────

console.log('\n=== 6. Deterministic Sorting ===');

cleanTmp();
const base6 = join('base-6');
const projectDir6 = join(base6, 'project');
const mirrorDir6 = join(base6, 'mirror');
const rsDir6 = createTestProject(projectDir6);

writeRouter(rsDir6, 'router-zeta', '# Zeta');
writeRouter(rsDir6, 'router-alpha', '# Alpha');
writeRouter(rsDir6, 'router-mid', '# Mid');

const plan6 = planDeploy(projectDir6, mirrorDir6);

const addNames = plan6.routers.add.map((e) => e.name);
assertEqual(addNames[0], 'router-alpha', 'add[0] is alpha');
assertEqual(addNames[1], 'router-mid', 'add[1] is mid');
assertEqual(addNames[2], 'router-zeta', 'add[2] is zeta');

// ── Cleanup ────────────────────────────────────────────────────────────────────

cleanTmp();

// ── Summary ────────────────────────────────────────────────────────────────────

console.log('\n=== Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) process.exit(1);
