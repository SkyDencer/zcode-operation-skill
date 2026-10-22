/**
 * P6-H-016: data-producing fs reads must fail explicitly.
 *
 * Every read function that turns directory/file errors into DATA must
 * tolerate ONLY ENOENT on an optional dir/file and surface every other
 * error (EACCES, EPERM, EIO, ...) as a named error. These tests exercise
 * the reader seams of all six affected modules:
 *
 *   src/telemetry/feedback.mjs   — readDecisions     (optional log dir)
 *   src/telemetry/signals.mjs    — readSignals       (optional log dir)
 *   src/telemetry/outcomes.mjs   — correlateFromLogs (optional log dir)
 *   src/analytics/reader.mjs     — readLogs          (optional log dir)
 *   src/import/scanner.mjs       — scanSource        (REQUIRED source dir)
 *   src/deploy/planner.mjs       — planDeploy        (optional data/skills dir)
 *
 * Required-dir ENOENT still throws (scanner root), optional-dir ENOENT
 * yields [] / a plan, and permission-denied always throws a named error
 * with the original err.code preserved.
 */
import { readdir as fspReaddir, readFile as fspReadFile } from 'node:fs/promises';
import * as nodeFs from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readDecisions } from '../../src/telemetry/feedback.mjs';
import { readSignals } from '../../src/telemetry/signals.mjs';
import { correlateFromLogs } from '../../src/telemetry/outcomes.mjs';
import { readLogs } from '../../src/analytics/reader.mjs';
import { scanSource } from '../../src/import/scanner.mjs';
import { planDeploy } from '../../src/deploy/planner.mjs';

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

function assertEqual(actual, expected, label) {
  const ok = Array.isArray(actual) && Array.isArray(expected)
    ? actual.length === expected.length && actual.every((v, i) => v === expected[i])
    : actual === expected;
  assert(ok, ok ? label : `${label} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

function cleanTmp() {
  if (nodeFs.existsSync(TMP)) nodeFs.rmSync(TMP, { recursive: true, force: true });
  nodeFs.mkdirSync(TMP, { recursive: true });
}

/** Error with a Node-style .code, like a real fs failure. */
function errWith(code) {
  const e = new Error(`${code}: permission denied`);
  e.code = code;
  return e;
}

/** Async reader seam: omit a fn to use the real fs/promises default. */
function pReader({ readdir, readFile } = {}) {
  return {
    readdir: readdir ?? fspReaddir,
    readFile: readFile ?? fspReadFile,
  };
}

/** Sync reader seam: omit a fn to use the real node:fs default. */
function sReader({ readdirSync, readFileSync, statSync, existsSync } = {}) {
  return {
    readdirSync: readdirSync ?? nodeFs.readdirSync,
    readFileSync: readFileSync ?? nodeFs.readFileSync,
    statSync: statSync ?? nodeFs.statSync,
    existsSync: existsSync ?? nodeFs.existsSync,
  };
}

/** Run an async fn and assert it rejects with a named error. */
async function assertNamedRejects(fn, code, msgPart, label) {
  try {
    await fn();
    assert(false, `${label} (expected ${code}, resolved instead)`);
  } catch (err) {
    const codeOk = code === null || err.code === code;
    assert(
      codeOk && String(err.message).includes(msgPart),
      codeOk ? label : `${label} — wrong code: ${err.code}`,
    );
  }
}

/** Run a sync fn and assert it throws a named error. */
function assertNamedThrows(fn, code, msgPart, label) {
  try {
    fn();
    assert(false, `${label} (expected ${code ?? 'a throw'}, returned instead)`);
  } catch (err) {
    const codeOk = code === null || err.code === code;
    assert(
      codeOk && String(err.message).includes(msgPart),
      codeOk ? label : `${label} — wrong code: ${err.code}`,
    );
  }
}

// ── 1. readDecisions (optional log dir) ───────────────────────────────────────

console.log('\n=== 1. readDecisions ===');

const missingDir = join(TMP, 'no-such-log-dir');
assertEqual(await readDecisions({ logDir: missingDir }), [], 'ENOENT on optional log dir returns []');

await assertNamedRejects(
  () => readDecisions({ logDir: TMP, reader: pReader({ readdir: () => Promise.reject(errWith('EACCES')) }) }),
  'EACCES', 'log directory',
  'readdir EACCES surfaces a named error',
);

await assertNamedRejects(
  () => readDecisions({
    logDir: TMP,
    reader: pReader({
      readdir: () => Promise.resolve(['routing-20260101.jsonl']),
      readFile: () => Promise.reject(errWith('EACCES')),
    }),
  }),
  'EACCES', 'failed to read',
  'readFile EACCES surfaces a named error',
);

// ── 2. readSignals (optional log dir) ─────────────────────────────────────────

console.log('\n=== 2. readSignals ===');

assertEqual(await readSignals({ logDir: missingDir }), [], 'ENOENT on optional log dir returns []');

await assertNamedRejects(
  () => readSignals({ logDir: TMP, reader: pReader({ readdir: () => Promise.reject(errWith('EACCES')) }) }),
  'EACCES', 'log directory',
  'readdir EACCES surfaces a named error',
);

// ── 3. correlateFromLogs (optional log dir) ───────────────────────────────────

console.log('\n=== 3. correlateFromLogs ===');

const decisions = [{
  ts: new Date().toISOString(),
  mode: 'implicit',
  router: null,
  tier: 'bm25',
  selectedSkills: [],
  confidence: 0.5,
  promptHash: 'sha256:0',
  latencyMs: { total: 1 },
}];

const outcomes = await correlateFromLogs(decisions, { logDir: missingDir });
assertEqual(outcomes.length, 1, 'ENOENT on optional log dir is tolerated (one decision classified)');

await assertNamedRejects(
  () => correlateFromLogs(decisions, { logDir: TMP, reader: pReader({ readdir: () => Promise.reject(errWith('EACCES')) }) }),
  'EACCES', 'signals directory',
  'readdir EACCES surfaces a named error',
);

// ── 4. readLogs (optional log dir, sync seam) ────────────────────────────────

console.log('\n=== 4. readLogs ===');

assertEqual(readLogs(missingDir), [], 'ENOENT on optional log dir returns []');

assertNamedThrows(
  () => readLogs(TMP, sReader({ readdirSync: () => { throw errWith('EACCES'); } })),
  'EACCES', 'log directory',
  'readdirSync EACCES surfaces a named error',
);

assertNamedThrows(
  () => readLogs(TMP, sReader({
    readdirSync: () => ['app-20260101.jsonl'],
    readFileSync: () => { throw errWith('EACCES'); },
  })),
  'EACCES', 'failed to read',
  'readFileSync EACCES surfaces a named error',
);

// ── 5. scanSource (REQUIRED source dir) ───────────────────────────────────────

console.log('\n=== 5. scanSource ===');

await assertNamedRejects(
  () => scanSource(missingDir),
  null, 'Source directory not found',
  'ENOENT on required source dir still throws',
);

cleanTmp();
const scanRoot = join(TMP, 'scan-root');
nodeFs.mkdirSync(join(scanRoot, 'demo-skill'), { recursive: true });
nodeFs.writeFileSync(join(scanRoot, 'demo-skill', 'SKILL.md'), '---\nname: demo\n---\nbody\n', 'utf-8');

await assertNamedRejects(
  () => scanSource(scanRoot, { readdir: () => Promise.reject(errWith('EACCES')) }),
  'EACCES', 'cannot read directory',
  'readdir EACCES surfaces a named error',
);

// ── 6. planDeploy (optional data/skills dir, sync seam) ───────────────────────

console.log('\n=== 6. planDeploy ===');

const project = join(TMP, 'deploy-project');
const mirror = join(TMP, 'deploy-mirror');
nodeFs.mkdirSync(join(project, 'router-skills'), { recursive: true });
nodeFs.mkdirSync(mirror, { recursive: true });

// data/skills is optional: a project without it plans normally.
const plan = planDeploy(project, mirror, { routerSkillsDir: join(project, 'router-skills') });
assertEqual(plan.routers.add.length, 0, 'ENOENT on optional data/skills still plans normally');

// data/skills unreadable: the plan must fail, not complete silently.
const skillsDir = join(project, 'data', 'skills');
nodeFs.mkdirSync(join(skillsDir, 'a-skill'), { recursive: true });
nodeFs.writeFileSync(join(skillsDir, 'a-skill', 'SKILL.md'), '---\nname: a\n---\nbody\n', 'utf-8');

assertNamedThrows(
  () => planDeploy(project, mirror, {
    routerSkillsDir: join(project, 'router-skills'),
    reader: sReader({
      readdirSync: (p, ...rest) => {
        if (p === skillsDir) throw errWith('EACCES');
        return nodeFs.readdirSync(p, ...rest);
      },
    }),
  }),
  'EACCES', 'cannot read directory',
  'readdirSync EACCES on data/skills surfaces a named error',
);

// ── Cleanup + summary ──────────────────────────────────────────────────────────

cleanTmp();

console.log('\n=== Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) process.exit(1);
