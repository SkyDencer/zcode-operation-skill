/**
 * stats — Show corpus statistics.
 *
 * Usage: node bin/skill-router.mjs stats [--skills-dir <dir>]
 */
import { resolve } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { loadSkills } from '../loader.mjs';
import { validateSkillsDir } from '../quality/validator.mjs';

const SKILLS_DIR = resolve('data/skills');

export function main(argv) {
  let skillsDir = SKILLS_DIR;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--skills-dir' && argv[i + 1]) {
      skillsDir = resolve(argv[++i]);
    }
  }

  if (!existsSync(skillsDir)) {
    console.error(`Skills directory not found: ${skillsDir}`);
    process.exit(1);
  }

  const skills = loadSkillsSync(skillsDir);
  const validationResults = validateSkillsDir(skillsDir);

  // Domain stats
  const domainCounts = {};
  const keywordCounts = {};
  let totalTokens = 0;
  let totalDescChars = 0;
  let totalKeywords = 0;

  for (const skill of skills) {
    // Domains
    for (const d of (skill.domains || [])) {
      domainCounts[d] = (domainCounts[d] || 0) + 1;
    }

    // Keywords
    for (const kw of (skill.keywords || [])) {
      keywordCounts[kw] = (keywordCounts[kw] || 0) + 1;
    }
    totalKeywords += (skill.keywords || []).length;

    // Description chars
    totalDescChars += (skill.description || '').length;
  }

  // Content tokens (read files)
  for (const skill of skills) {
    try {
      const content = readFileSync(skill.path, 'utf-8');
      const afterFm = content.replace(/^---\s*\n[\s\S]+?\n---\s*\n?/, '').trim();
      const tokens = afterFm.split(/\s+/).filter((t) => t.length > 0).length;
      totalTokens += tokens;
    } catch {
      // skip
    }
  }

  // Validation stats
  const validCount = validationResults.filter((r) => r.result.valid).length;
  const avgScore = Math.round(
    validationResults.reduce((s, r) => s + r.result.score, 0) / validationResults.length,
  );

  // Top keywords
  const topKws = Object.entries(keywordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Top domains
  const topDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1]);

  console.log('── Corpus Statistics ────────────────────────────────────────────────');
  console.log('');
  console.log(`  Total skills:        ${skills.length}`);
  console.log(`  Valid skills:        ${validCount}`);
  console.log(`  Avg quality score:   ${avgScore}/100`);
  console.log(`  Total keywords:      ${totalKeywords}`);
  console.log(`  Avg desc length:     ${skills.length ? Math.round(totalDescChars / skills.length) : 0} chars`);
  console.log(`  Total content tokens: ${totalTokens}`);
  console.log(`  Avg tokens/skill:    ${skills.length ? Math.round(totalTokens / skills.length) : 0}`);
  console.log('');

  console.log('── Domains ──────────────────────────────────────────────────────────');
  for (const [domain, count] of topDomains) {
    console.log(`  ${domain}: ${count}`);
  }
  console.log('');

  console.log('── Top Keywords ─────────────────────────────────────────────────────');
  for (const [kw, count] of topKws) {
    console.log(`  ${kw}: ${count}`);
  }
}

function loadSkillsSync(dir) {
  const skills = [];
  const resolvedDir = resolve(dir);

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
          // skip
        }
      }
    }
  }

  walk(resolvedDir);
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
