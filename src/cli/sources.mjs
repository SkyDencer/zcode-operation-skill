/**
 * sources — Display current sources and skill counts.
 *
 * Usage: node bin/skill-router.mjs sources
 */
import { resolve } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolveCollisions } from '../index/dedupe.mjs';

const DEFAULT_SOURCES = [
  { path: resolve('data/skills'), source: 'project' },
];

const ZCODE_SOURCE_PATH = resolve('data/skills/zcode');

/**
 * Tag each skill with its most-specific source.
 */
function tagSkillsBySource(skills, sources) {
  const sorted = [...sources].sort((a, b) => b.path.length - a.path.length);

  return skills.map((skill) => {
    for (const src of sorted) {
      const separator = skill.path[src.path.length] === '\\' ? '\\' : '/';
      if (skill.path.startsWith(src.path + separator)) {
        return { ...skill, source: src.source };
      }
    }
    return { ...skill, source: sources[0]?.source ?? 'project' };
  });
}

export function main() {
  const sources = [
    { path: resolve('data/skills'), source: 'project', exists: existsSync(resolve('data/skills')) },
    { path: ZCODE_SOURCE_PATH, source: 'zcode-user', exists: existsSync(ZCODE_SOURCE_PATH) },
  ];

  console.log('skill-router sources');
  console.log('====================');
  console.log('');
  console.log(`Environment: SKILL_ROUTER_SOURCES=${process.env.SKILL_ROUTER_SOURCES || '(default)'}`);
  console.log('');
  console.log('| Source     | Path                        | Status |');
  console.log('|------------|-----------------------------|--------|');

  for (const src of sources) {
    const status = src.exists ? '✓' : '✗ (missing)';
    console.log(`| ${src.source.padEnd(10)} | ${src.path.padEnd(27)} | ${status} |`);
  }

  console.log('');

  // Load and show counts per source (each scanned independently)
  console.log('Skill counts per source:');
  for (const src of sources) {
    if (!src.exists) {
      console.log(`  ${src.source}: 0 (directory missing)`);
      continue;
    }
    const skills = loadSkillsSync(src.path);
    console.log(`  ${src.source}: ${skills.length}`);
  }

  console.log('');

  // Load all entries, dedup by path, then tag and dedup by name
  const allEntries = [];
  for (const src of sources) {
    if (!src.exists) continue;
    const skills = loadSkillsSync(src.path);
    for (const skill of skills) {
      allEntries.push(skill);
    }
  }

  // Dedup by path (same file may appear in multiple source scans)
  const seenPaths = new Set();
  const uniqueEntries = [];
  for (const entry of allEntries) {
    if (!seenPaths.has(entry.path)) {
      seenPaths.add(entry.path);
      uniqueEntries.push(entry);
    }
  }

  const tagged = tagSkillsBySource(uniqueEntries, sources);
  const deduplicated = resolveCollisions(tagged);

  console.log(`Total unique skills: ${uniqueEntries.length}`);
  console.log(`After deduplication: ${deduplicated.length}`);

  // Show which skills were deduplicated
  const byName = new Map();
  for (const entry of tagged) {
    if (!byName.has(entry.name)) {
      byName.set(entry.name, []);
    }
    byName.get(entry.name).push(entry);
  }

  const collisions = [...byName.values()].filter((entries) => entries.length > 1);
  if (collisions.length > 0) {
    console.log('');
    console.log('Name collisions (project wins):');
    for (const group of collisions) {
      const names = [...new Set(group.map((g) => g.source))].join(', ');
      console.log(`  "${group[0].name}": ${names}`);
    }
  }
}

/**
 * Synchronous load skills for this CLI command.
 */
function loadSkillsSync(dir) {
  const skills = [];

  function walk(d, depth = 0) {
    if (depth > 4) return;
    const entries = readdirSync(d, { withFileTypes: true });
    for (const entry of entries) {
      const full = resolve(d, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && entry.name === 'SKILL.md') {
        try {
          const content = readFileSync(full, 'utf-8');
          const fm = parseFrontmatter(content);
          skills.push({
            name: fm.name || 'unknown',
            description: fm.description || '',
            keywords: Array.isArray(fm.keywords) ? fm.keywords : [],
            domains: Array.isArray(fm.domains) ? fm.domains : [],
            path: full,
            version: fm.version || '0.1.0',
          });
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  walk(resolve(dir));
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

function parseFrontmatter(content) {
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
