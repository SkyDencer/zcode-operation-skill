/**
 * Regression tests — Sub-Phase 6.4 static audit (Critical: require() in ESM modules).
 *
 * Context: every module in this repository is ESM (package.json "type": "module",
 * all sources are .mjs), where `require` is not defined. Two CLI modules called
 * `require('node:fs')` inside a try/catch whose catch returned a fallback value,
 * so the ReferenceError was swallowed and the commands silently reported the
 * wrong thing:
 *
 *   src/cli/add.mjs    getRegisteredDomains() -> always [] -> every valid skill was
 *                      rejected with "Unknown domain(s): <domain>" and exit 1.
 *   src/cli/doctor.mjs isWritable()           -> always 'no' -> the ZCode skills
 *                      mirror was reported as non-writable even when it was.
 *
 * Verified pre-fix (Sub-Phase 6.4 audit):
 *   node bin/skill-router.mjs add <valid backend SKILL.md>
 *     -> "Validation failed for backend-audit-probe: [domains] Unknown domain(s): backend", exit 1
 *   node bin/skill-router.mjs doctor | grep Writable
 *     -> "Writable  no"   (a direct fs write to the same directory succeeded)
 *
 * This file covers:
 *   - a static scan: no require() call anywhere in the .mjs sources
 *   - a functional check: `add --dry-run` scores a valid skill 100/100
 *   - a functional check: `doctor` reports the mirror as writable
 */
import { readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log('  ✓', message);
  } else {
    failed++;
    console.error('  ✗', message);
  }
}

function listMjs(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMjs(full));
    else if (entry.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

console.log('\n=== ESM require() Safety Tests ===\n');

// 1. Static scan — no require() call in any .mjs module
console.log('1. Static scan for require() in .mjs modules');
const roots = ['src', 'hooks', 'bin', 'tests', 'scripts'].filter((r) => {
  try {
    readdirSync(r);
    return true;
  } catch {
    return false;
  }
});
const offenders = [];
const SELF = 'tests/cli/esm-require.test.mjs'; // this file embeds the pattern on purpose
for (const root of roots) {
  for (const file of listMjs(root)) {
    const rel = file.replace(/\\/g, '/');
    if (rel === SELF) continue;
    const src = readFileSync(file, 'utf8');
    // Ignore the word "required" inside comments/strings; match a call form.
    if (/(^|[^.\w])require\s*\(/.test(src)) {
      offenders.push(rel);
    }
  }
}
assert(offenders.length === 0, `no require( call in .mjs sources (checked ${roots.length} roots)${offenders.length ? ': ' + offenders.join(', ') : ''}`);

// 2. add CLI must not report an existing domain as unknown
//
// The domain registry (`data/domains/`) is a GENERATED directory and is listed
// in .gitignore, so it does not exist in a fresh clone until `build-index` has
// run. The check therefore provisions its own registry in a temp cwd instead
// of depending on whatever the developer machine happens to have.
console.log('\n2. `add --dry-run` validates against a provisioned domain registry');
const workDir = mkdtempSync(join(tmpdir(), 'skill-router-add-'));
const skillPath = join(workDir, 'SKILL.md');
const body = Array.from({ length: 120 }, (_, i) => `token${i}`).join(' ');
writeFileSync(
  skillPath,
  `---\nname: backend-esm-audit-probe\ndescription: ${'A'.repeat(60)}\nkeywords:\n  - probe\n  - audit\n  - esm\ndomains:\n  - backend\n---\n\n${body}\n`,
  'utf-8'
);
mkdirSync(join(workDir, 'data', 'domains', 'backend'), { recursive: true });

try {
  const out = execFileSync(
    process.execPath,
    [resolve('bin/skill-router.mjs'), 'add', skillPath, '--dry-run'],
    { encoding: 'utf-8', cwd: workDir }
  );
  assert(/score: 100\/100/.test(out), `add --dry-run reports 100/100 for a valid backend skill (got: ${out.trim()})`);
  assert(!/Unknown domain/.test(out), 'add --dry-run does not report "Unknown domain"');
} catch (err) {
  assert(false, `add --dry-run exits 0 (${String(err.stdout || '') + String(err.message).split('\n')[0]})`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

// 3. doctor must report a writable mirror as writable
console.log('\n3. `doctor` writability probe');
const zcodeDir = resolve(process.env.USERPROFILE || process.env.HOME || '.', '.zcode', 'skills');
try {
  const out = execFileSync(
    process.execPath,
    ['bin/skill-router.mjs', 'doctor'],
    { encoding: 'utf-8', env: { ...process.env, SKILL_ROUTER_ZCODE_DIR: zcodeDir } }
  );
  const line = out.split(/\r?\n/).find((l) => l.trim().startsWith('Writable'));
  assert(!!line, 'doctor prints a Writable row');
  assert(!!line && /\byes\b/.test(line), `doctor reports the mirror as writable (got: ${line ? line.trim() : 'n/a'})`);
} catch (err) {
  const out = String(err.stdout || '');
  const line = out.split(/\r?\n/).find((l) => l.trim().startsWith('Writable'));
  assert(!!line && /\byes\b/.test(line), `doctor reports the mirror as writable (got: ${line ? line.trim() : 'n/a'})`);
}

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) process.exit(1);
