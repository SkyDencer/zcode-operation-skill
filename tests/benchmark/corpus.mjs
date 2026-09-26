/**
 * Corpus loading for the benchmark harness (tests/run-benchmark.mjs).
 *
 * Two corpus kinds are supported:
 *   - `real`: the flat JSON array at data/skill-index.json, built by
 *     hooks/build-index.mjs.
 *   - `synthetic-N`: N generated SKILL.md manifests under
 *     data/skills-synthetic/, created on demand by
 *     tests/scale/generate-synthetic.mjs.
 *
 * The frontmatter parser here intentionally mirrors the one in
 * hooks/build-index.mjs: the synthetic corpus is only ever read by the
 * scale benchmark, and sharing the parser keeps the two paths honest.
 *
 * @module tests/benchmark/corpus
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/** Directory the generated synthetic corpus lives in. */
export const SYNTHETIC_DIR = resolve('data/skills-synthetic');
const GENERATOR_PATH = resolve('tests/scale/generate-synthetic.mjs');

/**
 * Parse YAML-like frontmatter from a Markdown string.
 *
 * @param {string} content
 * @returns {Record<string, any>} parsed keys
 */
export function parseFrontmatter(content) {
  const frontmatterRegex = /^---\s*\n([\s\S]+?)\n---\s*\n?/;
  const match = content.match(frontmatterRegex);
  if (!match) return {};

  const body = match[1].replace(/\r/g, '');
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
  if (currentKey && currentList.length > 0) {
    result[currentKey] = currentList;
  }
  return result;
}

/**
 * Recursively walk a directory yielding SKILL.md file paths.
 *
 * @param {string} dir
 * @returns {Generator<string>}
 */
export function* walkSkillFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkSkillFiles(full);
    } else if (entry.isFile() && entry.name === 'SKILL.md') {
      yield full;
    }
  }
}

/**
 * Count SKILL.md files in a directory tree.
 *
 * @param {string} dir
 * @returns {number}
 */
export function countSkillMdFiles(dir) {
  let count = 0;
  for (const _ of walkSkillFiles(dir)) count++;
  return count;
}

/**
 * Load skill manifests from a directory tree, sorted by name.
 *
 * @param {string} dir
 * @returns {Array<{name:string, description:string, keywords:string[], domains:string[], path:string, version:string}>}
 */
export function loadSkillsFromDir(dir) {
  const skills = [];
  for (const filePath of walkSkillFiles(dir)) {
    try {
      const content = readFileSync(filePath, 'utf-8');
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
      console.warn(`[benchmark] skipped unreadable file: ${filePath} — ${err.message}`);
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

/**
 * Ensure the synthetic corpus exists with at least `count` skills.
 *
 * @param {number} count
 * @returns {void}
 */
export function ensureSyntheticCorpus(count) {
  const currentCount = countSkillMdFiles(SYNTHETIC_DIR);
  if (currentCount >= count) {
    console.log(`  Using existing synthetic corpus (${currentCount} skills)`);
    return;
  }
  console.log(`  Generating synthetic corpus (${count} skills)...`);
  const result = spawnSync('node', [GENERATOR_PATH, String(count)], {
    cwd: resolve('.'),
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Synthetic corpus generation failed with exit code ${result.status}`);
  }
}
