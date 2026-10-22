/**
 * help-text — P6-H-020: shared usage text for every CLI subcommand.
 *
 * Single source of truth for the `--help` / `-h` output of all 19
 * subcommands. Each module in src/cli/*.mjs checks for the help flag at
 * the top of its main(), before any argument parsing or side effect, and
 * delegates here:
 *
 *   if (argv.includes('--help') || argv.includes('-h')) {
 *     usageFor('deploy');
 *     return 0;
 *   }
 *
 * The guarantee: `--help` (or `-h`) never triggers the real operation.
 * `deploy --help` prints the deploy usage and exits 0 without planning,
 * writing, registering a hook, or verifying.
 *
 * `corpus` keeps its own richer usage block in ./corpus-args.mjs and
 * reuses it here, so the text is defined in exactly one place.
 */

import { USAGE as CORPUS_USAGE } from './corpus-args.mjs';

/** name → one-line summary (mirrors the table in bin/skill-router.mjs). */
export const SUBCOMMANDS = [
  ['list', 'List skills grouped by domain with quality scores'],
  ['add', 'Add a new skill from a SKILL.md file'],
  ['remove', 'Remove a skill by name'],
  ['validate', 'Run the quality validator on all skills'],
  ['reindex', 'Rebuild the skill index'],
  ['benchmark', 'Run the benchmark suite'],
  ['stats', 'Show corpus statistics'],
  ['analytics', 'Show usage analytics from routing logs'],
  ['import', 'Bulk import skills from a directory'],
  ['corpus', 'Fetch, validate, measure and import external skill corpora'],
  ['sync', 'Sync project skills to the ZCode mirror'],
  ['deploy', 'Deploy router skills to the ZCode mirror'],
  ['sources', 'List current sources and skill counts'],
  ['verify', 'Health check: sync drift, orphans, index integrity, thresholds'],
  ['doctor', 'Diagnostic report: environment, corpus, benchmarks, overrides'],
  ['feedback', 'Show routing decision feedback summary'],
  ['health', 'Run health checks on sync state and index integrity'],
  ['tune', 'Adaptive BM25 weight tuning (analyze, apply, rollback, auto)'],
  ['help', 'Show this help message'],
];

/** name → full usage block. */
const USAGE = {
  list: `Usage: node bin/skill-router.mjs list [--skills-dir <dir>] [--help]

Options:
  --skills-dir <dir>  skills directory to list (default data/skills)
  -h, --help          show this message`,

  add: `Usage: node bin/skill-router.mjs add <path-to-SKILL.md> [--dry-run] [--help]

Options:
  --dry-run   validate without writing
  -h, --help  show this message`,

  remove: `Usage: node bin/skill-router.mjs remove <skill-name> [--dry-run] [--help]

Options:
  --dry-run   show what would be removed without deleting
  -h, --help  show this message`,

  validate: `Usage: node bin/skill-router.mjs validate [--skills-dir <dir>] [--json] [--help]

Options:
  --skills-dir <dir>  skills directory to validate (default data/skills)
  --json              machine-readable output
  -h, --help          show this message`,

  reindex: `Usage: node bin/skill-router.mjs reindex [--skills-dir <dir>] [--sources project,zcode-user] [--help]

Options:
  --skills-dir <dir>  skills directory (default data/skills)
  --sources <list>    comma-separated: project, zcode-user, all
  -h, --help          show this message`,

  benchmark: `Usage: node bin/skill-router.mjs benchmark [benchmark args] [--help]

Arguments are forwarded to tests/run-benchmark.mjs, e.g.:
  --mode <bm25|hybrid>   --corpus <real|synthetic-<n>>   --count <n>
  --router <flat|hierarchical>   --rerank <on|off>   --provider <fnv1a|onnx>
  -h, --help                  show this message`,

  stats: `Usage: node bin/skill-router.mjs stats [--skills-dir <dir>] [--help]

Options:
  --skills-dir <dir>  skills directory to measure (default data/skills)
  -h, --help          show this message`,

  analytics: `Usage: node bin/skill-router.mjs analytics [--since <YYYY-MM-DD>] [--json] [--include-sync | --no-sync] [--help]

Options:
  --since <date>      only include log entries from this date
  --json              machine-readable output
  --include-sync / --no-sync  include or exclude sync history (default: include)
  -h, --help          show this message`,

  import: `Usage: node bin/skill-router.mjs import <source-dir> [--skills-dir <dir>] [--force] [--json] [--help]

Options:
  --skills-dir <dir>  destination skills directory (default data/skills)
  --force             overwrite an existing skill
  --json              machine-readable output
  -h, --help          show this message`,

  corpus: CORPUS_USAGE,

  sync: `Usage: node bin/skill-router.mjs sync [--dry-run] [--force] [--quiet]
        [--skills-dir <dir>] [--zcode-dir <dir>]
        [--disable <skill-name>] [--enable <skill-name>] [--help]

Options:
  --dry-run            compute the plan without writing
  --force              apply even when the plan has removals
  --quiet              no progress output
  --skills-dir <dir>   project skills root (default data/skills)
  --zcode-dir <dir>    ZCode mirror (default SKILL_ROUTER_ZCODE_DIR or ~/.zcode/skills)
  --disable <name>     record a skill as disabled
  --enable <name>      remove a skill from the disabled registry
  -h, --help           show this message`,

  deploy: `Usage: node bin/skill-router.mjs deploy [--dry-run] [--rollback <file>] [--verify]
        [--zcode-dir <dir>] [--project-dir <dir>] [--with-hook | --no-hook]
        [--list-snapshots] [--restore <timestamp>] [--force-rollback] [--quiet] [--help]

Options:
  --dry-run             compute the plan without writing
  --rollback <file>     roll back to a deploy snapshot
  --verify              run the post-deploy verification
  --zcode-dir <dir>     ZCode skills mirror (default SKILL_ROUTER_ZCODE_DIR)
  --project-dir <dir>   project root (default cwd)
  --with-hook / --no-hook  register / do not register the UserPromptSubmit hook
  --list-snapshots      list available deploy snapshots
  --restore <timestamp> restore a snapshot by timestamp
  --force-rollback      bypass snapshot validation (P6-H-014) with a warning
  --quiet               no progress output
  -h, --help            show this message (never triggers a deploy)`,

  sources: `Usage: node bin/skill-router.mjs sources

Lists the active skill sources and the skills each one contributes.
No options.  -h, --help  show this message`,

  verify: `Usage: node bin/skill-router.mjs verify [--skills-dir <dir>] [--zcode-dir <dir>] [--deep] [--json] [--help]

Options:
  --skills-dir <dir>  project skills root (default data/skills)
  --zcode-dir <dir>   ZCode mirror
  --deep              add hook-registered and hook-invocable checks
  --json              machine-readable output
  -h, --help          show this message`,

  doctor: `Usage: node bin/skill-router.mjs doctor

Read-only diagnostic report: ZCode directory, Node/OS, corpus and index
sizes, last sync timestamp, benchmark baselines, env overrides.
No options.  -h, --help  show this message`,

  feedback: `Usage: node bin/skill-router.mjs feedback [--since YYYY-MM-DD] [--limit N] [--json]
            [--export <path>] [--outcomes] [--help]

Options:
  --since <date>   decision-log window start
  --limit <n>      maximum number of decisions shown
  --json           machine-readable output
  --export <path>  write the summary to a file
  --outcomes       include correlated outcome data
  -h, --help       show this message`,

  health: `Usage: node bin/skill-router.mjs health

Runs 8 installation checks (routers installed, plugin fresh, hook
registered, index fresh, hook responds, llama-server status, clean git
status, thresholds valid). No options.
Exit codes: 0 healthy, 1 warning, 2 unhealthy.
  -h, --help  show this message`,

  tune: `Usage: node bin/skill-router.mjs tune [--analyze | --apply | --rollback | --status | --auto | --report] [--help]

Options:
  --analyze   compute proposed weights from benchmark attribution data
  --apply     write weights.json, benchmark before/after, auto-rollback on regression
  --rollback  restore the previous weights snapshot
  --status    show current weights, last apply timestamp, sample size
  --auto      analyze + apply with guardrails
  --report    print tuning history summary
  -h, --help  show this message`,

  help: `Usage: node bin/skill-router.mjs help

Lists every subcommand and its summary. No options.`,
};

/**
 * Print the usage block of one subcommand.
 *
 * @param {string} name — subcommand name (e.g. 'deploy')
 * @param {(text: string) => void} [stream]
 */
export function usageFor(name, stream = console.log) {
  const text = USAGE[name];
  if (!text) {
    stream(`Unknown subcommand: ${name}\nRun "node bin/skill-router.mjs help" for available subcommands.`);
    return;
  }
  stream(text);
}

/**
 * Print the top-level usage: every subcommand with its summary.
 * Used by `skill-router --help` / `skill-router -h`.
 *
 * @param {(text: string) => void} [stream]
 */
export function topLevelUsage(stream = console.log) {
  const lines = [
    'Usage: node bin/skill-router.mjs <subcommand> [options]',
    '',
    'Subcommands (all support --help and -h):',
  ];
  for (const [name, summary] of SUBCOMMANDS) {
    lines.push(`  ${name.padEnd(12)} ${summary}`);
  }
  lines.push(
    '',
    'Run "node bin/skill-router.mjs <subcommand> --help" for subcommand options.',
  );
  stream(lines.join('\n'));
}
