/**
 * Cross-platform file-system utilities.
 *
 * Wraps node:fs/promises with convenience methods for JSON read/write
 * and directory walking.
 */
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Read a JSON file and parse it.
 *
 * @param {string} filePath
 * @returns {Promise<*>}
 */
export async function readFileJson(filePath) {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Write a JS value as formatted JSON to a file.
 *
 * @param {string} filePath
 * @param {*} data
 */
export async function writeFileJson(filePath, data) {
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Recursively walk a directory up to maxDepth levels, yielding file paths.
 *
 * @param {string} dir
 * @param {number} maxDepth
 * @param {number} currentDepth
 * @yields {string}
 */
export async function* walkDir(dir, maxDepth, currentDepth = 0) {
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
 * Resolve a path relative to the project root (process.cwd()).
 *
 * @param {string} rel
 * @returns {string}
 */
export function resolvePath(rel) {
  return resolve(rel);
}
