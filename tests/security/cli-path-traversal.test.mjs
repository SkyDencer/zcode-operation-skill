/**
 * CLI path-traversal regression tests — Sub-Phase 6.4 security remediation.
 *
 * End-to-end coverage of the two CLI subcommands that write a skill into
 * `data/skills` using a directory derived from the untrusted SKILL.md
 * frontmatter `name`:
 *
 *   - `skill-router add <SKILL.md>`       (src/cli/add.mjs)
 *   - `skill-router import <source-dir>`   (src/cli/import.mjs)
 *
 * Both were reachable from ordinary CLI usage on a user- or attacker-supplied
 * skill directory. Each command is run in an isolated sandbox cwd with a
 * registered `backend` domain, so a traversal name reaches the write path.
 * (The library-level primitives are covered by `path-traversal.test.mjs`.)
 *
 * This file covers:
 *   1. CLI `add` rejects a traversal name and writes nothing outside
 *   2. CLI `add` still adds a legitimate name
 *   3. CLI `import` rejects a traversal name and writes nothing outside
 *   4. CLI `import` still imports a legitimate name
 */
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ESCAPE_DIR,
  ESCAPE_FILE,
  LEGIT_NAME,
  SANDBOX,
  TRAVERSAL_NAME,
  assert,
  assertEqual,
  cleanTmp,
  runCli,
  seedSandbox,
  summary,
  writeSkill,
} from './helpers.mjs';

cleanTmp();
const skillsDir = seedSandbox();

// ── 1. CLI add rejects a traversal name ───────────────────────────────────────

console.log('\n=== 1. CLI add rejects traversal name ===');

const src1 = resolve(SANDBOX, 'source-1', 'SKILL.md');
writeSkill(src1, TRAVERSAL_NAME);
rmSync(ESCAPE_DIR, { recursive: true, force: true });

const add1 = runCli(['add', src1], SANDBOX);
assert(add1.status !== 0, `add exits non-zero (status ${add1.status})`);
assert(
  /traversal|invalid skill name/i.test(`${add1.stdout}${add1.stderr}`),
  'add reports the traversal rejection',
);
assert(!existsSync(ESCAPE_FILE), 'CLI add wrote nothing outside the skills directory');

// ── 2. CLI add still adds a legitimate name ───────────────────────────────────

console.log('\n=== 2. CLI add accepts legitimate name ===');

const src2 = resolve(SANDBOX, 'source-2', 'SKILL.md');
writeSkill(src2, 'backend-cli-legit');
const add2 = runCli(['add', src2], SANDBOX);

assertEqual(add2.status, 0, 'add exits 0 for a legitimate name');
assert(existsSync(resolve(skillsDir, 'backend', 'cli-legit', 'SKILL.md')), 'legitimate skill added inside the skills directory');

// ── 3. CLI import rejects a traversal name ─────────────────────────────────────

console.log('\n=== 3. CLI import rejects traversal name ===');

const srcDir3 = resolve(SANDBOX, 'source-3');
writeSkill(join(srcDir3, 'SKILL.md'), TRAVERSAL_NAME);
rmSync(ESCAPE_DIR, { recursive: true, force: true });

const imp3 = runCli(['import', srcDir3, '--skills-dir', skillsDir, '--json'], SANDBOX);
assert(imp3.status !== 0, `import exits non-zero (status ${imp3.status})`);
assert(
  /traversal|rejected/i.test(imp3.stdout),
  'import reports the traversal rejection',
);
assert(!existsSync(ESCAPE_FILE), 'CLI import wrote nothing outside the skills directory');

// ── 4. CLI import still imports a legitimate name ─────────────────────────────

console.log('\n=== 4. CLI import accepts legitimate name ===');

const srcDir4 = resolve(SANDBOX, 'source-4');
writeSkill(join(srcDir4, 'SKILL.md'), LEGIT_NAME);
const imp4 = runCli(['import', srcDir4, '--skills-dir', skillsDir, '--json'], SANDBOX);

assertEqual(imp4.status, 0, 'import exits 0 for a legitimate name');
assert(
  existsSync(resolve(skillsDir, 'backend', 'api-design', 'SKILL.md')),
  'legitimate skill imported inside the skills directory',
);

// ── Cleanup + summary ──────────────────────────────────────────────────────────

cleanTmp();
summary();
