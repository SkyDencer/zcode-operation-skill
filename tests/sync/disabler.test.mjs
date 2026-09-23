/**
 * Sync disabler tests.
 *
 * Tests:
 *   1. disableSkill removes a managed mirror directory (mirror mechanism)
 *   2. disableSkill refuses to touch unmanaged mirror dirs
 *   3. disableSkill is idempotent (no-op if already absent)
 *   4. disableSkill with shadow mechanism writes a shadow SKILL.md
 *   5. disableSkill with shadow preserves meta file
 *   6. enableSkill restores a disabled skill to the mirror
 *   7. enableSkill overwrites a shadow file
 *   8. enableSkill fails if source SKILL.md is missing
 *   9. readDisabledRegistry returns empty when no registry exists
 *  10. writeDisabledRegistry creates and reads back correctly
 *  11. writeDisabledRegistry updates existing registry
 *  12. disableSkill dry-run mode — verify via planner integration
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import {
  disableSkill,
  enableSkill,
  readDisabledRegistry,
  writeDisabledRegistry,
} from '../../src/sync/disabler.mjs';
import { planSync } from '../../src/sync/planner.mjs';
import { applySync } from '../../src/sync/writer.mjs';

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

function writeMeta(mirrorDir, hash) {
  writeFileSync(
    join(mirrorDir, '.skill-router-meta.json'),
    JSON.stringify({ source: 'project', managedBy: 'zcode-skill-router', hash }, null, 2) + '\n',
    'utf-8'
  );
}

// ── 1. disableSkill removes a managed mirror directory ────────────────────────

console.log('\n=== 1. disableSkill removes managed mirror dir ===');

cleanTmp();
const project1 = join('project-1');
const mirror1 = join('mirror-1');

writeSkill(project1, 'testing-disabler-managed', 'Managed skill.');
writeSkill(mirror1, 'testing-disabler-managed', 'Managed skill.');
writeMeta(join(mirror1, 'testing-disabler-managed'), 'abc123');

const result1 = disableSkill(mirror1, {
  name: 'testing-disabler-managed',
  path: 'testing-disabler-managed',
  hash: 'abc123',
});

assertTrue(result1.success, 'disableSkill succeeds');
assertTrue(!existsSync(join(mirror1, 'testing-disabler-managed')), 'mirror dir removed');
assertEqual(result1.mechanism, 'mirror', 'uses mirror mechanism');

// ── 2. disableSkill refuses unmanaged mirror dirs ─────────────────────────────

console.log('\n=== 2. disableSkill refuses unmanaged dirs ===');

cleanTmp();
const mirror2 = join('mirror-2');
mkdirSync(join(mirror2, 'testing-disabler-user'), { recursive: true });
writeFileSync(join(mirror2, 'testing-disabler-user', 'SKILL.md'), 'user content', 'utf-8');
// No .skill-router-meta.json — user-managed

const result2 = disableSkill(mirror2, {
  name: 'testing-disabler-user',
  path: 'testing-disabler-user',
  hash: 'fake',
});

assertTrue(!result2.success, 'refuses unmanaged dir');
assertTrue(existsSync(join(mirror2, 'testing-disabler-user', 'SKILL.md')), 'user skill untouched');

// ── 3. disableSkill is idempotent ─────────────────────────────────────────────

console.log('\n=== 3. disableSkill is idempotent ===');

cleanTmp();
const mirror3 = join('mirror-3');
// Mirror dir is completely absent — calling disable should succeed silently

const result3a = disableSkill(mirror3, {
  name: 'testing-disabler-imp',
  path: 'testing-disabler-imp',
  hash: 'none',
});
assertTrue(result3a.success, 'first call on absent dir succeeds');

const result3b = disableSkill(mirror3, {
  name: 'testing-disabler-imp',
  path: 'testing-disabler-imp',
  hash: 'none',
});
assertTrue(result3b.success, 'second call on absent dir also succeeds');
assertEqual(result3b.message.includes('already absent'), true, 'message says already absent');

// ── 4. disableSkill shadow mechanism ──────────────────────────────────────────

console.log('\n=== 4. disableSkill shadow mechanism ===');

cleanTmp();
const project4 = join('project-4');
const mirror4 = join('mirror-4');

writeSkill(project4, 'testing-disabler-shadow', 'Shadow skill.');
writeSkill(mirror4, 'testing-disabler-shadow', 'Shadow skill.');
writeMeta(join(mirror4, 'testing-disabler-shadow'), 'meta-hash');

const result4 = disableSkill(mirror4, {
  name: 'testing-disabler-shadow',
  path: 'testing-disabler-shadow',
  hash: 'meta-hash',
}, 'shadow');

assertTrue(result4.success, 'shadow disable succeeds');
const shadowContent = readFileSync(join(mirror4, 'testing-disabler-shadow', 'SKILL.md'), 'utf-8');
assertTrue(shadowContent.includes('disabled: true'), 'shadow SKILL.md has disabled: true');
assertTrue(existsSync(join(mirror4, 'testing-disabler-shadow', '.skill-router-meta.json')), 'meta file preserved');

// ── 5. disableSkill shadow preserves meta ─────────────────────────────────────

console.log('\n=== 5. Shadow preserves meta file ===');

cleanTmp();
const mirror5 = join('mirror-5');
mkdirSync(join(mirror5, 'testing-disabler-meta-preserve'), { recursive: true });
writeFileSync(join(mirror5, 'testing-disabler-meta-preserve', 'SKILL.md'), 'original content', 'utf-8');
writeMeta(join(mirror5, 'testing-disabler-meta-preserve'), 'original-hash');

const result5 = disableSkill(mirror5, {
  name: 'testing-disabler-meta-preserve',
  path: 'testing-disabler-meta-preserve',
  hash: 'original-hash',
}, 'shadow');

assertTrue(result5.success, 'shadow disable preserves meta');
const meta5 = JSON.parse(readFileSync(join(mirror5, 'testing-disabler-meta-preserve', '.skill-router-meta.json'), 'utf-8'));
assertEqual(meta5.hash, 'original-hash', 'meta hash preserved');

// ── 6. enableSkill restores a disabled skill ──────────────────────────────────

console.log('\n=== 6. enableSkill restores disabled skill ===');

cleanTmp();
const project6 = join('project-6');
const mirror6 = join('mirror-6');

writeSkill(project6, 'testing-disabler-enable', 'Enable skill.', 'Project content.');
writeSkill(mirror6, 'testing-disabler-enable', 'Enable skill.', 'Mirror content.');
writeMeta(join(mirror6, 'testing-disabler-enable'), 'mirror-hash');

// Disable first
const disableResult = disableSkill(mirror6, {
  name: 'testing-disabler-enable',
  path: 'testing-disabler-enable',
  hash: 'mirror-hash',
});
assertTrue(disableResult.success, 'disabled first');
assertTrue(!existsSync(join(mirror6, 'testing-disabler-enable')), 'mirror dir gone after disable');

// Now enable
const enableResult = enableSkill(mirror6, {
  name: 'testing-disabler-enable',
  path: 'testing-disabler-enable',
  hash: 'mirror-hash',
}, project6);

assertTrue(enableResult.success, 'enable succeeds');
assertTrue(existsSync(join(mirror6, 'testing-disabler-enable', 'SKILL.md')), 'SKILL.md restored');
const restored = readFileSync(join(mirror6, 'testing-disabler-enable', 'SKILL.md'), 'utf-8');
assertTrue(restored.includes('Project content.'), 'restored content matches project');

// ── 7. enableSkill overwrites shadow ──────────────────────────────────────────

console.log('\n=== 7. enableSkill overwrites shadow ===');

cleanTmp();
const project7 = join('project-7');
const mirror7 = join('mirror-7');

writeSkill(project7, 'testing-disabler-shadow-en', 'Shadow enable skill.', 'Real content.');
writeSkill(mirror7, 'testing-disabler-shadow-en', 'Shadow enable skill.', 'Mirror content.');
writeMeta(join(mirror7, 'testing-disabler-shadow-en'), 'meta-hash');

// Disable with shadow
disableSkill(mirror7, {
  name: 'testing-disabler-shadow-en',
  path: 'testing-disabler-shadow-en',
  hash: 'meta-hash',
}, 'shadow');

assertTrue(existsSync(join(mirror7, 'testing-disabler-shadow-en', 'SKILL.md')), 'shadow SKILL.md exists');

// Enable should overwrite the shadow
const enable7 = enableSkill(mirror7, {
  name: 'testing-disabler-shadow-en',
  path: 'testing-disabler-shadow-en',
  hash: 'meta-hash',
}, project7);

assertTrue(enable7.success, 'enable overwrites shadow');
const afterEnable = readFileSync(join(mirror7, 'testing-disabler-shadow-en', 'SKILL.md'), 'utf-8');
assertTrue(afterEnable.includes('Real content.'), 'shadow replaced with real skill');

// ── 8. enableSkill fails if source missing ────────────────────────────────────

console.log('\n=== 8. enableSkill fails if source missing ===');

cleanTmp();
const mirror8 = join('mirror-8');
mkdirSync(join(mirror8, 'testing-disabler-no-source'), { recursive: true });
writeMeta(join(mirror8, 'testing-disabler-no-source'), 'some-hash');

const result8 = enableSkill(mirror8, {
  name: 'testing-disabler-no-source',
  path: 'testing-disabler-no-source',
  hash: 'some-hash',
}, join('nonexistent-project'));

assertTrue(!result8.success, 'enable fails when source missing');
assert(result8.message.includes('source SKILL.md not found'), 'error message mentions missing source');

// ── 9. readDisabledRegistry empty ─────────────────────────────────────────────

console.log('\n=== 9. readDisabledRegistry returns empty when no registry ===');

cleanTmp();
const project9 = join('project-9');
mkdirSync(project9, { recursive: true });

const reg9 = readDisabledRegistry(project9);
assertEqual(reg9.disabled.length, 0, 'empty disabled list');
assertEqual(reg9.lastModified, null, 'no lastModified');

// ── 10. writeDisabledRegistry round-trip ──────────────────────────────────────

console.log('\n=== 10. writeDisabledRegistry round-trip ===');

cleanTmp();
const project10 = join('project-10');
mkdirSync(project10, { recursive: true });

writeDisabledRegistry(['skill-a', 'skill-b'], project10);
const reg10 = readDisabledRegistry(project10);
assertEqual(reg10.disabled.length, 2, 'two entries written');
assertEqual(reg10.disabled[0], 'skill-a', 'first entry correct');
assertEqual(reg10.disabled[1], 'skill-b', 'second entry correct');
assertTrue(reg10.lastModified !== null, 'lastModified is set');

// ── 11. writeDisabledRegistry updates existing ─────────────────────────────────

console.log('\n=== 11. writeDisabledRegistry updates existing ===');

cleanTmp();
const project11 = join('project-11');
mkdirSync(project11, { recursive: true });

writeDisabledRegistry(['old-skill'], project11);
writeDisabledRegistry(['new-skill'], project11);
const reg11 = readDisabledRegistry(project11);
assertEqual(reg11.disabled.length, 1, 'overwritten, not appended');
assertEqual(reg11.disabled[0], 'new-skill', 'new value takes effect');

// ── 12. Planner integrates disabled registry ──────────────────────────────────

console.log('\n=== 12. Planner integrates disabled registry ===');

cleanTmp();
const project12 = join('project-12');
const mirror12 = join('mirror-12');

writeSkill(project12, 'testing-planner-enabled', 'Enabled skill.');
writeSkill(project12, 'testing-planner-disabled', 'Disabled skill.');
writeSkill(mirror12, 'testing-planner-enabled', 'Enabled skill.');
writeSkill(mirror12, 'testing-planner-disabled', 'Disabled skill.');

// Write meta for mirror skills so writer knows they're managed
const planPre = await planSync(project12, mirror12, { projectRoot: project12 });
for (const entry of planPre.unchanged) {
  writeMeta(join(mirror12, entry.path), entry.hash);
}

// Create disabled registry
writeDisabledRegistry(['testing-planner-disabled'], project12);

const plan12 = await planSync(project12, mirror12, { projectRoot: project12 });
assertEqual(plan12.add.length, 0, 'no adds');
assertEqual(plan12.update.length, 0, 'no updates');
assertEqual(plan12.unchanged.length, 1, 'one unchanged (enabled skill)');
assertEqual(plan12.disabled.length, 1, 'one disabled');
assertEqual(plan12.disabled[0].name, 'testing-planner-disabled', 'disabled skill name correct');
assertEqual(plan12.remove.length, 0, 'no removes');

// ── 13. Writer applies disable during sync ────────────────────────────────────

console.log('\n=== 13. Writer applies disable during sync ===');

cleanTmp();
const project13 = join('project-13');
const mirror13 = join('mirror-13');

writeSkill(project13, 'testing-writer-disable', 'Writer disable skill.');
writeSkill(mirror13, 'testing-writer-disable', 'Writer disable skill.');

const planPre13 = await planSync(project13, mirror13, { projectRoot: project13 });
for (const entry of planPre13.unchanged) {
  writeMeta(join(mirror13, entry.path), entry.hash);
}

writeDisabledRegistry(['testing-writer-disable'], project13);
const plan13 = await planSync(project13, mirror13, { projectRoot: project13 });
const result13 = applySync(plan13, project13, { quiet: true });

assertEqual(result13.disabled, 1, 'writer disables 1 skill');
assertEqual(result13.added, 0, 'writer adds 0');
assertTrue(!existsSync(join(mirror13, 'testing-writer-disable')), 'disabled skill dir removed from mirror');

// ── 14. Dry-run does not actually disable ─────────────────────────────────────

console.log('\n=== 14. Dry-run does not disable ===');

cleanTmp();
const project14 = join('project-14');
const mirror14 = join('mirror-14');

writeSkill(project14, 'testing-dry-disable', 'Dry disable skill.');
writeSkill(mirror14, 'testing-dry-disable', 'Dry disable skill.');

const planPre14 = await planSync(project14, mirror14, { projectRoot: project14 });
for (const entry of planPre14.unchanged) {
  writeMeta(join(mirror14, entry.path), entry.hash);
}

writeDisabledRegistry(['testing-dry-disable'], project14);
const plan14 = await planSync(project14, mirror14, { projectRoot: project14 });
const result14 = applySync(plan14, project14, { dryRun: true, quiet: true });

assertEqual(result14.disabled, 1, 'reports 1 disabled in dry-run');
assertTrue(existsSync(join(mirror14, 'testing-dry-disable', 'SKILL.md')), 'mirror dir still exists in dry-run');

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
