/**
 * remove — Remove a skill by name.
 *
 * Usage: node bin/skill-router.mjs remove <skill-name> [--dry-run]
 */
import { resolve } from 'node:path';
import { existsSync, rmSync, readdirSync } from 'node:fs';

const SKILLS_DIR = resolve('data/skills');

export function main(argv) {
  let dryRun = false;
  const positional = [];

  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (!arg.startsWith('--')) positional.push(arg);
  }

  if (positional.length === 0) {
    console.error('Usage: node bin/skill-router.mjs remove <skill-name> [--dry-run]');
    process.exit(1);
  }

  const skillName = positional[0];
  const skillDir = findSkillDir(skillName);

  if (!skillDir) {
    console.error(`Skill not found: ${skillName}`);
    console.error(`Search scope: ${SKILLS_DIR}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log(`[dry-run] Would remove: ${skillDir}`);
    return;
  }

  rmSync(skillDir, { recursive: true, force: true });
  console.log(`Removed skill: ${skillName}`);
  console.log(`  Deleted: ${skillDir}`);
  console.log('');
  console.log('Tip: run "node bin/skill-router.mjs reindex" to update the search index.');
}

function findSkillDir(name) {
  // Search recursively for a directory containing SKILL.md with matching name
  function walk(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        const skillMd = resolve(full, 'SKILL.md');
        if (existsSync(skillMd)) {
          // Check if directory name matches skill name (last path segment)
          const dirName = entry.name;
          if (dirName === name) return full;
        }
        const found = walk(full);
        if (found) return found;
      }
    }
    return null;
  }

  return walk(SKILLS_DIR);
}
