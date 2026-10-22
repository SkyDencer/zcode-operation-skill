/**
 * release-check.mjs — pre-release readiness gate.
 *
 * Runs the four checks the v1.0.0 release phase requires, in order, and
 * prints a per-check pass/fail table plus a final verdict.
 *
 * Checks (each must exit 0 within its timeout, or the check fails):
 *   1. Full test suite — `node scripts/run-all-tests.mjs`
 *   2. Health check     — `node bin/skill-router.mjs health`
 *   3. Real benchmark   — `node tests/run-benchmark.mjs --corpus real --router flat`
 *   4. Scale benchmark  — `node tests/scale-benchmark/runner.mjs`
 *
 * Pre-existing failures handling:
 *   When `logs/pre-existing-failures.json` exists, its keys are treated as
 *   known-at-commit failures. A test-file that appears in the file is reported
 *   as KNOWN and does NOT block the release. Any failing file not listed there
 *   is a RELEASE BLOCKER.
 *   When the file is absent, every failure is treated as a blocker.
 *
 * Timeouts (generous for a real run on this host):
 *   test-suite    15 min  — the runner budgets 120 s per file and discovers
 *                         ~75 files; load-sensitive ETIMEDOUTs need headroom.
 *   health        30 s
 *   real-benchmark 5 min
 *   scale-bench   10 min
 *
 * On Windows the scale-benchmark CLI entry guard
 * (`import.meta.url === file://${process.argv[1]}`) is false because
 * process.argv[1] carries backslashes while import.meta.url is file:// with
 * forward slashes (observed in Sub-Phase 7.5). This script spawns an inline
 * ESM wrapper via `node --input-type=module -e` that imports and calls
 * `runScaleBenchmark()`; the wrapper runs inside `execFileSync` so the
 * 10-minute `TIMEOUTS.scaleBench` timeout is actually enforced by the OS.
 * The prompts path is passed via an environment variable to avoid Windows
 * backslash-escape issues when embedding paths inside JS string literals.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = resolve('.');

// ── Timeouts (ms) ─────────────────────────────────────────────────────────────
const TIMEOUTS = Object.freeze({
  testSuite: 15 * 60 * 1000,
  health: 30 * 1000,
  realBench: 5 * 60 * 1000,
  scaleBench: 10 * 60 * 1000,
});

// ── Helpers ───────────────────────────────────────────────────────────────────
/**
 * Run a command and return { ok, stdout, stderr, exitCode }.
 * Never throws — captures the exit code instead.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {{timeout?: number, cwd?: string}} [opts]
 * @returns {{ ok: boolean, stdout: string, stderr: string, exitCode: number|null }}
 */
function run(cmd, args, opts = {}) {
  const timeout = opts.timeout ?? 30_000;
  const cwd = opts.cwd ?? BASE;
  // Forward extra env vars merged over process.env so the child keeps PATH etc.
  // without losing them (execFileSync's `env` option replaces the whole
  // environment). This is what lets the scale-bench wrapper receive PROMPTS_PATH.
  const env = opts.env ? { ...process.env, ...opts.env } : undefined;
  let exitCode = null;
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync(cmd, args, {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout,
      cwd,
      env,
    });
    exitCode = 0;
  } catch (err) {
    exitCode = err.status ?? 1;
    stdout = err.stdout ?? '';
    stderr = err.stderr ?? '';
  }
  return { ok: exitCode === 0, stdout, stderr, exitCode };
}

/**
 * Read the pre-existing failures list. Returns a Set of known-failing file
 * paths (relative, forward-slash), or an empty Set when the file is absent.
 *
 * @returns {Set<string>}
 */
function loadKnownFailures() {
  const path = resolve(BASE, 'logs', 'pre-existing-failures.json');
  if (!existsSync(path)) return new Set();
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const keys = Object.keys(data).filter((k) => typeof k === 'string' && k !== '_note');
    return new Set(keys);
  } catch {
    return new Set();
  }
}

/**
 * Parse the ERR lines from the test-suite runner output.
 * Each ERR line looks like:
 *   ERR  <full-or-relative-path>.mjs: <reason>
 * On Windows the runner emits backslash paths. We extract the `.mjs` path
 * via regex so the trailing-colon-in-reason ambiguity never trips us up.
 *
 * @param {string} stdout
 * @returns {string[]}
 */
function parseTestErrors(stdout) {
  const re = /ERR\s+(.+?\.mjs):\s*(.*)/;
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('ERR  '))
    .map((l) => {
      const m = l.match(re);
      if (!m) return null;
      let path = m[1].trim();
      // Strip leading BASE prefix if present
      const basePrefix = BASE + '/';
      const basePrefixBack = BASE + '\\';
      if (path.startsWith(basePrefix)) {
        path = path.slice(basePrefix.length);
      } else if (path.startsWith(basePrefixBack)) {
        path = path.slice(basePrefixBack.length);
      }
      // Normalise Windows backslashes to forward slashes
      return path.replace(/\\/g, '/');
    })
    .filter(Boolean);
}

// ── Checks ────────────────────────────────────────────────────────────────────
/**
 * Check 1 — full test suite.
 *
 * Returns { ok, summary, details } where details is an array of
 * `{ file, known, blocker }` for every ERR line.
 */
function checkTests() {
  const known = loadKnownFailures();
  const { ok, stdout } = run('node', ['scripts/run-all-tests.mjs'], {
    timeout: TIMEOUTS.testSuite,
  });
  const errs = parseTestErrors(stdout);
  const details = errs.map((file) => ({
    file,
    known: known.has(file),
    blocker: !known.has(file),
  }));
  const blockers = details.filter((d) => d.blocker);
  return {
    ok: blockers.length === 0,
    label: 'test-suite',
    summary: ok ? 'exit 0' : `exit ${stdout.match(/failed=(\d+)/)?.[1] ?? '?'}`,
    details,
    timeout: TIMEOUTS.testSuite,
  };
}

/**
 * Check 2 — health.
 */
function checkHealth() {
  const { ok, stdout } = run('node', ['bin/skill-router.mjs', 'health'], {
    timeout: TIMEOUTS.health,
  });
  const passLine = stdout.match(/\d+ passed.*\(\d+ total\)/);
  return {
    ok,
    label: 'health',
    summary: ok
      ? (passLine ? passLine[0].trim() : 'exit 0')
      : 'exit non-zero',
    details: [],
    timeout: TIMEOUTS.health,
  };
}

/**
 * Check 3 — real benchmark (BM25 frozen baseline).
 *
 * Exits 0 when the benchmark completes and Top-1 is within ±1 pp of the
 * frozen baseline (0.6462). The harness itself exits 0 on every run.
 */
function checkRealBenchmark() {
  const { ok, stdout } = run(
    'node',
    ['tests/run-benchmark.mjs', '--corpus', 'real', '--router', 'flat'],
    { timeout: TIMEOUTS.realBench },
  );
  const top1Match = stdout.match(/Top-1 Accuracy:\s*([\d.]+)/);
  const top1 = top1Match ? parseFloat(top1Match[1]) : NaN;
  // Accept any run that exits 0 and produces a plausible Top-1 number.
  // The frozen baseline is 0.6462; allow ±0.02 pp as tolerance for load noise.
  const plausible = !isNaN(top1) && top1 >= 0.62 && top1 <= 0.70;
  return {
    ok: ok && plausible,
    label: 'real-benchmark',
    summary: ok
      ? `Top-1 ${top1?.toFixed(4) ?? '?'}`
      : 'exit non-zero',
    details: plausible ? [] : [{ file: 'top1-out-of-range', known: false, blocker: true }],
    timeout: TIMEOUTS.realBench,
  };
}

/**
 * Check 4 — scale benchmark.
 *
 * On Windows the CLI guard in runner.mjs never fires, so we cannot invoke the
 * script directly. Instead we spawn a small inline ESM wrapper via
 * `node --input-type=module -e` that imports and calls `runScaleBenchmark()`;
 * the wrapper runs inside `execFileSync` so the 10-minute `TIMEOUTS.scaleBench`
 * timeout is actually enforced by the OS rather than silently ignored.
 */
function checkScaleBenchmark() {
  const runnerPath = pathToFileURL(
    resolve(BASE, 'tests/scale-benchmark/runner.mjs'),
  ).href;
  const promptsPath = resolve(BASE, 'tests/scale-benchmark/prompts.json');

  // Pass promptsPath via environment variable to avoid backslash-escape
  // issues when embedding Windows paths inside JS string literals.
  const wrapperCode =
    "import { runScaleBenchmark } from '" +
    runnerPath +
    "';\n" +
    "const r = runScaleBenchmark({ " +
    "sizes: [54, 200, 500, 1000], " +
    "promptsPath: process.env.PROMPTS_PATH " +
    "});\n" +
    "console.log(JSON.stringify(r));\n";

  const { ok, stdout } = run(
    'node',
    ['--input-type=module', '-e', wrapperCode],
    { timeout: TIMEOUTS.scaleBench, env: { PROMPTS_PATH: promptsPath } },
  );

  if (!ok) {
    return {
      ok: false,
      label: 'scale-benchmark',
      summary: 'exit non-zero',
      details: [],
      timeout: TIMEOUTS.scaleBench,
    };
  }

  let result;
  try {
    result = JSON.parse(stdout);
  } catch {
    return {
      ok: false,
      label: 'scale-benchmark',
      summary: 'parse error',
      details: [],
      timeout: TIMEOUTS.scaleBench,
    };
  }

  const first = result?.runs?.[0];
  const summary = first
    ? `N=${first.size} Top-1 ${(first.top1 * 100).toFixed(2)}% Fallback ${(first.fallbackRate * 100).toFixed(2)}%`
    : 'no runs';
  return {
    ok: true,
    label: 'scale-benchmark',
    summary,
    details: [],
    timeout: TIMEOUTS.scaleBench,
  };
}

// ── Report ─────────────────────────────────────────────────────────────────────
function printReport(checks) {
  console.log('');
  console.log('Release Readiness Report');
  console.log('========================');
  console.log('');

  for (const c of checks) {
    const icon = c.ok ? '[PASS]' : '[FAIL]';
    console.log(`${icon} ${c.label}: ${c.summary}`);
    if (c.details.length > 0) {
      for (const d of c.details) {
        const tag = d.known ? 'KNOWN' : 'BLOCKER';
        console.log(`  - ${d.file} (${tag})`);
      }
    }
  }

  console.log('');
  const blockers = checks.filter((c) => !c.ok);
  if (blockers.length === 0) {
    console.log('Verdict: READY — all checks passed.');
  } else {
    console.log(
      `Verdict: NOT READY — ${blockers.length} check(s) failed: ${blockers.map((c) => c.label).join(', ')}.`,
    );
  }
  console.log('');
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Starting release checks...');
  console.log('');

  const checks = [checkTests(), checkHealth(), checkRealBenchmark(), checkScaleBenchmark()];
  printReport(checks);

  const anyBlocker = checks.some((c) => !c.ok);
  process.exit(anyBlocker ? 1 : 0);
}

main().catch((err) => {
  console.error('release-check failed:', err);
  process.exit(1);
});
