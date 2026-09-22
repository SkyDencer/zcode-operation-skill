/**
 * Skill manifest loader.
 *
 * Reads SKILL.md files from a directory, parses YAML-like frontmatter,
 * and returns an array of validated skill objects.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Parse YAML-like frontmatter from a Markdown string.
 * Handles both Unix (LF) and Windows (CRLF) line endings.
 *
 * @param {string} content
 * @returns {object}
 */
export function parseFrontmatter(content) {
  const frontmatterRegex = /^---\s*\n([\s\S]+?)\n---\s*\n?/;
  const match = content.match(frontmatterRegex);
  if (!match) return {};

  const body = match[1].replace(/\r/g, ''); // normalize CRLF
  const result = {};

  const lines = body.split('\n');
  let currentKey = null;
  let currentList = [];

  for (const line of lines) {
    const listMatch = line.match(/^\s*-\s+(.+)$/);
    if (listMatch && currentKey) {
      currentList.push(listMatch[1].trim());
      continue;
    }
    // Flush previous list
    if (currentKey && currentList.length > 0) {
      result[currentKey] = currentList;
      currentList = [];
    }
    const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const value = kvMatch[2].trim();
      if (value === '') {
        currentKey = key;
        currentList = [];
      } else {
        result[key] = value;
        currentKey = null;
      }
    }
  }
  // Flush last list
  if (currentKey && currentList.length > 0) {
    result[currentKey] = currentList;
  }

  return result;
}

/**
 * Recursively walk a directory up to maxDepth levels, yielding file paths.
 *
 * @param {string} dir
 * @param {number} maxDepth
 * @param {number} currentDepth
 * @yields {string}
 */
async function* walkDir(dir, maxDepth, currentDepth = 0) {
  if (currentDepth > maxDepth) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkDir(full, maxDepth, currentDepth + 1);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

/**
 * Load all skill manifests from a directory.
 *
 * Scans for SKILL.md files, parses frontmatter, and returns an array
 * of skill objects. Skips malformed files with a warning to stderr.
 *
 * @param {string} dir — path to the root skills directory
 * @returns {Promise<Array<{name:string, description:string, keywords:string[], domains:string[], path:string, version:string}>>}
 */
export async function loadSkills(dir) {
  const skills = [];
  const resolvedDir = resolve(dir);

  for await (const filePath of walkDir(resolvedDir, 4)) {
    if (!filePath.endsWith('SKILL.md')) continue;
    try {
      const content = await readFile(filePath, 'utf-8');
      const fm = parseFrontmatter(content);

      skills.push({
        name: fm.name || 'unknown',
        description: fm.description || '',
        keywords: Array.isArray(fm.keywords) ? fm.keywords : [],
        domains: Array.isArray(fm.domains) ? fm.domains : [],
        path: filePath,
        version: fm.version || '0.1.0',
      });
    } catch (err) {
      console.warn(`[skill-router] skipped unreadable file: ${filePath} — ${err.message}`);
    }
  }

  // Sort by name for deterministic output
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}
