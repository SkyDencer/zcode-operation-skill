/**
 * Quality report reporter.
 *
 * Converts an array of ValidationResult objects into a human-readable
 * Markdown table suitable for inclusion in documentation or PR descriptions.
 *
 * Usage:
 *   import { reportValidation } from './reporter.mjs';
 *   console.log(reportValidation(results));
 */

/**
 * Format validation results as a Markdown table.
 *
 * @param {Array<{path: string, result: {valid: boolean, issues: Array<{field:string, message:string}>, score: number}}>} results
 * @returns {string} Markdown table
 */
export function reportValidation(results) {
  const lines = [];

  lines.push('# Skill Quality Report');
  lines.push('');

  const total = results.length;
  const valid = results.filter((r) => r.result.valid).length;
  const invalid = total - valid;
  const avgScore =
    total > 0
      ? Math.round(results.reduce((s, r) => s + r.result.score, 0) / total)
      : 0;

  lines.push(`**Total:** ${total} | **Valid:** ${valid} | **Issues:** ${invalid} | **Avg Score:** ${avgScore}/100`);
  lines.push('');
  lines.push('| Skill | Score | Status | Issues |');
  lines.push('|-------|-------|--------|--------|');

  for (const { path, result } of results) {
    const relPath = path.replace(/\\/g, '/');
    const parts = relPath.split('/');
    const shortName = parts[parts.length - 2] || parts[parts.length - 1];
    const status = result.valid ? '✅' : '❌';
    const issueCount = result.issues.length;
    const issuesSummary =
      issueCount > 0
        ? result.issues.map((i) => `[${i.field}] ${i.message}`).join('; ')
        : '—';
    lines.push(`| ${shortName} | ${result.score} | ${status} | ${issuesSummary} |`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Format validation results as a plain-text table for console output.
 *
 * @param {Array<{path: string, result: {valid: boolean, issues: Array<{field:string, message:string}>, score: number}}>} results
 * @returns {string} Plain-text table
 */
export function formatConsoleReport(results) {
  const lines = [];
  const total = results.length;
  const valid = results.filter((r) => r.result.valid).length;
  const invalid = total - valid;
  const avgScore =
    total > 0
      ? Math.round(results.reduce((s, r) => s + r.result.score, 0) / total)
      : 0;

  lines.push('');
  lines.push('═'.repeat(72));
  lines.push('  SKILL QUALITY REPORT');
  lines.push('═'.repeat(72));
  lines.push(`  Total: ${total}  |  Valid: ${valid}  |  Issues: ${invalid}  |  Avg Score: ${avgScore}/100`);
  lines.push('');
  lines.push(
    '  ' +
      'Skill'.padEnd(30) +
      '  ' +
      'Score'.padEnd(7) +
      '  ' +
      'Status'.padEnd(7) +
      '  Issues',
  );
  lines.push('  ' + '─'.repeat(70));

  for (const { path, result } of results) {
    const parts = path.replace(/\\/g, '/').split('/');
    const name = parts[parts.length - 2] || parts[parts.length - 1];
    const status = result.valid ? 'PASS' : 'FAIL';
    const issueSummary =
      result.issues.length > 0
        ? result.issues.map((i) => i.field).join(', ')
        : '—';
    lines.push(
      '  ' +
        name.padEnd(30) +
        '  ' +
        String(result.score).padEnd(7) +
        '  ' +
        status.padEnd(7) +
        '  ' +
        issueSummary,
    );
  }

  lines.push('');
  lines.push('═'.repeat(72));
  return lines.join('\n');
}
