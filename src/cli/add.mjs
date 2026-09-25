/**
 * add — Add a new skill from a SKILL.md file.
 *
 * Usage: node bin/skill-router.mjs add <path-to-SKILL.md> [--dry-run]
 */
import { resolve } from 'node:path';
import { existsSync, readFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { validateSkill } from '../quality/validator.mjs';
import { parseFrontmatter } from '../loader.mjs';

const SKILLS_DIR = resolve('data/skills');

export function main(argv) {
  let dryRun = false;
  const positional = [];

  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (!arg.startsWith('--')) positional.push(arg);
  }

  if (positional.length === 0) {
    console.error('Usage: node bin/skill-router.mjs add <path-to-SKILL.md> [--dry-run]');
    process.exit(1);
  }

  const sourcePath = resolve(positional[0]);
  if (!existsSync(sourcePath)) {
    console.error(`File not found: ${sourcePath}`);
    process.exit(1);
  }

  const content = readFileSync(sourcePath, 'utf-8');
  const fm = parseFrontmatter(content);

  if (!fm.name) {
    console.error('Error: SKILL.md missing "name" in frontmatter.');
    process.exit(1);
  }

  // Validate
  const registeredDomains = getRegisteredDomains();
  const result = validateSkill(sourcePath, registeredDomains);

  if (!result.valid && !dryRun) {
    console.error(`Validation failed for ${fm.name}:`);
    for (const issue of result.issues) {
      console.error(`  • [${issue.field}] ${issue.message}`);
    }
    console.error(`  Score: ${result.score}/100`);
    console.error('  Use --dry-run to skip validation.');
    process.exit(1);
  }

  if (dryRun) {
    console.log(`[dry-run] Would add skill: ${fm.name} (score: ${result.score}/100)`);
    return;
  }

  // Determine target directory: use name-derived path under SKILLS_DIR
  // e.g. "backend-eloquent" -> data/skills/backend/eloquent/
  const nameParts = fm.name.split('-');
  const domainPart = nameParts[0];
  const slugPart = nameParts.slice(1).join('-');

  let targetDir;
  if (slugPart) {
    targetDir = resolve(SKILLS_DIR, domainPart, slugPart);
  } else {
    targetDir = resolve(SKILLS_DIR, domainPart);
  }

  const targetPath = resolve(targetDir, 'SKILL.md');

  if (existsSync(targetPath)) {
    console.error(`Skill already exists at: ${targetPath}`);
    process.exit(1);
  }

  mkdirSync(targetDir, { recursive: true });
  copyFileSync(sourcePath, targetPath);

  console.log(`Added skill: ${fm.name}`);
  console.log(`  Path: ${targetPath}`);
  console.log(`  Quality score: ${result.score}/100`);
  console.log(`  Domains: ${(fm.domains || []).join(', ') || '(none)'}`);
  console.log(`  Keywords: ${(fm.keywords || []).length}`);
  console.log('');
  console.log('Tip: run "node bin/skill-router.mjs reindex" to update the search index.');
}

function getRegisteredDomains() {
  const domainsDir = resolve('data/domains');
  if (!existsSync(domainsDir)) return [];
  try {
    const entries = readdirSync(domainsDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}
