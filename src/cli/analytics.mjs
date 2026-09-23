/**
 * analytics — Show usage analytics from routing logs.
 *
 * Usage: node bin/skill-router.mjs analytics [--since <YYYY-MM-DD>] [--json] [--include-sync]
 */
import { resolve } from 'node:path';
import { readLogs } from '../analytics/reader.mjs';
import { analyze } from '../analytics/analyzer.mjs';
import { report as formatReport } from '../analytics/reporter.mjs';

export function main(argv) {
  let since = null;
  let json = false;
  let includeSync = true;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--since' && argv[i + 1]) {
      since = argv[++i];
    } else if (argv[i] === '--json') {
      json = true;
    } else if (argv[i] === '--include-sync') {
      includeSync = true;
    } else if (argv[i] === '--no-sync') {
      includeSync = false;
    }
  }

  // Read all log entries
  const entries = readLogs();

  // Filter by --since if provided
  let filtered = entries;
  if (since) {
    const sinceMs = new Date(since).getTime();
    filtered = entries.filter((e) => new Date(e.ts).getTime() >= sinceMs);
  }

  // Analyze
  const analytics = analyze(filtered, { includeSync });

  if (json) {
    console.log(JSON.stringify(analytics, null, 2));
  } else {
    const markdown = formatReport(analytics);
    console.log(markdown);
  }
}
