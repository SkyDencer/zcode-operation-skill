/**
 * Coverage runner: runs every test file in the package.json `test` chain under
 * Node's built-in `--experimental-test-coverage` and aggregates per-module
 * line / branch / function coverage into a single JSON report.
 *
 * Usage:
 *   node tests/run-coverage.mjs                    (run the whole test chain)
 *   node tests/run-coverage.mjs --single <file>    (run one test file)
 *   node tests/run-coverage.mjs --only <substr>    (run files matching a substring)
 *
 * Output:
 *   logs/coverage-YYYY-MM-DD.json   aggregated per-module coverage report
 *   stdout                          human-readable summary table
 *
 * Implementation notes (fixes the defects recorded in
 * docs/reports/phase-6-test-audit.md section 8.2 and 8.3):
 *   - Modules are keyed by their full repo-relative path, read from the `SF:`
 *     record of the LCOV reporter. The previous version parsed the text table,
 *     which carries only a basename, so the repo's three `planner.mjs`, three
 *     `writer.mjs` and four `reporter.mjs` modules masked each other.
 *   - Coverage is aggregated as a UNION of covered lines / functions / branches
 *     across test files, not as a max of per-file percentages.
 *   - Assertion counts come from each file's own output, not the test runner's
 *     file count (which is always 1 for a custom-harness file).
 *
 * No external dependencies. Each file runs as its own process so one crash
 * cannot take the whole report down. Parsing and aggregation live in
 * tests/coverage/aggregate.mjs.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLcov, parseSelfCounts, aggregate, printSummary } from './coverage/aggregate.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(__filename, '..', '..');
const LOGS_DIR = join(PROJECT_ROOT, 'logs');
const LCOV_TMP = join(LOGS_DIR, 'coverage-run.lcov');
const PER_FILE_TIMEOUT_MS = 300_000;

/**
 * Collect the test files from the package.json `test` script.
 * @returns {string[]}
 */
function getTestFiles() {
  const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
  const matches = (pkg.scripts.test || '').match(/node tests\/[^\s&]+/g) || [];
  return [...new Set(matches.map((m) => m.replace('node ', '')))];
}

/**
 * Run one test file with coverage, capturing both the human output (for
 * assertion counts) and the LCOV file (for per-path coverage).
 *
 * @param {string} testFile
 * @returns {{testFile: string, exitCode: number, passed: number, failed: number,
 *   countSource: string, files: Map<string, object>, stderrTail: string}}
 */
function runWithCoverage(testFile) {
  const args = [
    '--test', '--experimental-test-coverage',
    '--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=lcov', `--test-reporter-destination=${LCOV_TMP}`,
    testFile,
  ];
  if (existsSync(LCOV_TMP)) rmSync(LCOV_TMP, { force: true });

  const result = spawnSync('node', args, {
    cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: PER_FILE_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024,
  });

  const counts = parseSelfCounts(result.stdout || '');
  let files = new Map();
  if (existsSync(LCOV_TMP)) {
    files = parseLcov(readFileSync(LCOV_TMP, 'utf-8'));
    rmSync(LCOV_TMP, { force: true });
  }

  return {
    testFile,
    exitCode: result.status ?? 1,
    passed: counts.passed,
    failed: counts.failed,
    countSource: counts.source,
    files,
    stderrTail: (result.stderr || '').trim().split('\n').slice(-3).join(' | '),
  };
}

function main() {
  const all = getTestFiles();
  const singleAt = process.argv.indexOf('--single');
  const onlyAt = process.argv.indexOf('--only');
  const testFiles = singleAt !== -1
    ? [process.argv[singleAt + 1]]
    : onlyAt !== -1
      ? all.filter((f) => f.includes(process.argv[onlyAt + 1]))
      : all;

  if (!testFiles.length) {
    console.error('No test files matched. Usage: --single <file> | --only <substr>');
    process.exit(1);
  }

  console.log(`Running ${testFiles.length} test file(s) with --experimental-test-coverage...\n`);
  const results = [];
  for (const tf of testFiles) {
    const r = runWithCoverage(tf);
    results.push(r);
    const status = r.exitCode === 0 ? 'PASS' : 'FAIL';
    console.log(`  ${status}  ${tf}  [${r.passed}/${r.passed + r.failed} ${r.countSource}, ${r.files.size} module(s)]`);
    if (r.exitCode !== 0 && r.stderrTail) console.error(`        ${r.stderrTail}`);
  }

  const report = aggregate(results);
  printSummary(report);

  if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
  const outPath = join(LOGS_DIR, `coverage-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\nCoverage report written to: ${outPath}\n`);

  if (report.testFilesFailed > 0) {
    console.error(`${report.testFilesFailed}/${report.testFilesRun} test files failed.`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) main();
