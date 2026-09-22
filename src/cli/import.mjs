/**
 * import — Bulk import skills from a directory.
 *
 * Usage: node bin/skill-router.mjs import <source-dir> [--skills-dir <dir>]
 *
 * NOTE: Full implementation in Sub-Phase 2.10.
 */
import { resolve } from 'node:path';
import { existsSync, readdirSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';

const SKILLS_DIR = resolve('data/skills');

export function main(argv) {
  let skillsDir = SKILLS_DIR;
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--skills-dir' && argv[i + 1]) {
      skillsDir = resolve(argv[++i]);
    } else if (!argv[i].startsWith('--')) {
      positional.push(argv[i]);
    }
  }

  if (positional.length === 0) {
    console.error('Usage: node bin/skill-router.mjs import <source-dir> [--skills-dir <dir>]');
    process.exit(1);
  }

  const sourceDir = resolve(positional[0]);
  if (!existsSync(sourceDir)) {
    console.error(`Source directory not found: ${sourceDir}`);
    process.exit(1);
  }

  console.log('[placeholder] Bulk import is a work in progress (Sub-Phase 2.10).');
  console.log(`  Source: ${sourceDir}`);
  console.log(`  Target: ${skillsDir}`);
  console.log('');
  console.log('To add a single skill, use: node bin/skill-router.mjs add <path-to-SKILL.md>');
}
