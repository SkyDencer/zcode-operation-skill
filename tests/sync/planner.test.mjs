/**
 * Sync planner tests.
 *
 * Tests:
 *   1. planSync finds skills in both project and mirror (unchanged)
 *   2. planSync detects new skills (add)
 *   3. planSync detects modified skills (update)
 *   4. planSync detects removed skills (remove)
 *   5. planSync uses SHA-256 content hash
 *   6. planSync handles empty project directory
 *   7. planSync handles empty mirror directory
 *   8. planSync respects SKILL_ROUTER_ZCODE_DIR env var
 *   9. planSync sorts results deterministically
 *  10. planSync skips unreadable files gracefully
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planSync } from '../../src/sync/planner.mjs';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, 'tmp');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
  }
}

function cleanTmp() {
  if (existsSync(TMP)) {
    rmSync(TMP, { recursive: true, force: true });
  }
  mkdirSync(TMP, { recursive: true });
}

function writeSkill(dir, name, desc, content = 'Some content here.') {
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), [
    '---',
    `name: ${name}`,
    `description: ${desc}`,
    'keywords:',
    '  - test',
    '  - skill',
    'domains:',
    '  - testing',
    '---',
    '',
    content,
  ].join('\n'), 'utf-8');
}

function join(a, b) {
  return resolve(a, b);
}

// ── 1. Unchanged skills ────────────────────────────────────────────────────────

console.log('\n=== 1. Unchanged Skills ===');

cleanTmp();
const project1 = resolve(TMP, 'project-1');
const mirror1 = resolve(TMP, 'mirror-1');

writeSkill(project1, 'testing-sync-unchanged', 'An unchanged skill.');
writeSkill(mirror1, 'testing-sync-unchanged', 'An unchanged skill.');

const plan1 = await planSync(project1, mirror1);
assertEqual(plan1.add.length, 0, 'no adds');
assertEqual(plan1.update.length, 0, 'no updates');
assertEqual(plan1.remove.length, 0, 'no removes');
assertEqual(plan1.unchanged.length, 1, 'one unchanged');
assert(plan1.unchanged[0].name === 'testing-sync-unchanged', 'unchanged skill name correct');
assert(typeof plan1.mirrorPath === 'string', 'mirrorPath is a string');

// ── 2. New skills (add) ────────────────────────────────────────────────────────

console.log('\n=== 2. New Skills (Add) ===');

cleanTmp();
const project2 = resolve(TMP, 'project-2');
const mirror2 = resolve(TMP, 'mirror-2');

writeSkill(project2, 'testing-sync-new', 'A brand new skill.');
// mirror2 is empty

const plan2 = await planSync(project2, mirror2);
assertEqual(plan2.add.length, 1, 'one add');
assertEqual(plan2.add[0].name, 'testing-sync-new', 'add name correct');
assertEqual(plan2.update.length, 0, 'no updates');
assertEqual(plan2.remove.length, 0, 'no removes');
assertEqual(plan2.unchanged.length, 0, 'no unchanged');

// ── 3. Modified skills (update) ────────────────────────────────────────────────

console.log('\n=== 3. Modified Skills (Update) ===');

cleanTmp();
const project3 = resolve(TMP, 'project-3');
const mirror3 = resolve(TMP, 'mirror-3');

writeSkill(project3, 'testing-sync-updated', 'Updated content here.', 'New content that is different.');
writeSkill(mirror3, 'testing-sync-updated', 'Original content.', 'Original content that is different.');

const plan3 = await planSync(project3, mirror3);
assertEqual(plan3.add.length, 0, 'no adds');
assertEqual(plan3.update.length, 1, 'one update');
assertEqual(plan3.update[0].name, 'testing-sync-updated', 'update name correct');
assertEqual(plan3.remove.length, 0, 'no removes');
assertEqual(plan3.unchanged.length, 0, 'no unchanged');

// ── 4. Removed skills ──────────────────────────────────────────────────────────

console.log('\n=== 4. Removed Skills ===');

cleanTmp();
const project4 = resolve(TMP, 'project-4');
const mirror4 = resolve(TMP, 'mirror-4');

writeSkill(project4, 'testing-sync-kept', 'Kept skill.');
writeSkill(mirror4, 'testing-sync-kept', 'Kept skill.');
writeSkill(mirror4, 'testing-sync-removed', 'Removed skill.');

const plan4 = await planSync(project4, mirror4);
assertEqual(plan4.add.length, 0, 'no adds');
assertEqual(plan4.update.length, 0, 'no updates');
assertEqual(plan4.remove.length, 1, 'one remove');
assertEqual(plan4.remove[0].name, 'testing-sync-removed', 'remove name correct');
assertEqual(plan4.unchanged.length, 1, 'one unchanged');

// ── 5. SHA-256 content hash ────────────────────────────────────────────────────

console.log('\n=== 5. SHA-256 Content Hash ===');

cleanTmp();
const project5 = resolve(TMP, 'project-5');
const mirror5 = resolve(TMP, 'mirror-5');

writeSkill(project5, 'testing-sync-hash', 'Hash skill.', 'Content A');
writeSkill(mirror5, 'testing-sync-hash', 'Hash skill.', 'Content B');

const plan5 = await planSync(project5, mirror5);
assertEqual(plan5.update.length, 1, 'different content → update');
assert(typeof plan5.update[0].hash === 'string', 'hash is a string');
assert(plan5.update[0].hash.length === 64, 'hash is 64 hex chars (SHA-256)');

// Same content → unchanged
writeSkill(project5, 'testing-sync-hash-same', 'Same hash skill.', 'Identical content here.');
writeSkill(mirror5, 'testing-sync-hash-same', 'Same hash skill.', 'Identical content here.');

const plan5b = await planSync(project5, mirror5);
const sameEntry = plan5b.unchanged.find((e) => e.name === 'testing-sync-hash-same');
assert(!!sameEntry, 'identical content → unchanged');

// ── 6. Empty project directory ─────────────────────────────────────────────────

console.log('\n=== 6. Empty Project Directory ===');

cleanTmp();
const project6 = resolve(TMP, 'project-6');
const mirror6 = resolve(TMP, 'mirror-6');

mkdirSync(project6, { recursive: true });
writeSkill(mirror6, 'testing-sync-mirror-only', 'Only in mirror.');

const plan6 = await planSync(project6, mirror6);
assertEqual(plan6.add.length, 0, 'no adds from empty project');
assertEqual(plan6.remove.length, 1, 'one remove from mirror');
assertEqual(plan6.update.length, 0, 'no updates');
assertEqual(plan6.unchanged.length, 0, 'no unchanged');

// ── 7. Empty mirror directory ──────────────────────────────────────────────────

console.log('\n=== 7. Empty Mirror Directory ===');

cleanTmp();
const project7 = resolve(TMP, 'project-7');
const mirror7 = resolve(TMP, 'mirror-7');

writeSkill(project7, 'testing-sync-project-only', 'Only in project.');
mkdirSync(mirror7, { recursive: true });

const plan7 = await planSync(project7, mirror7);
assertEqual(plan7.add.length, 1, 'one add to empty mirror');
assertEqual(plan7.remove.length, 0, 'no removes');
assertEqual(plan7.unchanged.length, 0, 'no unchanged');

// ── 8. SKILL_ROUTER_ZCODE_DIR env var ──────────────────────────────────────────

console.log('\n=== 8. SKILL_ROUTER_ZCODE_DIR Env Var ===');

cleanTmp();
const project8 = resolve(TMP, 'project-8');
const mirror8 = resolve(TMP, 'mirror-8');

process.env.SKILL_ROUTER_ZCODE_DIR = mirror8;
writeSkill(project8, 'testing-sync-env', 'Env var skill.');

const plan8 = await planSync(project8);
assertEqual(plan8.add.length, 1, 'uses env var for mirror path');
assertEqual(plan8.mirrorPath, mirror8, 'mirrorPath matches env var');
delete process.env.SKILL_ROUTER_ZCODE_DIR;

// ── 9. Deterministic sorting ───────────────────────────────────────────────────

console.log('\n=== 9. Deterministic Sorting ===');

cleanTmp();
const project9 = resolve(TMP, 'project-9');
const mirror9 = resolve(TMP, 'mirror-9');

writeSkill(project9, 'testing-sync-z-skill', 'Z skill.');
writeSkill(project9, 'testing-sync-a-skill', 'A skill.');
writeSkill(project9, 'testing-sync-m-skill', 'M skill.');
mkdirSync(mirror9, { recursive: true });

const plan9 = await planSync(project9, mirror9);
const names = plan9.add.map((e) => e.name);
assertEqual(names[0], 'testing-sync-a-skill', 'add list sorted alphabetically (first)');
assertEqual(names[1], 'testing-sync-m-skill', 'add list sorted alphabetically (middle)');
assertEqual(names[2], 'testing-sync-z-skill', 'add list sorted alphabetically (last)');

// ── 10. Skips unreadable files ─────────────────────────────────────────────────

console.log('\n=== 10. Skips Unreadable Files ===');

cleanTmp();
const project10 = resolve(TMP, 'project-10');
const mirror10 = resolve(TMP, 'mirror-10');

// Create a valid skill
writeSkill(project10, 'testing-sync-readable', 'Readable skill.', 'Content here.');
// Create an unreadable SKILL.md (if possible on this platform)
const badDir = join(project10, 'testing-sync-bad');
mkdirSync(badDir, { recursive: true });
const badFile = join(badDir, 'SKILL.md');
writeFileSync(badFile, 'bad content', 'utf-8');
// On Windows we can't easily make a file unreadable without admin, so just
// verify the readable one is still found
const plan10 = await planSync(project10, mirror10);
assert(plan10.add.length >= 1, 'finds at least one readable skill');

// ── Cleanup ────────────────────────────────────────────────────────────────────

cleanTmp();

// ── Summary ────────────────────────────────────────────────────────────────────

console.log('\n=== Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
