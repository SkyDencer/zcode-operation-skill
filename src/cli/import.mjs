/**
 * import — Bulk import skills from a directory.
 *
 * Usage: node bin/skill-router.mjs import <source-dir> [--skills-dir <dir>] [--force] [--json]
 */
import { resolve, join, dirname } from 'node:path';
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { parseFrontmatter } from '../loader.mjs';
import { validateSkill } from '../quality/validator.mjs';
import { formatConsoleReport } from '../import/reporter.mjs';

const SKILLS_DIR = resolve('data/skills');
const MAX_DEPTH = 10;

/**
 * Synchronous walk that yields SKILL.md paths without following symlinks
 * outside the source root.
 */
function* walkSkillFilesSync(dir, sourceRoot, depth) {
  if (depth > MAX_DEPTH) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    // Block path traversal in component names
    if (entry.name.includes('..')) {
      continue;
    }

    const fullPath = join(dir, entry.name);

    if (entry.isSymbolicLink()) {
      // Resolve symlink and verify it stays within source root
      let realPath;
      try {
        realPath = statSync(fullPath, { follow: false }).isSymbolicLink()
          ? resolve(dir, readFileSync(fullPath, 'utf-8').trim())
          : fullPath;
      } catch {
        continue;
      }
      const normReal = realPath.replace(/\\/g, '/');
      const normRoot = sourceRoot.replace(/\\/g, '/');
      if (normReal !== normRoot && !normReal.startsWith(normRoot + '/')) {
        continue;
      }
    }

    if (entry.isDirectory()) {
      yield* walkSkillFilesSync(fullPath, sourceRoot, depth + 1);
    } else if (entry.isFile() && entry.name === 'SKILL.md') {
      yield fullPath;
    }
  }
}

/**
 * Synchronous scan for skill candidates.
 */
function scanSourceSync(sourceDir) {
  const candidates = [];
  for (const filePath of walkSkillFilesSync(sourceDir, sourceDir, 0)) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const fm = parseFrontmatter(content);
      const contentAfterFm = content.replace(/^---\s*\n[\s\S]+?\n---\s*\n?/, '').trim();
      candidates.push({
        name: fm.name || 'unknown',
        description: fm.description || '',
        keywords: Array.isArray(fm.keywords) ? fm.keywords : [],
        domains: Array.isArray(fm.domains) ? fm.domains : [],
        sourcePath: filePath,
        content: contentAfterFm,
      });
    } catch {
      // skip unreadable files
    }
  }
  candidates.sort((a, b) => a.name.localeCompare(b.name));
  return candidates;
}

/**
 * Resolve the target directory for a skill name.
 * e.g. "backend-eloquent" → data/skills/backend/eloquent/
 */
function resolveTargetDir(name, skillsDir) {
  const parts = name.split('-');
  const domainPart = parts[0];
  const slugPart = parts.slice(1).join('-');
  if (slugPart) {
    return join(skillsDir, domainPart, slugPart);
  }
  return join(skillsDir, domainPart);
}

/**
 * Get list of already-imported skill names.
 */
function getExistingSkillNames(skillsDir) {
  const names = [];
  if (!existsSync(skillsDir)) return names;

  function walk(dir, depth) {
    if (depth > MAX_DEPTH) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (entry.isFile() && entry.name === 'SKILL.md') {
          const parentName = dirname(full).split(/[\\/]/).pop();
          if (parentName) names.push(parentName);
        }
      }
    } catch {
      // skip
    }
  }
  walk(skillsDir, 0);
  return names;
}

export function main(argv) {
  let skillsDir = SKILLS_DIR;
  let force = false;
  let jsonOutput = false;
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--skills-dir' && argv[i + 1]) {
      skillsDir = resolve(argv[++i]);
    } else if (argv[i] === '--force') {
      force = true;
    } else if (argv[i] === '--json') {
      jsonOutput = true;
    } else if (!argv[i].startsWith('--')) {
      positional.push(argv[i]);
    }
  }

  if (positional.length === 0) {
    console.error('Usage: node bin/skill-router.mjs import <source-dir> [--skills-dir <dir>] [--force] [--json]');
    process.exit(1);
  }

  const sourceDir = resolve(positional[0]);
  if (!existsSync(sourceDir)) {
    console.error(`Source directory not found: ${sourceDir}`);
    process.exit(1);
  }

  // Scan
  console.log(`Scanning: ${sourceDir}`);
  const candidates = scanSourceSync(sourceDir);
  console.log(`Found ${candidates.length} candidate(s).`);

  if (candidates.length === 0) {
    console.log('No SKILL.md files found in source directory.');
    return;
  }

  // Resolve target
  const resolvedSkillsDir = resolve(skillsDir);

  // Get existing names for collision detection
  const existingNames = new Set(getExistingSkillNames(resolvedSkillsDir));

  // Registered domains
  const domainsDir = resolve('data/domains');
  let registeredDomains = [];
  if (existsSync(domainsDir)) {
    try {
      const entries = readdirSync(domainsDir, { withFileTypes: true });
      registeredDomains = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      // ignore
    }
  }

  // Import
  const items = [];
  for (const candidate of candidates) {
    const item = {
      name: candidate.name,
      status: /** @type {'imported' | 'rejected' | 'skipped'} */ ('skipped'),
      sourcePath: candidate.sourcePath,
    };

    // Validate
    const validationResult = validateSkill(candidate.sourcePath, registeredDomains);

    if (!validationResult.valid) {
      item.status = 'rejected';
      item.issues = validationResult.issues;
      items.push(item);
      continue;
    }

    // Check collision
    const targetDir = resolveTargetDir(candidate.name, resolvedSkillsDir);
    const targetPath = join(targetDir, 'SKILL.md');

    if (existsSync(targetPath) && !force) {
      item.status = 'skipped';
      item.targetPath = targetPath;
      items.push(item);
      continue;
    }

    // Write
    try {
      mkdirSync(targetDir, { recursive: true });
      const fullContent = readFileSync(candidate.sourcePath, 'utf-8');
      writeFileSync(targetPath, fullContent, 'utf-8');

      item.status = 'imported';
      item.targetPath = targetPath;
      item.score = validationResult.score;
      items.push(item);
    } catch (err) {
      item.status = 'rejected';
      item.issues = [{ field: 'write', message: err.message }];
      items.push(item);
    }
  }

  const imported = items.filter((i) => i.status === 'imported').length;
  const rejected = items.filter((i) => i.status === 'rejected').length;
  const skipped = items.filter((i) => i.status === 'skipped').length;
  const result = { items, total: candidates.length, imported, rejected, skipped };

  // Output
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatConsoleReport(result));
  }

  if (rejected > 0) {
    process.exit(1);
  }
}
