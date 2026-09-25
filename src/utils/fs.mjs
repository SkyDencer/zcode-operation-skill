/**
 * Cross-platform file-system utilities.
 *
 * Wraps node:fs/promises with convenience methods for JSON read/write
 * and directory walking.
 */
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

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

/**
 * Check that a candidate path stays inside a root directory.
 *
 * Used before every filesystem write whose target is derived from untrusted
 * input (skill frontmatter `name`, sync registry `entry.path`). Comparison is
 * done on path segments, so `..` can never climb out and a sibling directory
 * with a shared prefix (e.g. `<root>/evil` vs `<root>/evil2`) is not accepted.
 *
 * @param {string} root      — absolute root directory
 * @param {string} candidate — absolute path that must be inside root
 * @returns {boolean}
 */
export function isWithinRoot(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  if (rel === '') return true;
  if (isAbsolute(rel)) return false;
  return !rel.split(sep).includes('..');
}

/**
 * Check that a skill name is a safe single path segment.
 *
 * A skill name is untrusted frontmatter data that is later turned into a
 * directory name, so it must not contain a path separator, a `..` segment, or
 * anything else that could redirect a write outside the target root.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isSafeName(name) {
  if (typeof name !== 'string' || name === '') return false;
  if (name === '.' || name === '..') return false;
  return !/[/\\]/.test(name) && !name.includes('..');
}
