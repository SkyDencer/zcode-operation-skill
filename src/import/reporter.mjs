/**
 * Import report reporter.
 *
 * Converts an ImportResult into a human-readable Markdown string.
 */

/**
 * @typedef {Object} ImportItem
 * @property {string} name
 * @property {'imported' | 'rejected' | 'skipped'} status
 * @property {string} [targetPath]
 * @property {string} [sourcePath]
 * @property {Array<{field: string, message: string}>} [issues]
 * @property {number} [score]
 */

/**
 * @typedef {Object} ImportResult
 * @property {ImportItem[]} items
 * @property {number} total
 * @property {number} imported
 * @property {number} rejected
 * @property {number} skipped
 */

/**
 * Format an ImportResult as a Markdown report.
 *
 * @param {ImportResult} result
 * @returns {string}
 */
export function reportImport(result) {
  const lines = [];

  lines.push('# Skill Import Report');
  lines.push('');

  const { total, imported, rejected, skipped } = result;
  const failRate = total > 0 ? Math.round((rejected / total) * 100) : 0;

  lines.push(`**Total:** ${total}  |  **Imported:** ${imported}  |  **Rejected:** ${rejected}  |  **Skipped:** ${skipped}  |  **Failure Rate:** ${failRate}%`);
  lines.push('');

  // ── Imported ────────────────────────────────────────────────────────────────
  const importedItems = result.items.filter((i) => i.status === 'imported');
  if (importedItems.length > 0) {
    lines.push('## ✅ Imported');
    lines.push('');
    lines.push('| Name | Score | Target Path |');
    lines.push('|------|-------|-------------|');
    for (const item of importedItems) {
      const target = item.targetPath
        ? item.targetPath.replace(/\\/g, '/')
        : '—';
      lines.push(`| ${item.name} | ${item.score ?? '?'} | ${target} |`);
    }
    lines.push('');
  }

  // ── Rejected ────────────────────────────────────────────────────────────────
  const rejectedItems = result.items.filter((i) => i.status === 'rejected');
  if (rejectedItems.length > 0) {
    lines.push('## ❌ Rejected');
    lines.push('');
    lines.push('| Name | Source | Issues |');
    lines.push('|------|--------|--------|');
    for (const item of rejectedItems) {
      const source = item.sourcePath
        ? item.sourcePath.replace(/\\/g, '/')
        : '—';
      const issues = item.issues
        ? item.issues.map((i) => `[${i.field}] ${i.message}`).join('; ')
        : 'unknown';
      lines.push(`| ${item.name} | ${source} | ${issues} |`);
    }
    lines.push('');
  }

  // ── Skipped ─────────────────────────────────────────────────────────────────
  const skippedItems = result.items.filter((i) => i.status === 'skipped');
  if (skippedItems.length > 0) {
    lines.push('## ⏭ Skipped (already exists)');
    lines.push('');
    lines.push('| Name | Target Path |');
    lines.push('|------|-------------|');
    for (const item of skippedItems) {
      const target = item.targetPath
        ? item.targetPath.replace(/\\/g, '/')
        : '—';
      lines.push(`| ${item.name} | ${target} |`);
    }
    lines.push('');
  }

  if (result.items.length === 0) {
    lines.push('*No candidates provided.*');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format an ImportResult as a plain-text console report.
 *
 * @param {ImportResult} result
 * @returns {string}
 */
export function formatConsoleReport(result) {
  const lines = [];
  const { total, imported, rejected, skipped } = result;

  lines.push('');
  lines.push('═'.repeat(72));
  lines.push('  SKILL IMPORT REPORT');
  lines.push('═'.repeat(72));
  lines.push(`  Total: ${total}  |  Imported: ${imported}  |  Rejected: ${rejected}  |  Skipped: ${skipped}`);
  lines.push('');

  // Imported
  const importedItems = result.items.filter((i) => i.status === 'imported');
  if (importedItems.length > 0) {
    lines.push('  Imported:');
    for (const item of importedItems) {
      lines.push(`    ✓ ${item.name}  (score: ${item.score ?? '?'}/100)`);
    }
    lines.push('');
  }

  // Rejected
  const rejectedItems = result.items.filter((i) => i.status === 'rejected');
  if (rejectedItems.length > 0) {
    lines.push('  Rejected:');
    for (const item of rejectedItems) {
      const issueSummary = item.issues
        ? item.issues.map((i) => `[${i.field}] ${i.message}`).join('; ')
        : 'unknown';
      lines.push(`    ✗ ${item.name}  —  ${issueSummary}`);
    }
    lines.push('');
  }

  // Skipped
  const skippedItems = result.items.filter((i) => i.status === 'skipped');
  if (skippedItems.length > 0) {
    lines.push('  Skipped (already exists):');
    for (const item of skippedItems) {
      lines.push(`    ⏭ ${item.name}`);
    }
    lines.push('');
  }

  lines.push('═'.repeat(72));
  return lines.join('\n');
}

// ── CLI entry point ────────────────────────────────────────────────────────────

const _cliArgv1 = process.argv[1]?.replace(/\\/g, '/') ?? '';
if (_cliArgv1 && import.meta.url.endsWith(_cliArgv1)) {
  console.log('This module is not meant to be run directly.');
  process.exit(1);
}
