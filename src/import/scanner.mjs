/**
 * External skill scanner.
 *
 * Recursively scans a source directory for SKILL.md files, parses frontmatter,
 * and returns an array of SkillCandidate objects.
 *
 * Security:
 *   - Blocks path traversal (../ patterns) in file names
 *   - Never follows symlinks outside the source root
 *   - Respects a maxDepth limit to avoid excessive recursion
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { parseFrontmatter } from '../loader.mjs';

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SkillCandidate
 * @property {string} name — from frontmatter
 * @property {string} description — from frontmatter
 * @property {string[]} keywords — from frontmatter
 * @property {string[]} domains — from frontmatter
 * @property {string} sourcePath — absolute path to the SKILL.md file
 * @property {string} content — raw markdown after frontmatter
 */

/**
 * @typedef {Object} ScanOptions
 * @property {number} [maxDepth] — max recursion depth (default: 10)
 * @property {boolean} [followSymlinks] — whether to follow symlinks (default: false)
 */

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_MAX_DEPTH = 10;
const SKILL_FILE_NAME = 'SKILL.md';

// ── Security helpers ───────────────────────────────────────────────────────────

/**
 * Check if a resolved path is safely within the source root.
 * Returns true if the path is equal to or inside sourceRoot.
 *
 * @param {string} resolvedPath
 * @param {string} sourceRoot
 * @returns {boolean}
 */
function isWithinSourceRoot(resolvedPath, sourceRoot) {
  // Normalize both to forward-slash form for reliable comparison
  const normalize = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const normPath = normalize(resolvedPath);
  const normRoot = normalize(sourceRoot);
  return normPath === normRoot || normPath.startsWith(normRoot + '/');
}

/**
 * Check if a relative component contains path traversal.
 *
 * @param {string} component
 * @returns {boolean} true if the component is malicious
 */
function hasPathTraversal(component) {
  return component.includes('..') || component.includes('~') || component.startsWith('/');
}

// ── Core scanning ──────────────────────────────────────────────────────────────

/**
 * Recursively scan a directory for SKILL.md files.
 *
 * @param {string} dir — absolute path to scan
 * @param {string} sourceRoot — the original source root (for security checks)
 * @param {number} depth — current recursion depth
 * @param {ScanOptions} options
 * @yields {SkillCandidate}
 */
async function* walkSkillFiles(dir, sourceRoot, depth, options) {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  if (depth > maxDepth) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    // Permission denied or other I/O error — skip
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    // Block obvious path traversal in component names
    if (hasPathTraversal(entry.name)) {
      console.warn(`[scanner] skipping suspicious path component: ${entry.name}`);
      continue;
    }

    if (entry.isSymbolicLink()) {
      if (!options.followSymlinks) {
        continue;
      }
      // Resolve symlink and verify it stays within source root
      let realPath;
      try {
        realPath = await stat(fullPath).then((s) => s.isSymbolicLink()
          ? import('node:fs').then(({ realpath }) => realpath(fullPath))
          : Promise.resolve(fullPath));
      } catch {
        continue;
      }
      if (!isWithinSourceRoot(realPath, sourceRoot)) {
        console.warn(`[scanner] skipping symlink pointing outside source root: ${fullPath} → ${realPath}`);
        continue;
      }
    }

    if (entry.isDirectory()) {
      yield* walkSkillFiles(fullPath, sourceRoot, depth + 1, options);
    } else if (entry.isFile() && entry.name === SKILL_FILE_NAME) {
      yield fullPath;
    }
  }
}

/**
 * Scan a source directory and return an array of SkillCandidate objects.
 *
 * @param {string} path — directory path to scan
 * @param {ScanOptions} [options]
 * @returns {Promise<SkillCandidate[]>}
 */
export async function scanSource(path, options = {}) {
  const sourceRoot = resolve(path);
  const candidates = [];

  // Validate source root exists
  try {
    const s = await stat(sourceRoot);
    if (!s.isDirectory()) {
      throw new Error(`${sourceRoot} is not a directory`);
    }
  } catch (err) {
    throw new Error(`Source directory not found: ${sourceRoot} — ${err.message}`);
  }

  for await (const filePath of walkSkillFiles(sourceRoot, sourceRoot, 0, options)) {
    try {
      const content = await readFile(filePath, 'utf-8');
      const fm = parseFrontmatter(content);

      // Strip frontmatter to get body content
      const contentAfterFm = content.replace(/^---\s*\n[\s\S]+?\n---\s*\n?/, '').trim();

      candidates.push({
        name: fm.name || 'unknown',
        description: fm.description || '',
        keywords: Array.isArray(fm.keywords) ? fm.keywords : [],
        domains: Array.isArray(fm.domains) ? fm.domains : [],
        sourcePath: filePath,
        content: contentAfterFm,
      });
    } catch (err) {
      console.warn(`[scanner] skipped unreadable file: ${filePath} — ${err.message}`);
    }
  }

  // Sort by name for deterministic output
  candidates.sort((a, b) => a.name.localeCompare(b.name));
  return candidates;
}

// ── CLI entry point ────────────────────────────────────────────────────────────

const _cliArgv1 = process.argv[1]?.replace(/\\/g, '/') ?? '';
if (_cliArgv1 && import.meta.url.endsWith(_cliArgv1)) {
  const sourceDir = process.argv[2];
  if (!sourceDir) {
    console.error('Usage: node src/import/scanner.mjs <source-directory>');
    process.exit(1);
  }

  const candidates = await scanSource(sourceDir);
  console.log(`Found ${candidates.length} skill candidate(s):`);
  for (const c of candidates) {
    console.log(`  • ${c.name}  —  ${c.sourcePath}`);
  }
}
