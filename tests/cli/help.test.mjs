/**
 * P6-H-020 (Sub-Phase A.6) — `--help` / `-h` on every CLI subcommand.
 *
 * The guarantee under test: `--help` (or `-h`) prints usage and exits 0
 * WITHOUT triggering the real operation. The critical case is
 * `deploy --help`, which before this fix planned, wrote to the mirror,
 * registered the hook, and verified.
 *
 * Method: every subcommand is spawned as a real process with
 * SKILL_ROUTER_ZCODE_DIR pointed at an empty temp directory. After the
 * help invocations:
 *   - the mirror directory is still empty (no writes happened),
 *   - no new deploy snapshots were created in logs/deploys/,
 *   - the no-subcommand invocation still exits 1 (unchanged behaviour).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const BIN = join(PROJECT, 'bin', 'skill-router.mjs');
const DEPLOYS_DIR = join(PROJECT, 'logs', 'deploys');

const SUBCOMMANDS = [
  'list', 'add', 'remove', 'validate', 'reindex', 'benchmark', 'stats',
  'analytics', 'import', 'corpus', 'sync', 'deploy', 'sources', 'verify',
  'doctor', 'feedback', 'health', 'tune', 'help',
];

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

/**
 * Spawn the CLI and capture stdout + exit code.
 *
 * @param {string[]} args
 * @param {string} zcodeDir
 * @returns {Promise<{code: number|null, out: string}>}
 */
function run(args, zcodeDir) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: PROJECT,
      env: { ...process.env, SKILL_ROUTER_ZCODE_DIR: zcodeDir },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', (code) => res({ code, out }));
  });
}

// ── Per-subcommand: --help and -h print usage, exit 0, no side effects ───────

console.log('\n=== 1. Every subcommand supports --help and -h ===');
const zcodeDir = mkdtempSync(join(tmpdir(), 'sr-help-test-'));
const snapshotsBefore = existsSync(DEPLOYS_DIR) ? readdirSync(DEPLOYS_DIR) : [];

for (const sub of SUBCOMMANDS) {
  for (const flag of ['--help', '-h']) {
    const { code, out } = await run([sub, flag], zcodeDir);
    assert(code === 0, `${sub} ${flag} exits 0`);
    assert(out.includes('Usage'), `${sub} ${flag} prints usage text`);
  }
}

// corpus with a subcommand: its own handler must also print usage and stop.
const corpusFetch = await run(['corpus', 'fetch', '--help'], zcodeDir);
assert(corpusFetch.code === 0 && corpusFetch.out.includes('Usage'),
  'corpus fetch --help exits 0 and prints usage');

// ── Top level: --help lists all subcommands; -h works; no-arg unchanged ──────

console.log('\n=== 2. Top-level help ===');
const top = await run(['--help'], zcodeDir);
assert(top.code === 0, 'skill-router --help exits 0');
const missing = SUBCOMMANDS.filter((s) => !top.out.includes(s));
assert(missing.length === 0,
  `top-level --help lists every subcommand${missing.length ? ` (missing: ${missing.join(',')})` : ''}`);

const topH = await run(['-h'], zcodeDir);
assert(topH.code === 0 && topH.out.includes('Usage'), 'skill-router -h exits 0 and prints usage');

const none = await run([], zcodeDir);
assert(none.code === 1, 'no subcommand still exits 1 (unchanged behaviour)');

// ── Side-effect checks: help must not have touched anything ──────────────────

console.log('\n=== 3. No side effects ===');
assert(readdirSync(zcodeDir).length === 0,
  `help invocations wrote nothing to the mirror dir (SKILL_ROUTER_ZCODE_DIR)`);

const snapshotsAfter = existsSync(DEPLOYS_DIR) ? readdirSync(DEPLOYS_DIR) : [];
assert(snapshotsAfter.length === snapshotsBefore.length,
  'help invocations created no deploy snapshots');
rmSync(zcodeDir, { recursive: true, force: true });

console.log('\n=== Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) process.exit(1);
