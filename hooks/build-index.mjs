import { readdir, readFile, writeFile, stat } from 'fs/promises';
import { join, resolve } from 'path';

const MOCK_SKILLS_DIR = resolve('data/mock-skills');
const INDEX_PATH = resolve('data/skill-index.json');

/**
 * Parse YAML-like frontmatter from a Markdown string using simple regex.
 * Returns an object with the parsed fields.
 */
function parseFrontmatter(content) {
  const frontmatterRegex = /^---\s*\n([\s\S]+?)\n---\s*\n?/;
  const match = content.match(frontmatterRegex);
  if (!match) return {};

  const body = match[1];
  const result = {};

  // Parse each key
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
        // Start of a list
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

async function main() {
  const skills = [];

  // Walk data/mock-skills/ at depth 2 looking for SKILL.md
  for await (const filePath of walkDir(MOCK_SKILLS_DIR, 2)) {
    if (filePath.endsWith('SKILL.md')) {
      const content = await readFile(filePath, 'utf-8');
      const fm = parseFrontmatter(content);

      skills.push({
        name: fm.name || 'unknown',
        description: fm.description || '',
        keywords: Array.isArray(fm.keywords) ? fm.keywords : [],
        domains: Array.isArray(fm.domains) ? fm.domains : [],
        path: filePath,
        version: '0.1.0',
      });
    }
  }

  // Sort by name for deterministic output
  skills.sort((a, b) => a.name.localeCompare(b.name));

  await writeFile(INDEX_PATH, JSON.stringify(skills, null, 2), 'utf-8');
  console.log(`Indexed ${skills.length} skills.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
