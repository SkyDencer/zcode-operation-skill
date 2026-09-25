/**
 * Path-traversal regression tests — Sub-Phase 6.4 security remediation.
 *
 * Library-level primitives: the external-skill importer and the sync disabler.
 * (The CLI surface is covered by `cli-path-traversal.test.mjs`.)
 *
 * Vulnerability: destination directories were derived from the untrusted
 * SKILL.md frontmatter `name` (`name.split('-')` + `path.join`), so a skill
 * named `backend-../../../../pwned` escaped the skills directory and wrote
 * SKILL.md anywhere on disk. `validateSkill()` accepts such a name because the
 * declared domain `backend` is registered and the name starts with `backend-`.
 * The same class of bug existed in `src/sync/disabler.mjs` (unvalidated
 * `entry.path` joined onto the mirror root, writable via the unsanitised
 * `--disable` registry) and `src/sync/writer.mjs`.
 *
 * This file covers:
 *   1. importSkills() rejects a traversal name, nothing written outside
 *   2. importSkills() imports a legitimate name exactly as before
 *   3. importSkills() rejects a backslash traversal name
 *   4. disableSkill() shadow refuses a traversal entry.path
 *   5. disableSkill() mirror refuses to delete outside the mirror root
 *   6. enableSkill() refuses a traversal entry.path
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { importSkills } from '../../src/import/importer.mjs';
import { disableSkill, enableSkill } from '../../src/sync/disabler.mjs';
import {
  BACKSLASH_ESCAPE_FILE,
  BACKSLASH_NAME,
  ESCAPE_FILE,
  LEGIT_NAME,
  SANDBOX,
  TRAVERSAL_NAME,
  assert,
  assertEqual,
  candidate,
  cleanTmp,
  seedSandbox,
  summary,
  writeSkill,
} from './helpers.mjs';

// ── 1. importSkills rejects a traversal name ───────────────────────────────────

console.log('\n=== 1. importSkills rejects traversal name ===');

cleanTmp();
const skillsDir = seedSandbox();
const src1 = resolve(SANDBOX, 'source-1', 'SKILL.md');
writeSkill(src1, TRAVERSAL_NAME);

const result1 = importSkills([candidate(src1, TRAVERSAL_NAME)], { skillsDir, force: true });

assertEqual(result1.imported, 0, 'traversal import is not imported');
assertEqual(result1.rejected, 1, 'traversal import is rejected');
assertEqual(result1.items[0].status, 'rejected', 'item status is rejected');
assert(result1.items[0].issues?.some((i) => i.field === 'path'), 'rejection is flagged as a path issue');
assert(!existsSync(ESCAPE_FILE), `nothing written outside the skills directory (${ESCAPE_FILE})`);

// ── 2. importSkills imports a legitimate name as before ────────────────────────

console.log('\n=== 2. importSkills imports legitimate name ===');

const src2 = resolve(SANDBOX, 'source-2', 'SKILL.md');
writeSkill(src2, LEGIT_NAME);

const result2 = importSkills([candidate(src2, LEGIT_NAME)], { skillsDir, force: true });
const legitTarget = resolve(skillsDir, 'backend', 'api-design', 'SKILL.md');

assertEqual(result2.imported, 1, 'legitimate import succeeds');
assertEqual(result2.items[0].status, 'imported', 'legitimate item status is imported');
assertEqual(result2.items[0].targetPath, legitTarget, 'legitimate target path unchanged');
assert(existsSync(legitTarget), 'legitimate SKILL.md written inside the skills directory');
assert(
  readFileSync(legitTarget, 'utf-8') === readFileSync(src2, 'utf-8'),
  'legitimate content copied verbatim',
);

// ── 3. importSkills rejects a backslash traversal name ────────────────────────

console.log('\n=== 3. importSkills rejects backslash traversal name ===');

const src3 = resolve(SANDBOX, 'source-3', 'SKILL.md');
writeSkill(src3, BACKSLASH_NAME);

const result3 = importSkills([candidate(src3, BACKSLASH_NAME)], { skillsDir, force: true });
assertEqual(result3.rejected, 1, 'backslash traversal import is rejected');
assert(!existsSync(BACKSLASH_ESCAPE_FILE), 'nothing written for backslash traversal name');

// ── 4. disableSkill shadow refuses a traversal entry.path ──────────────────────

console.log('\n=== 4. disableSkill shadow refuses traversal path ===');

const mirror4 = resolve(SANDBOX, 'mirror-4');
const escape4 = resolve(SANDBOX, 'escaped-4');
mkdirSync(mirror4, { recursive: true });
// The shadow write targets <root>/<entry.path>; pre-create it so an unguarded
// write actually lands outside the mirror root instead of failing with ENOENT.
mkdirSync(escape4, { recursive: true });

const dis4 = disableSkill(
  mirror4,
  { name: 'backend-escaped', path: '../escaped-4', hash: 'hash4' },
  'shadow',
);
assert(!dis4.success, 'shadow disable refuses the traversal path');
assert(!existsSync(resolve(escape4, 'SKILL.md')), 'no shadow SKILL.md written outside the mirror root');
assert(!existsSync(resolve(escape4, '.skill-router-meta.json')), 'no meta written outside the mirror root');

// ── 5. disableSkill mirror refuses to delete outside the mirror root ───────────

console.log('\n=== 5. disableSkill mirror refuses out-of-root delete ===');

const mirror5 = resolve(SANDBOX, 'mirror-5');
const victim5 = resolve(SANDBOX, 'victim-5');
mkdirSync(mirror5, { recursive: true });
mkdirSync(victim5, { recursive: true });
writeFileSync(resolve(victim5, 'SKILL.md'), 'user content', 'utf-8');
writeFileSync(
  resolve(victim5, '.skill-router-meta.json'),
  JSON.stringify({ source: 'project', managedBy: 'zcode-skill-router', hash: 'h' }),
  'utf-8',
);

const dis5 = disableSkill(
  mirror5,
  { name: 'backend-victim', path: '../victim-5', hash: 'hash5' },
  'mirror',
);
assert(!dis5.success, 'mirror disable refuses the traversal path');
assert(existsSync(resolve(victim5, 'SKILL.md')), 'managed-looking directory outside the root is NOT deleted');

// ── 6. enableSkill refuses a traversal entry.path ──────────────────────────────

console.log('\n=== 6. enableSkill refuses traversal path ===');

const mirror6 = resolve(SANDBOX, 'mirror-6');
const project6 = resolve(SANDBOX, 'project-6');
const escape6 = resolve(SANDBOX, 'escaped-6');
mkdirSync(mirror6, { recursive: true });
mkdirSync(project6, { recursive: true });
// The traversal source lives outside project6, so an unguarded enable finds a
// real file to copy and writes the result outside the mirror root.
mkdirSync(escape6, { recursive: true });
writeFileSync(resolve(escape6, 'SKILL.md'), 'traversal source', 'utf-8');

const en6 = enableSkill(
  mirror6,
  { name: 'backend-escaped', path: '../escaped-6', hash: 'hash6' },
  project6,
);
assert(!en6.success, 'enable refuses the traversal path');
// escaped-6/SKILL.md is this suite's own fixture (the traversal source), so the
// check is that enable did not overwrite it and did not add a meta file.
assert(
  readFileSync(resolve(escape6, 'SKILL.md'), 'utf-8') === 'traversal source',
  'enable did not overwrite the file outside the mirror root',
);
assert(!existsSync(resolve(escape6, '.skill-router-meta.json')), 'enable wrote no meta outside the mirror root');

// ── Cleanup + summary ──────────────────────────────────────────────────────────

cleanTmp();
summary();
