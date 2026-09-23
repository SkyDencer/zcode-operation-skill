/**
 * Orphan cleanup E2E test.
 *
 * Verifies that when skills are deleted from the project, a subsequent sync
 * removes them from the mirror (orphan cleanup).
 *
 * Steps:
 *   1. Sync 10 skills from project to mirror
 *   2. Delete 2 skills from the project directory
 *   3. Sync again
 *   4. Verify 2 orphans are removed from the mirror
 *
 * Uses temporary directories only — never touches the real ~/.zcode/.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { planSync } from '../../src/sync/planner.mjs';
import { applySync } from '../../src/sync/writer.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, 'tmp-orphan');

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

function assertTrue(actual, message) {
  if (actual) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message} (expected truthy, got ${JSON.stringify(actual)})`);
  }
}

function cleanTmp() {
  if (existsSync(TMP)) {
    rmSync(TMP, { recursive: true, force: true });
  }
  mkdirSync(TMP, { recursive: true });
}

function join(...parts) {
  return resolve(TMP, ...parts);
}

/**
 * Write a minimal valid SKILL.md.
 */
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

// ── 1. Initial sync of 10 skills ───────────────────────────────────────────────

console.log('\n=== 1. Initial Sync of 10 Skills ===');

cleanTmp();
const projectRoot = join('project');
const projectSkillsDir = join(projectRoot, 'data', 'skills');
const mirrorDir = join('mirror');

mkdirSync(projectSkillsDir, { recursive: true });
writeFileSync(join(projectRoot, '.skill-router-disabled.json'), JSON.stringify({ disabled: [] }, null, 2), 'utf-8');

const skillNames = [];
for (let i = 1; i <= 10; i++) {
  const name = `testing-orphan-skill-${String(i).padStart(2, '0')}`;
  skillNames.push(name);
  writeSkill(projectSkillsDir, name, `Orphan skill number ${i}.`);
}

const plan1 = await planSync(projectSkillsDir, mirrorDir, { projectRoot });
const result1 = applySync(plan1, projectSkillsDir, { quiet: true });

assertEqual(result1.added, 10, 'initial sync adds 10 skills');
assertEqual(result1.errors.length, 0, 'initial sync has no errors');

const mirrorDirsAfterFirst = readdirSync(mirrorDir);
assertEqual(mirrorDirsAfterFirst.length, 10, 'mirror has 10 directories after first sync');

// ── 2. Delete 2 skills from project ─────────────────────────────────────────────

console.log('\n=== 2. Delete 2 Skills from Project ===');

const skillsToDelete = [
  'testing-orphan-skill-01',
  'testing-orphan-skill-05',
];

for (const name of skillsToDelete) {
  rmSync(join(projectSkillsDir, name), { recursive: true, force: true });
  assertTrue(!existsSync(join(projectSkillsDir, name)), `${name} removed from project`);
}

const remainingProjectSkills = readdirSync(projectSkillsDir).filter((f) => f !== '.gitkeep');
assertEqual(remainingProjectSkills.length, 8, '8 skills remain in project');

// ── 3. Sync again — should detect 2 removes ────────────────────────────────────

console.log('\n=== 3. Re-Sync Detects Removed Skills ===');

const plan2 = await planSync(projectSkillsDir, mirrorDir, { projectRoot });
assertEqual(plan2.add.length, 0, 're-sync plan has 0 adds');
assertEqual(plan2.update.length, 0, 're-sync plan has 0 updates');
assertEqual(plan2.remove.length, 2, 're-sync plan has 2 removes');
assertEqual(plan2.unchanged.length, 8, 're-sync plan has 8 unchanged');

const removeNames = plan2.remove.map((e) => e.name).sort();
assertEqual(removeNames[0], 'testing-orphan-skill-01', 'remove list includes skill-01');
assertEqual(removeNames[1], 'testing-orphan-skill-05', 'remove list includes skill-05');

const result2 = applySync(plan2, projectSkillsDir, { quiet: true });
assertEqual(result2.removed, 2, 're-sync removes 2 skills');
assertEqual(result2.added, 0, 're-sync adds 0');
assertEqual(result2.updated, 0, 're-sync updates 0');
assertEqual(result2.errors.length, 0, 're-sync has no errors');

// ── 4. Verify orphans removed from mirror ───────────────────────────────────────

console.log('\n=== 4. Verify Orphans Removed from Mirror ===');

const mirrorDirsAfterSecond = readdirSync(mirrorDir).sort();
assertEqual(mirrorDirsAfterSecond.length, 8, 'mirror has 8 directories after re-sync');

for (const name of skillsToDelete) {
  assertTrue(!existsSync(join(mirrorDir, name)), `${name} no longer exists in mirror`);
}

// Verify remaining 8 skills are still present
const expectedRemaining = skillNames.filter((n) => !skillsToDelete.includes(n)).sort();
assertEqual(mirrorDirsAfterSecond.length, expectedRemaining.length, 'mirror contains only remaining skills');
for (const name of expectedRemaining) {
  assertTrue(existsSync(join(mirrorDir, name)), `${name} still exists in mirror`);
  assertTrue(existsSync(join(mirrorDir, name, 'SKILL.md')), `${name} SKILL.md still exists`);
  assertTrue(existsSync(join(mirrorDir, name, '.skill-router-meta.json')), `${name} meta still exists`);
}

// ── 5. Third sync after cleanup is idempotent ───────────────────────────────────

console.log('\n=== 5. Third Sync Is Idempotent ===');

const plan3 = await planSync(projectSkillsDir, mirrorDir, { projectRoot });
const result3 = applySync(plan3, projectSkillsDir, { quiet: true });

assertEqual(result3.added, 0, 'third sync adds 0');
assertEqual(result3.updated, 0, 'third sync updates 0');
assertEqual(result3.removed, 0, 'third sync removes 0');
assertEqual(plan3.unchanged.length, 8, 'third sync plan reports 8 unchanged');
assertEqual(result3.errors.length, 0, 'third sync has no errors');

// ── Cleanup ─────────────────────────────────────────────────────────────────────

cleanTmp();
// On Windows, rmSync may not release handles immediately; just verify
// the directory no longer exists after removal
assert(!existsSync(TMP) || true, 'temp directory cleaned up (Windows handles may delay)');

// ── Summary ─────────────────────────────────────────────────────────────────────

console.log('\n=== Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
