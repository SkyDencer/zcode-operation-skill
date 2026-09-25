/**
 * LCOV parsing and coverage aggregation for tests/run-coverage.mjs.
 *
 * Kept separate from the runner so both files stay under the 300-line limit.
 * See tests/run-coverage.mjs for the driver and the audit findings
 * (docs/reports/phase-6-test-audit.md section 8.2 / 8.3) this replaces.
 */

/**
 * Parse an LCOV file into per-file raw counters.
 *
 * @param {string} text
 * @returns {Map<string, {lines: Map<number, boolean>, funcs: Map<string, boolean>,
 *   branches: Set<string>, hitBranches: Set<string>}>}
 */
export function parseLcov(text) {
  const files = new Map();
  let cur = null;
  let key = '';

  // LCOV emits SF: once per file, then its counters, then end_of_record.
  const ensure = () => {
    if (!key) return null;
    if (!files.has(key)) {
      files.set(key, {
        lines: new Map(), funcs: new Map(),
        branches: new Set(), hitBranches: new Set(),
      });
    }
    cur = files.get(key);
    return cur;
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      key = line.slice(3).replace(/\\/g, '/');
      cur = null;
      ensure();
    } else if (line.startsWith('DA:')) {
      const [ln, hits] = line.slice(3).split(',');
      const f = ensure();
      if (f) f.lines.set(Number(ln), Number(hits) > 0);
    } else if (line.startsWith('FNDA:')) {
      const [hits, name] = line.slice(5).split(',');
      const f = ensure();
      if (f) f.funcs.set(name, Number(hits) > 0);
    } else if (line.startsWith('BRDA:')) {
      // BRDA:<line>,<block>,<branch>,<taken> — `taken` is 0 when the branch was
      // never taken and `-` for unreachable dead code. Only a positive count
      // counts as covered; counting every row reports 100% branch everywhere.
      const parts = line.slice(5).split(',');
      const f = ensure();
      if (f) {
        const id = `${parts[0]},${parts[1]},${parts[2]}`;
        f.branches.add(id);
        if (Number(parts[3]) > 0) f.hitBranches.add(id);
      }
    } else if (line === 'end_of_record') {
      cur = null;
    }
  }
  return files;
}

/**
 * Extract the assertion counts a test file reports about itself.
 * Custom harnesses print `Passed: N` / `Failed: N`; node:test files print an
 * indented `pass N` / `fail N` block.
 *
 * @param {string} stdout
 * @returns {{passed: number, failed: number, source: string}}
 */
export function parseSelfCounts(stdout) {
  const customPass = stdout.match(/^\s*Passed:\s*(\d+)\s*$/m);
  const customFail = stdout.match(/^\s*Failed:\s*(\d+)\s*$/m);
  if (customPass) {
    return { passed: Number(customPass[1]), failed: customFail ? Number(customFail[1]) : 0, source: 'harness' };
  }
  const nodePass = [...stdout.matchAll(/^\s*pass\s+(\d+)\s*$/gm)].map((m) => Number(m[1]));
  const nodeFail = [...stdout.matchAll(/^\s*fail\s+(\d+)\s*$/gm)].map((m) => Number(m[1]));
  if (nodePass.length) {
    return { passed: Math.max(...nodePass), failed: nodeFail.length ? Math.max(...nodeFail) : 0, source: 'node:test' };
  }
  return { passed: 0, failed: 0, source: 'none' };
}

/**
 * Union every test file's per-module counters into one report. A module counts
 * as covered where any test in the suite exercised the line, function or
 * branch — not the max of the per-file percentages.
 *
 * @param {Array<object>} results — one entry per test file, each with a `files` Map
 */
export function aggregate(results) {
  const merged = new Map();
  const touchedBy = new Map();

  for (const r of results) {
    for (const [path, data] of r.files) {
      if (!merged.has(path)) {
        merged.set(path, {
          lines: new Set(), allLines: new Set(), funcs: new Set(), allFuncs: new Set(),
          branches: new Set(), allBranches: new Set(),
        });
      }
      const m = merged.get(path);
      for (const [ln, hit] of data.lines) { m.allLines.add(ln); if (hit) m.lines.add(ln); }
      for (const [name, hit] of data.funcs) { m.allFuncs.add(name); if (hit) m.funcs.add(name); }
      for (const b of data.hitBranches) m.branches.add(b);
      for (const b of data.branches) m.allBranches.add(b);

      if (!touchedBy.has(path)) touchedBy.set(path, new Set());
      touchedBy.get(path).add(r.testFile);
    }
  }

  const pct = (hit, total) => (total > 0 ? Math.round((hit / total) * 10000) / 100 : null);

  const modules = [...merged.entries()]
    .map(([module, m]) => ({
      module,
      line: pct(m.lines.size, m.allLines.size),
      branch: pct(m.branches.size, m.allBranches.size),
      func: pct(m.funcs.size, m.allFuncs.size),
      coveredLines: m.lines.size,
      totalLines: m.allLines.size,
      coveredBranches: m.branches.size,
      coveredFuncs: m.funcs.size,
      exercisedBy: [...(touchedBy.get(module) ?? [])].sort(),
    }))
    .sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || a.module.localeCompare(b.module));

  const mean = (key) => {
    const vals = modules.filter((m) => m[key] !== null).map((m) => m[key]);
    if (!vals.length) return null;
    return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100;
  };

  return {
    generatedAt: new Date().toISOString(),
    testFilesRun: results.length,
    testFilesFailed: results.filter((r) => r.exitCode !== 0).length,
    assertionsReported: results.reduce((s, r) => s + r.passed + r.failed, 0),
    totalModulesTracked: modules.length,
    fullyCoveredModules: modules.filter((m) => m.line === 100).length,
    meanLineCoverage: mean('line'),
    meanBranchCoverage: mean('branch'),
    meanFuncCoverage: mean('func'),
    files: results.map((r) => ({
      testFile: r.testFile, exitCode: r.exitCode, passed: r.passed,
      failed: r.failed, countSource: r.countSource, modulesInReport: r.files.size,
      ...(r.exitCode !== 0 ? { stderrTail: r.stderrTail } : {}),
    })),
    modules,
  };
}

/**
 * Print the human-readable coverage summary table.
 *
 * @param {object} report — from aggregate()
 */
export function printSummary(report) {
  const p = (v) => (v === null ? 'N/A' : `${v.toFixed(1)}%`);
  console.log('\n=== Coverage Report ===\n');
  console.log(`Test files run:      ${report.testFilesRun} (${report.testFilesFailed} failed)`);
  console.log(`Assertions reported: ${report.assertionsReported}`);
  console.log(`Modules tracked:     ${report.totalModulesTracked}`);
  console.log(`Fully covered:       ${report.fullyCoveredModules}`);
  console.log(`Mean line coverage:  ${p(report.meanLineCoverage)}`);
  console.log(`Mean branch cover:   ${p(report.meanBranchCoverage)}`);
  console.log(`Mean func coverage:  ${p(report.meanFuncCoverage)}\n`);
  console.log('module'.padEnd(48) + 'line     branch   funcs    uncovered');
  console.log('-'.repeat(88));
  for (const m of report.modules) {
    console.log(
      m.module.padEnd(48) + p(m.line).padEnd(8) + p(m.branch).padEnd(8) +
      p(m.func).padEnd(8) + String(m.totalLines - m.coveredLines).padEnd(9)
    );
  }
}
