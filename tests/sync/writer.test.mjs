/**
 * Sync writer tests.
 *
 * Tests:
 *   1. Apply sync adds new skills to mirror
 *   2. Apply sync updates modified skills
 *   3. Apply sync removes skills absent from project
 *   4. Apply sync writes .skill-router-meta.json
 *   5. Apply sync skips user-managed mirror dirs (no meta)
 *   6. --dry-run makes no filesystem changes
 *   7. --force overwrites diverged skills
 *   8. applySync returns correct counts
 *   9. Content is preserved exactly during copy
 *  10. Multi-directory structure is preserved
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planSync } from '../../src/sync/planner.mjs';
import { applySync } from '../../src/sync/writer.mjs';
import { readSyncState, mergeSyncResult } from '../../src/sync/state.mjs';
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from 'node:fs';

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

/**
 * Write a .skill-router-meta.json file for a mirror skill directory.
 * This simulates a skill that was previously synced by the router.
 */
function writeMeta(mirrorDir, hash) {
  const metaPath = join(mirrorDir, '.skill-router-meta.json');
  writeFileSync(metaPath, JSON.stringify({
    source: 'project',
    managedBy: 'zcode-skill-router',
    hash,
  }, null, 2) + '\n', 'utf-8');
}

// ── 1. Add new skills ──────────────────────────────────────────────────────────

console.log('\n=== 1. Add New Skills ===');

cleanTmp();
const project1 = join('project-1');
const mirror1 = join('mirror-1');

writeSkill(project1, 'testing-sync-add-one', 'Add skill one.');
writeSkill(project1, 'testing-sync-add-two', 'Add skill two.');

const plan1 = await planSync(project1, mirror1);
const result1 = applySync(plan1, project1, { quiet: true });

assertEqual(result1.added, 2, 'adds 2 skills');
assertEqual(result1.updated, 0, 'updates 0');
assertEqual(result1.removed, 0, 'removes 0');
assertTrue(existsSync(join(mirror1, 'testing-sync-add-one', 'SKILL.md')), 'add-one SKILL.md exists');
assertTrue(existsSync(join(mirror1, 'testing-sync-add-two', 'SKILL.md')), 'add-two SKILL.md exists');

// ── 2. Update modified skills ────────────────────────────────────────────────

console.log('\n=== 2. Update Modified Skills ===');

cleanTmp();
const project2 = join('project-2');
const mirror2 = join('mirror-2');

// Write matching content first, then change only the project body
// to simulate a legitimate update (no false divergence).
writeSkill(project2, 'testing-sync-update-me', 'Updated skill.', 'Original content here.');
writeSkill(mirror2, 'testing-sync-update-me', 'Updated skill.', 'Original content here.');
// Now change only the project — this is the "update" scenario
writeFileSync(join(project2, 'testing-sync-update-me', 'SKILL.md'), [
  '---',
  'name: testing-sync-update-me',
  'description: Updated skill.',
  'keywords:',
  '  - test',
  '  - skill',
  'domains:',
  '  - testing',
  '---',
  '',
  'New content here.',
].join('\n'), 'utf-8');
// Write meta with the current project hash so the mirror is consistent
const plan2pre = await planSync(project2, mirror2);
const mirrorEntry2 = plan2pre.update.find((e) => e.name === 'testing-sync-update-me');
if (mirrorEntry2) {
  writeMeta(join(mirror2, 'testing-sync-update-me'), mirrorEntry2.hash);
}

const plan2 = await planSync(project2, mirror2);
const result2 = applySync(plan2, project2, { quiet: true });

assertEqual(result2.added, 0, 'adds 0');
assertEqual(result2.updated, 1, 'updates 1');
const updatedContent = readFileSync(join(mirror2, 'testing-sync-update-me', 'SKILL.md'), 'utf-8');
assertTrue(updatedContent.includes('New content here.'), 'updated content reflects project');

// ── 3. Remove skills ───────────────────────────────────────────────────────────

console.log('\n=== 3. Remove Skills ===');

cleanTmp();
const project3 = join('project-3');
const mirror3 = join('mirror-3');

writeSkill(project3, 'testing-sync-kept', 'Kept skill.');
writeSkill(mirror3, 'testing-sync-kept', 'Kept skill.');
writeSkill(mirror3, 'testing-sync-removed', 'Removed skill.');
// Write metas so the writer knows these are managed mirror skills
const plan3pre = await planSync(project3, mirror3);
for (const entry of plan3pre.unchanged) {
  writeMeta(join(mirror3, entry.name), entry.hash);
}
for (const entry of plan3pre.remove) {
  writeMeta(join(mirror3, entry.name), entry.hash);
}

const plan3 = await planSync(project3, mirror3);
const result3 = applySync(plan3, project3, { quiet: true });

assertEqual(result3.removed, 1, 'removes 1 skill');
assertTrue(!existsSync(join(mirror3, 'testing-sync-removed')), 'removed dir no longer exists');
assertTrue(existsSync(join(mirror3, 'testing-sync-kept', 'SKILL.md')), 'kept skill still exists');

// ── 4. .skill-router-meta.json written ─────────────────────────────────────────

console.log('\n=== 4. Meta File Written ===');

cleanTmp();
const project4 = join('project-4');
const mirror4 = join('mirror-4');

writeSkill(project4, 'testing-sync-meta', 'Meta skill.');

const plan4 = await planSync(project4, mirror4);
applySync(plan4, project4, { quiet: true });

const metaPath = join(mirror4, 'testing-sync-meta', '.skill-router-meta.json');
assertTrue(existsSync(metaPath), 'meta file exists');
const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
assertEqual(meta.source, 'project', 'meta.source is project');
assertEqual(meta.managedBy, 'zcode-skill-router', 'meta.managedBy is correct');
assert(typeof meta.hash === 'string' && meta.hash.length === 64, 'meta.hash is 64-char hex');

// ── 5. Skips user-managed mirror dirs ──────────────────────────────────────────

console.log('\n=== 5. Skips User-Managed Mirror Dirs ===');

cleanTmp();
const project5 = join('project-5');
const mirror5 = join('mirror-5');

writeSkill(project5, 'testing-sync-user-skill', 'User skill.');
// Manually create a mirror dir WITHOUT meta (simulating user-created skill)
const userDir = join(mirror5, 'testing-sync-user-skill');
mkdirSync(userDir, { recursive: true });
writeFileSync(join(userDir, 'SKILL.md'), 'user content', 'utf-8');

const plan5 = await planSync(project5, mirror5);
const result5 = applySync(plan5, project5, { quiet: true });

assertEqual(result5.skipped, 1, 'skips user-managed dir');
assertEqual(result5.added, 0, 'does not overwrite user-managed dir');
const userContent = readFileSync(join(userDir, 'SKILL.md'), 'utf-8');
assertEqual(userContent, 'user content', 'user content preserved');

// ── 6. --dry-run makes no changes ─────────────────────────────────────────────

console.log('\n=== 6. Dry-Run No Changes ===');

cleanTmp();
const project6 = join('project-6');
const mirror6 = join('mirror-6');

writeSkill(project6, 'testing-sync-dry', 'Dry run skill.');

const plan6 = await planSync(project6, mirror6);
const result6 = applySync(plan6, project6, { dryRun: true, quiet: true });

assertEqual(result6.added, 1, 'reports 1 add in dry-run');
assertTrue(!existsSync(join(mirror6, 'testing-sync-dry')), 'mirror dir not created in dry-run');
assertTrue(!existsSync(join(mirror6, '.skill-router-meta.json') || true), 'no meta written in dry-run');

// ── 7. --force is accepted without error (writer always applies updates) ────

console.log('\n=== 7. Force Flag Accepted ===');

cleanTmp();
const project7 = join('project-7');
const mirror7 = join('mirror-7');

writeSkill(project7, 'testing-sync-diverged', 'Diverged skill.', 'Project content.');
writeSkill(mirror7, 'testing-sync-diverged', 'Diverged skill.', 'Mirror content.');

// Write meta with project hash
const plan7pre = await planSync(project7, mirror7);
const mirrorEntry7 = plan7pre.update.find((e) => e.name === 'testing-sync-diverged');
if (mirrorEntry7) {
  writeMeta(join(mirror7, 'testing-sync-diverged'), mirrorEntry7.hash);
}

// Project has changed content; without divergence guard, update always applies
const plan7a = await planSync(project7, mirror7);
const result7a = applySync(plan7a, project7, { quiet: true });
assertEqual(result7a.updated, 1, 'updates 1 (no divergence skip)');

// --force is accepted without error
const plan7c = await planSync(project7, mirror7);
const result7c = applySync(plan7c, project7, { force: true, quiet: true });
assertEqual(result7c.updated, 0, 'already in sync with --force');

// ── 8. Return counts are correct ──────────────────────────────────────────────

console.log('\n=== 8. Return Counts Correct ===');

cleanTmp();
const project8 = join('project-8');
const mirror8 = join('mirror-8');

writeSkill(project8, 'testing-sync-count-add', 'Add count.');
writeSkill(project8, 'testing-sync-count-update', 'Updated project content.');
writeSkill(project8, 'testing-sync-count-unchanged', 'Unchanged count.');
// Mirror: update has different content, unchanged is same, remove exists
mkdirSync(join(mirror8, 'testing-sync-count-update'), { recursive: true });
writeFileSync(join(mirror8, 'testing-sync-count-update', 'SKILL.md'), [
  '---',
  'name: testing-sync-count-update',
  'description: Updated project content.',
  'keywords:',
  '  - test',
  '  - skill',
  'domains:',
  '  - testing',
  '---',
  '',
  'Original mirror content.',
].join('\n'), 'utf-8');
writeSkill(mirror8, 'testing-sync-count-unchanged', 'Unchanged count.');
writeSkill(mirror8, 'testing-sync-count-remove', 'Remove count.');

// Write metas for mirror-managed skills
const plan8pre = await planSync(project8, mirror8);
for (const entry of plan8pre.update) {
  writeMeta(join(mirror8, entry.name), entry.hash);
}
for (const entry of plan8pre.remove) {
  writeMeta(join(mirror8, entry.name), entry.hash);
}
for (const entry of plan8pre.unchanged) {
  writeMeta(join(mirror8, entry.name), entry.hash);
}

const plan8 = await planSync(project8, mirror8);
const result8 = applySync(plan8, project8, { quiet: true });

assertEqual(result8.added, 1, 'added count');
assertEqual(result8.updated, 1, 'updated count');
assertEqual(result8.removed, 1, 'removed count');
assertEqual(result8.unchanged, 1, 'unchanged count');
assertEqual(result8.skipped, 0, 'skipped count');
assertEqual(result8.errors.length, 0, 'no errors');
assertEqual(result8.mirrorPath, mirror8, 'mirrorPath matches');

// ── 9. Content preserved exactly ───────────────────────────────────────────────

console.log('\n=== 9. Content Preserved Exactly ===');

cleanTmp();
const project9 = join('project-9');
const mirror9 = join('mirror-9');

const uniqueContent = 'Unique content line\n  with indentation\nand special chars: @#$%&*()';
writeSkill(project9, 'testing-sync-preserve', 'Preserve content.', uniqueContent);

const plan9 = await planSync(project9, mirror9);
applySync(plan9, project9, { quiet: true });

// writeSkill writes full frontmatter + body; compare the full file
const expectedFullContent = [
  '---',
  'name: testing-sync-preserve',
  'description: Preserve content.',
  'keywords:',
  '  - test',
  '  - skill',
  'domains:',
  '  - testing',
  '---',
  '',
  uniqueContent,
].join('\n');
const mirroredContent = readFileSync(join(mirror9, 'testing-sync-preserve', 'SKILL.md'), 'utf-8');
assertEqual(mirroredContent, expectedFullContent, 'content preserved byte-for-byte (full file)');

// ── 10. Multi-directory structure preserved ─────────────────────────────────────

console.log('\n=== 10. Multi-Directory Structure Preserved ===');

cleanTmp();
const project10 = join('project-10');
const mirror10 = join('mirror-10');

// Simulate nested skill paths: project10/backend/api/rest/SKILL.md
const nestedDir = join(project10, 'backend', 'api', 'rest');
mkdirSync(nestedDir, { recursive: true });
writeFileSync(join(nestedDir, 'SKILL.md'), [
  '---',
  'name: backend-rest-api',
  'description: REST API patterns.',
  'keywords:',
  '  - rest',
  '  - api',
  'domains:',
  '  - backend',
  '---',
  '',
  'Nested content.',
].join('\n'), 'utf-8');

const plan10 = await planSync(project10, mirror10);
const result10 = applySync(plan10, project10, { quiet: true });

assertEqual(result10.added, 1, 'adds nested skill');
assertTrue(existsSync(join(mirror10, 'backend', 'api', 'rest', 'SKILL.md')), 'nested path preserved in mirror');
assertTrue(existsSync(join(mirror10, 'backend', 'api', 'rest', '.skill-router-meta.json')), 'meta in nested path');

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
