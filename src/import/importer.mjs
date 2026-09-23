/**
 * External skill importer.
 *
 * Takes an array of SkillCandidate objects (from scanner) and imports them
 * into the project's skills directory after validation.
 *
 * Security:
 *   - Blocks path traversal (../ patterns) in target paths
 *   - Never overwrites existing skills without --force
 *   - Validates all candidates before any copy operations
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { validateSkill } from '../quality/validator.mjs';

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SkillCandidate
 * @property {string} name
 * @property {string} description
 * @property {string[]} keywords
 * @property {string[]} domains
 * @property {string} sourcePath
 * @property {string} content
 */

/**
 * @typedef {Object} ImportOptions
 * @property {string} [skillsDir] — target directory (default: data/skills)
 * @property {boolean} [force] — overwrite existing skills (default: false)
 * @property {string[]} [registeredDomains] — pre-loaded domain list
 */

/**
 * @typedef {Object} ImportItem
 * @property {string} name
 * @property {'imported' | 'rejected' | 'skipped'} status
 * @property {string} [targetPath] — where the file was placed
 * @property {string} [sourcePath] — original source location
 * @property {Array<{field: string, message: string}>} [issues] — validation issues if rejected
 * @property {number} [score] — quality score if imported
 */

/**
 * @typedef {Object} ImportResult
 * @property {ImportItem[]} items
 * @property {number} total — total candidates
 * @property {number} imported — successfully imported
 * @property {number} rejected — failed validation
 * @property {number} skipped — already existed (without --force)
 */

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_SKILLS_DIR = resolve('data/skills');
const MAX_DEPTH = 10;

// ── Safety helpers ─────────────────────────────────────────────────────────────

/**
 * Check if a path contains traversal attempts.
 *
 * @param {string} path
 * @returns {boolean}
 */
function hasTraversal(path) {
  const parts = path.split(/[\\/]/);
  return parts.some((p) => p === '..' || p === '.');
}

/**
 * Resolve the target directory for a skill name.
 * e.g. "backend-eloquent" → data/skills/backend/eloquent/
 *
 * @param {string} name
 * @param {string} skillsDir
 * @returns {string}
 */
function resolveTargetDir(name, skillsDir) {
  const nameParts = name.split('-');
  const domainPart = nameParts[0];
  const slugPart = nameParts.slice(1).join('-');

  if (!domainPart) {
    return join(skillsDir, name);
  }

  if (slugPart) {
    return join(skillsDir, domainPart, slugPart);
  }
  return join(skillsDir, domainPart);
}

/**
 * Read registered domains from data/domains/.
 *
 * @returns {string[]}
 */
function getRegisteredDomains() {
  const domainsDir = resolve('data/domains');
  if (!existsSync(domainsDir)) return [];
  try {
    const entries = readdirSync(domainsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Get list of already-imported skill names in the target directory.
 *
 * @param {string} skillsDir
 * @returns {string[]}
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
          if (entry.name === 'SKILL.md') {
            // This is actually a file named SKILL.md treated as dir — skip
          } else {
            walk(full, depth + 1);
          }
        } else if (entry.isFile() && entry.name === 'SKILL.md') {
          // Found a SKILL.md — the skill name is the parent directory name
          const parentName = dirname(full).split(/[\\/]/).pop();
          if (parentName) names.push(parentName);
        }
      }
    } catch {
      // Permission denied — skip
    }
  }

  walk(skillsDir, 0);
  return names;
}

// ── Core import logic ──────────────────────────────────────────────────────────

/**
 * Import an array of SkillCandidate objects into the skills directory.
 *
 * @param {SkillCandidate[]} candidates
 * @param {ImportOptions} [options]
 * @returns {ImportResult}
 */
export function importSkills(candidates, options = {}) {
  const skillsDir = options.skillsDir ?? DEFAULT_SKILLS_DIR;
  const force = options.force ?? false;
  const registeredDomains = options.registeredDomains ?? getRegisteredDomains();

  // Resolve target directory safely
  const resolvedSkillsDir = resolve(skillsDir);
  if (hasTraversal(resolvedSkillsDir)) {
    throw new Error('Target skills directory contains path traversal: ' + skillsDir);
  }

  // Collect existing skill names to check for collisions
  const existingNames = new Set(getExistingSkillNames(resolvedSkillsDir));

  const items = [];

  for (const candidate of candidates) {
    const item = {
      name: candidate.name,
      status: /** @type {'imported' | 'rejected' | 'skipped'} */ ('skipped'),
      sourcePath: candidate.sourcePath,
    };

    // ── Check path traversal in source ──────────────────────────────────────
    if (hasTraversal(candidate.sourcePath)) {
      item.status = 'rejected';
      item.issues = [{ field: 'path', message: `Source path contains traversal: ${candidate.sourcePath}` }];
      items.push(item);
      continue;
    }

    // ── Validate ────────────────────────────────────────────────────────────
    const validationResult = validateSkill(candidate.sourcePath, registeredDomains);

    if (!validationResult.valid) {
      item.status = 'rejected';
      item.issues = validationResult.issues;
      items.push(item);
      continue;
    }

    // ── Check collision ─────────────────────────────────────────────────────
    const targetDir = resolveTargetDir(candidate.name, resolvedSkillsDir);
    const targetPath = join(targetDir, 'SKILL.md');

    if (existsSync(targetPath) && !force) {
      item.status = 'skipped';
      item.targetPath = targetPath;
      items.push(item);
      continue;
    }

    // ── Write ───────────────────────────────────────────────────────────────
    try {
      mkdirSync(targetDir, { recursive: true });

      // Re-read the full source file to preserve exact formatting
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

  return {
    items,
    total: candidates.length,
    imported,
    rejected,
    skipped,
  };
}

// ── CLI entry point ────────────────────────────────────────────────────────────

const _cliArgv1 = process.argv[1]?.replace(/\\/g, '/') ?? '';
if (_cliArgv1 && import.meta.url.endsWith(_cliArgv1)) {
  console.log('This module is not meant to be run directly. Use: node bin/skill-router.mjs import <source-dir>');
  process.exit(1);
}
