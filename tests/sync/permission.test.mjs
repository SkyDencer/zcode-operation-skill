/**
 * P6-H-015 (Sub-Phase A.4) — permission-error handling in the sync planner.
 *
 * A permission failure reading a project SKILL.md must never be mistaken for
 * "the skill is absent", or the writer would delete a mirror skill the user
 * still owns. This test drives planSync with an injectable reader that
 * simulates filesystem error codes, and verifies:
 *
 *   1. One EACCES file → that skill is skipped, and (crucially) excluded from
 *      mirror-side `remove`; the rest of the plan is computed normally.
 *   2. More than 50% of project skills unreadable → the plan is rejected
 *      (planSync throws), so the writer never runs on partial data.
 *   3. ENOENT → treated as genuinely missing (pre-existing behaviour kept):
 *      the skill is NOT uncertain, so a matching mirror skill is still removed.
 *   4. A non-permission read error (EIO) → fatal, planSync throws.
 */
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readFile, readdir, stat, realpath } from 'node:fs/promises';
import { planSync } from '../../src/sync/planner.mjs';

const TMP = join(tmpdir(), `sr-sync-permission-${process.pid}`);

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

function writeSkill(dir, name, content = 'content') {
  const d = join(dir, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'SKILL.md'), content, 'utf-8');
}

/**
 * Build a reader that behaves like fs/promises except that reads of the named
 * paths reject with the given error code.
 *
 * @param {Array<[string, string]>} [overrides] — [absolutePath, errCode] pairs
 */
function readerWith(overrides = []) {
  const map = new Map(overrides);
  const makeErr = (code, p) => {
    const e = new Error(`${code}, simulated: ${p}`);
    e.code = code;
    return e;
  };
  return {
    readFile: async (p, enc) => {
      const code = map.get(resolve(p));
      if (code) throw makeErr(code, p);
      return readFile(p, enc);
    },
    readdir,
    stat,
    realpath,
  };
}

const names = (arr) => arr.map((e) => e.name).sort();

// ── 1. Single EACCES file: skipped and excluded from remove ─────────────────
console.log('\n=== 1. One EACCES file is skipped, not removed ===');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
const p1 = join(TMP, 'project-1');
const m1 = join(TMP, 'mirror-1');
writeSkill(p1, 'skill-a', 'A');
writeSkill(p1, 'skill-b', 'B');
writeSkill(p1, 'skill-c', 'C');
writeSkill(m1, 'skill-a', 'A');
writeSkill(m1, 'skill-b', 'B'); // skill-b lives in the mirror

const deniedB = join(p1, 'skill-b', 'SKILL.md');
const plan1 = await planSync(p1, m1, { projectRoot: p1, reader: readerWith([[deniedB, 'EACCES']]) });

assert(names(plan1.add).join(',') === 'skill-c', `only skill-c is added (got ${names(plan1.add).join(',')})`);
assert(names(plan1.unchanged).join(',') === 'skill-a', `skill-a is unchanged (got ${names(plan1.unchanged).join(',')})`);
assert(names(plan1.remove).join(',') === '', 'skill-b is NOT removed despite being unreadable in the project');
assert(plan1.skipped.length === 1 && plan1.skipped[0].name === 'skill-b', 'skill-b is recorded in skipped');
assert(plan1.errors.length === 0, 'no fatal errors recorded');

// ── 2. >50% unreadable: the plan is rejected ─────────────────────────────────
console.log('\n=== 2. More than 50% unreadable rejects the plan ===');
const p2 = join(TMP, 'project-2');
const m2 = join(TMP, 'mirror-2');
mkdirSync(m2, { recursive: true });
writeSkill(p2, 's-a', 'a');
writeSkill(p2, 's-b', 'b');
writeSkill(p2, 's-c', 'c');
writeSkill(p2, 's-d', 'd');

// Deny 3 of 4 (a, c, d) → 75% unreadable.
const overrides2 = [
  [join(p2, 's-a', 'SKILL.md'), 'EACCES'],
  [join(p2, 's-c', 'SKILL.md'), 'EACCES'],
  [join(p2, 's-d', 'SKILL.md'), 'EPERM'],
];
let threw2 = false;
try {
  await planSync(p2, m2, { projectRoot: p2, reader: readerWith(overrides2) });
} catch (err) {
  threw2 = /unreadable/i.test(err.message) || /refusing/i.test(err.message);
}
assert(threw2, 'planSync throws when >50% of project skills are unreadable');

// Exactly 50% (2 of 4) must NOT trip the guard.
const overrides2b = [
  [join(p2, 's-a', 'SKILL.md'), 'EACCES'],
  [join(p2, 's-c', 'SKILL.md'), 'EACCES'],
];
const plan2b = await planSync(p2, m2, { projectRoot: p2, reader: readerWith(overrides2b) });
assert(plan2b.skipped.length === 2, 'exactly 50% unreadable plans normally (2 skipped)');
assert(names(plan2b.add).join(',') === 's-b,s-d', 'the two readable skills are still added');

// ── 3. ENOENT: genuinely missing, so a mirror skill is still removed ─────────
console.log('\n=== 3. ENOENT is treated as absent (pre-existing behaviour) ===');
const p3 = join(TMP, 'project-3');
const m3 = join(TMP, 'mirror-3');
writeSkill(p3, 'skill-x', 'x');
writeSkill(m3, 'skill-x', 'x');
writeSkill(m3, 'skill-gone', 'gone'); // only in mirror; its project file vanished

// Simulate the project SKILL.md for skill-x having been deleted (ENOENT).
const goneB = join(p3, 'skill-gone', 'SKILL.md');
// skill-gone does not exist in the project at all; to exercise the ENOENT
// read path we point the reader at a project file that walkSkillFiles found
// but that "disappears": create it, then have the reader report ENOENT.
mkdirSync(join(p3, 'skill-gone'), { recursive: true });
writeFileSync(join(p3, 'skill-gone', 'SKILL.md'), 'gone', 'utf-8');

const plan3 = await planSync(p3, m3, {
  projectRoot: p3,
  reader: readerWith([[goneB, 'ENOENT']]),
});
assert(names(plan3.remove).join(',') === 'skill-gone', 'an ENOENT skill is still removed from the mirror');
assert(plan3.skipped.length === 0, 'ENOENT is not recorded as a skipped/uncertain skill');

// ── 4. Non-permission error is fatal ──────────────────────────────────────────
console.log('\n=== 4. A non-permission read error is fatal ===');
const p4 = join(TMP, 'project-4');
const m4 = join(TMP, 'mirror-4');
mkdirSync(m4, { recursive: true });
writeSkill(p4, 'skill-e', 'e');
let threw4 = false;
try {
  await planSync(p4, m4, {
    projectRoot: p4,
    reader: readerWith([[join(p4, 'skill-e', 'SKILL.md'), 'EIO']]),
  });
} catch (err) {
  threw4 = err.code === 'EIO';
}
assert(threw4, 'an EIO (non-permission) read error propagates and rejects the plan');

// ── Cleanup ───────────────────────────────────────────────────────────────────
rmSync(TMP, { recursive: true, force: true });

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) process.exit(1);
