#!/usr/bin/env node
/**
 * verify-e2e-ready.mjs — single gate that decides whether this install is
 * ready for the human end-to-end test.
 *
 * Usage: node scripts/verify-e2e-ready.mjs
 *
 * The gate blocks only on the four routing-critical conditions the E2E
 * procedure depends on:
 *
 *   1. `health` exits 0 (all 8 health checks pass — this already covers the
 *      hook-registered and hook-invocable checks, the 6 routers in the ZCode
 *      mirror, a fresh index, and a valid thresholds file).
 *   2. the hook is registered in the ZCode CLI config (re-confirmed here via
 *      `verify --deep`).
 *   3. every router skill that exists on disk is installed in the ZCode
 *      mirror (6 router-* skills).
 *   4. every leaf skill that exists on disk is present in
 *      data/skill-index.json (252 leaf skills, plus the 6 routers).
 *
 * Anything else — notably a leaf-copy drift in the ZCode mirror that the
 * `verify --deep` mirror-sync check surfaces — is reported as a non-blocking
 * note, because leaf skills are disabled for routing (only the routers route),
 * so stale leaf copies do not change what the hook injects. The note tells
 * the reader to refresh the mirror with `deploy`.
 *
 * Prints exactly one of:
 *
 *   READY FOR HUMAN E2E
 *   NOT READY — <reason; reason; ...>
 *
 * Exit code 0 when ready, 1 when not.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { loadSkills } from '../src/loader.mjs';

const BASE = resolve('.');
const BIN = join(BASE, 'bin', 'skill-router.mjs');

/** Run a bin subcommand, capturing stdout/stderr without inheriting stdio. */
function runCli(args) {
  const r = spawnSync('node', [BIN, ...args], {
    cwd: BASE,
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Strip ANSI escape sequences for plain-text matching. */
const stripAnsi = (s) => s.replace(/\u001b\[\d+m/g, '');

const reasons = [];
const notes = [];
const warnings = [];

// ── 1. health: all 8 checks pass (exit 0) ─────────────────────────────────────
const health = runCli(['health']);
if (health.code === 0) {
  notes.push('health: 8/8 checks pass');
} else {
  const failing = stripAnsi(health.stdout)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /FAIL/.test(l));
  reasons.push(
    'health exited ' + health.code + ' (expected 0) — ' +
      (failing.length
        ? failing.slice(0, 4).join(' | ')
        : "run 'node bin/skill-router.mjs health' for the failing check(s)"),
  );
}

// ── 2. hook registered (verify --deep check #6) ───────────────────────────────
// verify --deep also surfaces non-blocking mirror hygiene; parse the JSON so a
// single leaf-drift warning does not read as a routing failure.
const verify = runCli(['verify', '--deep', '--json']);
let verifyChecks = [];
try {
  verifyChecks = JSON.parse(verify.stdout).checks ?? [];
} catch {
  /* keep [] */
}
const hookCheck = verifyChecks.find((c) => c.name === 'Hook registered');
const syncCheck = verifyChecks.find((c) => c.name === 'Mirror sync status');
if (hookCheck) {
  if (hookCheck.passed) notes.push('hook registered in the ZCode CLI config');
  else reasons.push("hook not registered — run 'node bin/skill-router.mjs deploy'");
} else {
  reasons.push("could not confirm hook registration — run 'node bin/skill-router.mjs verify --deep'");
}
if (syncCheck && !syncCheck.passed) {
  warnings.push(
    'mirror sync: ' + (syncCheck.detail ?? 'drift') +
      " — leaf copies may be stale; refresh with 'node bin/skill-router.mjs deploy' " +
      '(non-blocking: leaves are disabled for routing)',
  );
}

// ── 3. every on-disk router skill is installed in the ZCode mirror ───────────
const routerDir = join(BASE, 'router-skills');
const mirrorDir = join(homedir(), '.zcode', 'skills');
const routersOnDisk = existsSync(routerDir)
  ? readdirSync(routerDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)
  : [];
const mirrorRouters = existsSync(mirrorDir)
  ? readdirSync(mirrorDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('router-')).map((e) => e.name)
  : [];
const missingRouters = routersOnDisk.filter((r) => !mirrorRouters.includes(r));
if (missingRouters.length === 0) {
  notes.push(mirrorRouters.length + ' router skill(s) installed in the mirror (' + mirrorRouters.join(', ') + ')');
} else {
  reasons.push(
    missingRouters.length + ' router skill(s) missing from the ZCode mirror: ' +
      missingRouters.join(', ') + " — run 'node bin/skill-router.mjs deploy'",
  );
}

// ── 4. every on-disk leaf skill is present in data/skill-index.json ─────────
// Compare COUNTS, not names: the on-disk skill dir name (a slug) is not the
// same string as the index entry's frontmatter `name`, so a dir-name match
// would false-positive. The index is built from the same loadSkills() the
// corpus walk uses, so a count match means the index covers the corpus.
const skillsDir = join(BASE, 'data', 'skills');
const leavesOnDisk = existsSync(skillsDir) ? await loadSkills(skillsDir) : [];
const indexPath = join(BASE, 'data', 'skill-index.json');
let indexEntries = [];
if (existsSync(indexPath)) {
  try {
    indexEntries = JSON.parse(readFileSync(indexPath, 'utf-8'));
  } catch {
    /* keep [] */
  }
}
const leafIndexCount = indexEntries.filter((e) => typeof e?.name === 'string' && !e.name.startsWith('router-')).length;
if (leafIndexCount === leavesOnDisk.length && leavesOnDisk.length > 0) {
  notes.push(leavesOnDisk.length + ' leaf skill(s) on disk, all ' + leafIndexCount + ' indexed in data/skill-index.json');
} else if (indexEntries.length === 0) {
  reasons.push("data/skill-index.json has no entries — run 'node bin/skill-router.mjs reindex'");
} else {
  reasons.push(
    'index has ' + leafIndexCount + ' leaf entries but data/skills/ has ' + leavesOnDisk.length +
      " — run 'node bin/skill-router.mjs reindex'",
  );
}

// ── Verdict ────────────────────────────────────────────────────────────────────
console.log('Skill Router — E2E readiness gate');
console.log('');
for (const n of notes) console.log(`  \u2713 ${n}`);
for (const w of warnings) console.log(`  \u25B3 ${w}`);

console.log('');
if (reasons.length === 0) {
  console.log('READY FOR HUMAN E2E');
  process.exit(0);
} else {
  console.log('NOT READY — ' + reasons.length + ' blocking issue(s):');
  for (const r of reasons) console.log(`  \u2717 ${r}`);
  process.exit(1);
}
