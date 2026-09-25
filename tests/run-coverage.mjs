/**
 * Coverage runner: runs every test file in the package.json `test` chain
 * with Node's built-in `--experimental-test-coverage` flag and aggregates
 * the per-module line/function/branch coverage into a single JSON report.
 *
 * Usage:
 *   node tests/run-coverage.mjs                    (run all tests, write report)
 *   node tests/run-coverage.mjs --single <file>    (run one test file only)
 *
 * Output:
 *   logs/coverage-YYYY-MM-DD.json   — aggregated per-module coverage report
 *   console:                        — human-readable summary table
 *
 * No external dependencies. Uses Node >= 20's `--experimental-test-coverage`.
 * Each test file is run via `node --test --experimental-test-coverage <file>`
 * so that Node's native test runner produces structured coverage output.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(__filename, '..', '..');
const LOGS_DIR = join(PROJECT_ROOT, 'logs');

// ── Collect the list of test files from the package.json test script ─────────
function getTestFiles() {
  const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
  const testScript = pkg.scripts.test || '';
  const matches = testScript.match(/node tests\/[^\s&]+/g) || [];
  return matches.map((m) => m.replace('node ', ''));
}

// ── Parse the human-readable coverage table from stdout ──────────────────────
function parseCoverageTable(stdout) {
  const lines = stdout.split('\n');
  const files = {};
  // Look for lines like:
  // ℹ   defaults.mjs  |  72.38 |    36.36 |   75.00 | 33-35 59-61
  // or the summary line:
  // ℹ all files       |  80.65 |    66.67 |   80.00 |
  let inCoverage = false;
  for (const line of lines) {
    if (line.includes('start of coverage report')) {
      inCoverage = true;
      continue;
    }
    if (line.includes('end of coverage report')) {
      inCoverage = false;
      continue;
    }
    if (!inCoverage) continue;

    // Match per-file rows: relative/path/to/file.mjs  |  LINE% | BRANCH% | FUNC% | uncovered
    const fileMatch = line.match(
      /ℹ\s+(\S+\.mjs)\s+\|\s+([\d.]+|N\/A)\s+\|\s+([\d.]+|N\/A)\s+\|\s+([\d.]+|N\/A)/
    );
    if (fileMatch) {
      const [, name, linePct, branchPct, funcPct] = fileMatch;
      files[name] = {
        line: parsePct(linePct),
        branch: parsePct(branchPct),
        func: parsePct(funcPct),
      };
    }

    // Match the summary row
    const summaryMatch = line.match(
      /ℹ\s+all files\s+\|\s+([\d.]+|N\/A)\s+\|\s+([\d.]+|N\/A)\s+\|\s+([\d.]+|N\/A)/
    );
    if (summaryMatch) {
      const [, linePct, branchPct, funcPct] = summaryMatch;
      files.__summary__ = {
        line: parsePct(linePct),
        branch: parsePct(branchPct),
        func: parsePct(funcPct),
      };
    }
  }
  return files;
}

function parsePct(v) {
  if (v === 'N/A' || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

// ── Run a single test file with coverage ─────────────────────────────────────
function runWithCoverage(testFile) {
  const args = ['--test', '--experimental-test-coverage', testFile];
  const result = spawnSync('node', args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    timeout: 180_000,
  });

  const exitCode = result.status ?? 1;
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';

  // Parse the coverage table from stdout
  const coverage = parseCoverageTable(stdout);

  // Extract pass/fail counts from the test runner summary
  const testMatch = stdout.match(/pass\s+(\d+)/);
  const failMatch = stdout.match(/fail\s+(\d+)/);
  const testsPassed = testMatch ? parseInt(testMatch[1]) : 0;
  const testsFailed = failMatch ? parseInt(failMatch[1]) : 0;

  return {
    testFile,
    exitCode,
    testsPassed,
    testsFailed,
    coverage,
    stdout,
    stderr,
  };
}

// ── Aggregate: take the MAX coverage seen for each module across all test files ─
function aggregateCoverage(results) {
  const moduleMap = new Map();

  for (const r of results) {
    if (!r.coverage) continue;
    for (const [name, pcts] of Object.entries(r.coverage)) {
      if (name === '__summary__') continue;
      if (!moduleMap.has(name)) {
        moduleMap.set(name, { line: null, branch: null, func: null });
      }
      const agg = moduleMap.get(name);
      if (pcts.line !== null && (agg.line === null || pcts.line > agg.line)) agg.line = pcts.line;
      if (pcts.branch !== null && (agg.branch === null || pcts.branch > agg.branch)) agg.branch = pcts.branch;
      if (pcts.func !== null && (agg.func === null || pcts.func > agg.func)) agg.func = pcts.func;
    }
  }

  const modules = [...moduleMap.entries()]
    .map(([name, pcts]) => ({ module: name, ...pcts }))
    .sort((a, b) => a.module.localeCompare(b.module));

  // Compute overall stats
  const linesCovered = modules.filter((m) => m.line !== null && m.line > 0).length;
  const linesFull = modules.filter((m) => m.line === 100).length;

  return {
    generatedAt: new Date().toISOString(),
    totalModulesTracked: modules.length,
    modulesWithLineCoverage: linesCovered,
    modulesWithFullCoverage: linesFull,
    modules: modules,
  };
}

// ── Print a human-readable summary ───────────────────────────────────────────
function printSummary(report) {
  console.log('\n=== Coverage Report ===\n');
  const pct = (v) => (v === null ? 'N/A' : `${v.toFixed(1)}%`);

  console.log(`Modules tracked:     ${report.totalModulesTracked}`);
  console.log(`With line coverage:  ${report.modulesWithLineCoverage}`);
  console.log(`Fully covered:       ${report.modulesWithFullCoverage}\n`);

  console.log('Module                                        | Line     | Branch   | Function');
  console.log('---------------------------------------------+----------+----------+---------');
  for (const m of report.modules) {
    const shortName = m.module.length > 41 ? '...' + m.module.slice(-39) : m.module.padEnd(41);
    console.log(
      `${shortName} | ${pct(m.line).padEnd(8)} | ${pct(m.branch).padEnd(8)} | ${pct(m.func).padEnd(8)}`
    );
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
function main() {
  const argSingle = process.argv.indexOf('--single');
  const targetFile = argSingle !== -1 ? process.argv[argSingle + 1] : null;

  const testFiles = targetFile ? [targetFile] : getTestFiles();
  console.log(`Running ${testFiles.length} test files with --experimental-test-coverage...\n`);

  const results = [];
  for (const tf of testFiles) {
    const label = basename(tf);
    process.stdout.write(`  ${label} ... `);
    const r = runWithCoverage(tf);
    const status = r.exitCode === 0 ? `PASS (${r.testsPassed} tests)` : `FAIL (exit ${r.exitCode})`;
    const covCount = r.coverage ? Object.keys(r.coverage).filter((k) => k !== '__summary__').length : 0;
    console.log(`${status}  [${covCount} modules in coverage report]`);
    results.push(r);
    if (r.exitCode !== 0) {
      console.error(`  stderr tail: ${(r.stderr || '').split('\n').slice(-3).join('\n')}`);
    }
  }

  const report = aggregateCoverage(results);
  printSummary(report);

  // Write the JSON report
  if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const outPath = join(LOGS_DIR, `coverage-${date}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nCoverage report written to: ${outPath}\n`);

  const failures = results.filter((r) => r.exitCode !== 0).length;
  if (failures > 0) {
    console.error(`\n${failures}/${results.length} test files failed.`);
    process.exit(1);
  }
}

main();
