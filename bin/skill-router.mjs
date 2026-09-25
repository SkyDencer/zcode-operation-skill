#!/usr/bin/env node
/**
 * skill-router — CLI entry point for the Skill Router management tool.
 *
 * Usage:
 *   node bin/skill-router.mjs <subcommand> [options]
 *
 * Subcommands (18 total -- see `node bin/skill-router.mjs help`):
 *   list       List skills grouped by domain with quality scores
 *   add        Add a new skill from a SKILL.md file
 *   remove     Remove a skill by name
 *   validate   Run the quality validator on all skills
 *   reindex    Rebuild the skill index
 *   benchmark  Run the benchmark suite
 *   stats      Show corpus statistics
 *   analytics  Show usage analytics from routing logs
 *   import     Bulk import skills from a directory
 *   sync       Sync project skills to the ZCode mirror
 *   deploy     Deploy router skills to the ZCode mirror
 *   sources    List current sources and skill counts
 *   verify     Health check: sync drift, orphans, index integrity, thresholds
 *   doctor     Diagnostic report: environment, corpus, benchmarks, overrides
 *   feedback   Show routing decision feedback summary
 *   health     Run health checks on sync state and index integrity
 *   tune       Adaptive BM25 weight tuning (analyze, apply, rollback, auto)
 *   help       Show this help message
 *
 * Note: no subcommand implements a --help flag. Unrecognised flags are ignored
 * and the command runs normally, so `deploy --help` deploys. Use `help`.
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliDir = resolve(__dirname, '..', 'src', 'cli');

const subcommand = process.argv[2];

if (!subcommand) {
  console.log('Usage: node bin/skill-router.mjs <subcommand> [options]');
  console.log('Run "node bin/skill-router.mjs help" for more information.');
  process.exit(1);
}

try {
  const resolvedPath = resolve(cliDir, `${subcommand}.mjs`);
  // Use pathToFileURL for correct file:// URL on all platforms
  const { pathToFileURL } = await import('node:url');
  const mod = await import(pathToFileURL(resolvedPath).href);
  if (typeof mod.main === 'function') {
    mod.main(process.argv.slice(3));
  } else {
    console.error(`Subcommand "${subcommand}" has no exported main() function.`);
    process.exit(1);
  }
} catch (err) {
  if (err.code === 'MODULE_NOT_FOUND' || err.message?.includes('Cannot find module')) {
    console.error(`Unknown subcommand: ${subcommand}`);
    console.error('Run "node bin/skill-router.mjs help" for available subcommands.');
    process.exit(1);
  }
  console.error(`Error running "${subcommand}": ${err.message}`);
  process.exit(1);
}
