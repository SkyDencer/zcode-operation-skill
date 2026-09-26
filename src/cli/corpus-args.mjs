/**
 * corpus argument parsing — the usage block and the flag helpers for the
 * `skill-router corpus` subcommands.
 *
 * Sub-phase 7.2. A helper of `src/cli/corpus.mjs`, not a subcommand of its
 * own: `bin/skill-router.mjs` resolves `src/cli/<name>.js` by subcommand name,
 * so nothing here is reachable except through `corpus.mjs`.
 *
 * It exists mostly for one rule. `--to` and `--target` used to be read as
 * `argv[i + 1] && resolve(argv[++i])`, so a trailing `--to`, or a `--to`
 * immediately followed by another flag, silently dropped the flag: the command
 * printed a clean successful run having written no manifest and having
 * imported into `data/skills` instead of the requested directory. A flag whose
 * value is missing is a usage error, and that is the one thing shared by every
 * subcommand, so it lives here once.
 */

import { resolve } from 'node:path';

const RULE = '-'.repeat(70);

export const USAGE = `Usage: node bin/skill-router.mjs corpus <subcommand> [options]

Subcommands:
  fetch     <source> [--to <dir>] [--git]        discover SKILL.md files in a source
  validate  <dir> [--json]                       apply the corpus validation rules
  stats     <dir> [--json]                       count and summarise a skill tree
  import    <source> --target <dir> [--force]    fetch, validate and copy into a tree
  import    --from-manifest <file> --target <d>  import a manifest written by fetch --to

Options:
  --to <dir>           write a self-contained JSON fetch manifest to <dir>
  --git                treat <source> as a git URL or repository path
  --target <dir>       destination skills directory for import (default data/skills)
  --from-manifest <f>  import the records in a corpus-fetch.json instead of a source
  --force              overwrite an existing skill (import only, default off)
  --json               machine-readable output
  --help               show this message

A <source> may be prefixed with git: instead of using --git, e.g.
  node bin/skill-router.mjs corpus fetch git:https://example.com/skills.git

Examples:
  node bin/skill-router.mjs corpus stats data/skills
  node bin/skill-router.mjs corpus validate tests/corpus/fixtures
  node bin/skill-router.mjs corpus import tests/corpus/fixtures --target tmp/corpus`;

/** The 70-character rule printed between report sections. */
export { RULE };

/**
 * Print the usage block.
 *
 * @param {(text: string) => void} [stream]
 */
export function usage(stream = console.log) {
  stream(USAGE);
}

/**
 * Read the value that must follow a flag.
 *
 * A flag at the end of the argument list, or immediately followed by another
 * flag, has no value and is a usage error rather than a flag that quietly
 * disappears.
 *
 * @param {string[]} argv
 * @param {number} i — index of the flag
 * @param {string} usageLine
 * @returns {string} the resolved value
 */
export function flagValue(argv, i, usageLine) {
  const next = argv[i + 1];
  if (!next || next.startsWith('--')) {
    console.error(`${argv[i]} requires a value.`);
    console.error(usageLine);
    process.exit(1);
  }
  return resolve(next);
}

/**
 * Parse a `<source>` argument into a source descriptor.
 *
 * @param {string} value
 * @param {boolean} gitFlag
 * @returns {{type: 'local'|'git', path?: string, url?: string}}
 */
export function toSource(value, gitFlag) {
  if (gitFlag || value.startsWith('git:')) {
    return { type: 'git', url: value.startsWith('git:') ? value.slice(4) : value };
  }
  return { type: 'local', path: value };
}

/**
 * How a record is shown to the operator.
 *
 * For a git source the absolute path is inside a temporary clone, so printing
 * it would name a file that is not there any more.
 * `<repo>::<path within the repo>` is both true and stable.
 *
 * @param {{source: string, sourceRef: string, relPath: string, path: string}} record
 * @returns {string}
 */
export function displayPath(record) {
  return record.source === 'git'
    ? `${record.sourceRef}::${record.relPath}`
    : record.path.replace(/\\/g, '/');
}
