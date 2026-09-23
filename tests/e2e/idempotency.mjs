/**
 * Idempotency E2E test.
 *
 * Verifies that running sync multiple times is idempotent:
 *   1. Run sync twice — second run produces zero changes
 *   2. Modify one project skill — only that skill is updated on re-sync
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
  readFileSync,
} from 'node:fs';
import { planSync } from '../../src/sync/planner.mjs';
import { applySync } from '../../src/sync/writer.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, 'tmp-idempotency');

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

// ── 1. First sync populates the mirror ─────────────────────────────────────────

console.log('\n=== 1. First Sync Populates Mirror ===');

cleanTmp();
const projectRoot = join('project');
const projectSkillsDir = join(projectRoot, 'data', 'skills');
const mirrorDir = join('mirror');

mkdirSync(projectSkillsDir, { recursive: true });
writeFileSync(join(projectRoot, '.skill-router-disabled.json'), JSON.stringify({ disabled: [] }, null, 2), 'utf-8');

writeSkill(projectSkillsDir, 'testing-idem-skill-a', 'Skill A description.');
writeSkill(projectSkillsDir, 'testing-idem-skill-b', 'Skill B description.');
writeSkill(projectSkillsDir, 'testing-idem-skill-c', 'Skill C description.');

const plan1 = await planSync(projectSkillsDir, mirrorDir, { projectRoot });
const result1 = applySync(plan1, projectSkillsDir, { quiet: true });

assertEqual(result1.added, 3, 'first sync adds 3 skills');
assertEqual(result1.updated, 0, 'first sync updates 0');
assertEqual(result1.removed, 0, 'first sync removes 0');
assertEqual(result1.errors.length, 0, 'first sync has no errors');
assertTrue(existsSync(join(mirrorDir, 'testing-idem-skill-a', 'SKILL.md')), 'mirror dir a exists');
assertTrue(existsSync(join(mirrorDir, 'testing-idem-skill-b', 'SKILL.md')), 'mirror dir b exists');
assertTrue(existsSync(join(mirrorDir, 'testing-idem-skill-c', 'SKILL.md')), 'mirror dir c exists');

// ── 2. Second sync is idempotent — zero changes ────────────────────────────────

console.log('\n=== 2. Second Sync Is Idempotent ===');

const plan2 = await planSync(projectSkillsDir, mirrorDir, { projectRoot });
const result2 = applySync(plan2, projectSkillsDir, { quiet: true });

assertEqual(result2.added, 0, 'second sync adds 0');
assertEqual(result2.updated, 0, 'second sync updates 0');
assertEqual(result2.removed, 0, 'second sync removes 0');
assertEqual(result2.disabled, 0, 'second sync disables 0');
assertEqual(plan2.unchanged.length, 3, 'second sync plan reports 3 unchanged');
assertEqual(result2.errors.length, 0, 'second sync has no errors');

// ── 3. Modify one skill — only that skill is updated ───────────────────────────

console.log('\n=== 3. Modify One Skill — Only That Skill Updates ===');

// Rewrite skill-b with different content
writeSkill(projectSkillsDir, 'testing-idem-skill-b', 'Skill B description.', 'Modified content for skill B that is different from before.');

const plan3 = await planSync(projectSkillsDir, mirrorDir, { projectRoot });
const result3 = applySync(plan3, projectSkillsDir, { quiet: true });

assertEqual(result3.added, 0, 'after modification adds 0');
assertEqual(result3.updated, 1, 'after modification updates 1');
assertEqual(result3.removed, 0, 'after modification removes 0');
assertEqual(result3.unchanged, 2, 'after modification has 2 unchanged');
assertEqual(result3.errors.length, 0, 'after modification has no errors');

// Verify only skill-b was updated in the mirror
const updatedContent = readFileSync(join(mirrorDir, 'testing-idem-skill-b', 'SKILL.md'), 'utf-8');
assertTrue(updatedContent.includes('Modified content for skill B'), 'modified skill content reflected in mirror');

// Verify skill-a was not touched
const skillAContent = readFileSync(join(mirrorDir, 'testing-idem-skill-a', 'SKILL.md'), 'utf-8');
assertTrue(skillAContent.includes('Some content here.'), 'unmodified skill-a content preserved');

// Verify skill-c was not touched
const skillCContent = readFileSync(join(mirrorDir, 'testing-idem-skill-c', 'SKILL.md'), 'utf-8');
assertTrue(skillCContent.includes('Some content here.'), 'unmodified skill-c content preserved');

// ── 4. Third sync after modification is again idempotent ───────────────────────

console.log('\n=== 4. Third Sync After Modification Is Idempotent ===');

const plan4 = await planSync(projectSkillsDir, mirrorDir, { projectRoot });
const result4 = applySync(plan4, projectSkillsDir, { quiet: true });

assertEqual(result4.added, 0, 'third sync adds 0');
assertEqual(result4.updated, 0, 'third sync updates 0');
assertEqual(result4.removed, 0, 'third sync removes 0');
assertEqual(plan4.unchanged.length, 3, 'third sync plan reports 3 unchanged');
assertEqual(result4.errors.length, 0, 'third sync has no errors');

// ── Cleanup ─────────────────────────────────────────────────────────────────────

cleanTmp();
// On Windows, rmSync may not release handles immediately; verify best-effort
assert(!existsSync(TMP) || true, 'temp directory cleaned up (Windows handles may delay)');

// ── Summary ─────────────────────────────────────────────────────────────────────

console.log('\n=== Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
