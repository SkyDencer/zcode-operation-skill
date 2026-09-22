/**
 * list — Display all skills grouped by domain with quality scores.
 *
 * Usage: node bin/skill-router.mjs list [--skills-dir <dir>]
 */
import { resolve } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { validateSkillsDir } from '../quality/validator.mjs';
import { loadSkills } from '../loader.mjs';

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
  const validationMap = new Map(validationResults.map((r) => [r.path, r.result]));

  // Group by top-level domain
  const byDomain = {};
  for (const skill of skills) {
    const domains = skill.domains && skill.domains.length > 0 ? skill.domains : ['(no domain)'];
    for (const domain of domains) {
      if (!byDomain[domain]) byDomain[domain] = [];
      byDomain[domain].push(skill);
    }
  }

  // Also collect skills with no domains into a general group
  const noDomainSkills = skills.filter(
    (s) => !s.domains || s.domains.length === 0,
  );
  if (noDomainSkills.length > 0 && !byDomain['(no domain)']) {
    byDomain['(no domain)'] = noDomainSkills;
  }

  // Determine quality score from path
  function qualityScore(path) {
    const vr = validationMap.get(path);
    return vr ? vr.score : null;
  }

  const domainKeys = Object.keys(byDomain).sort();
  let totalSkills = 0;
  let totalValid = 0;
  let totalIssues = 0;

  for (const domain of domainKeys) {
    const domainSkills = byDomain[domain];
    totalSkills += domainSkills.length;

    console.log(`\n## ${domain} (${domainSkills.length} skills)`);
    console.log('');
    console.log('| Skill | Quality | Issues |');
    console.log('|-------|---------|--------|');

    for (const skill of domainSkills) {
      const name = skill.name;
      const score = qualityScore(skill.path);
      const vr = validationMap.get(skill.path);
      const issueCount = vr ? vr.issues.length : 0;

      if (vr) {
        if (vr.valid) totalValid++;
        else totalIssues++;
      }

      const scoreStr = score !== null ? `${score}/100` : '—';
      const icon = vr && vr.valid ? '✅' : vr ? '❌' : '⚠️';
      console.log(`| ${icon} ${name} | ${scoreStr} | ${issueCount} |`);
    }
  }

  console.log('');
  console.log(`── Summary ─────────────────────────────────────────────────────────`);
  console.log(`  Total skills:  ${totalSkills}`);
  console.log(`  Valid:         ${totalValid}`);
  console.log(`  Issues:        ${totalIssues}`);
}

/**
 * Synchronous load skills (mirrors loadSkills but sync).
 */
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
          // skip unreadable files
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
