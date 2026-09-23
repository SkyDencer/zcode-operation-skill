/**
 * Skill quality validator.
 *
 * Validates SKILL.md files against quality rules:
 *   - Frontmatter fields: name, description, keywords, domains
 *   - Description length: 40–400 chars
 *   - Keywords count: 3–15 entries
 *   - Name pattern: must start with one of its domains followed by "-"
 *   - Domains must match registered domains in data/domains/
 *   - Content section: 100–800 tokens
 *
 * Usage as CLI:
 *   node src/quality/validator.mjs <skills-dir>
 *
 * Returns ValidationResult per skill:
 *   { valid, issues: [{field, message}], score: 0-100 }
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {Array<{field: string, message: string}>} issues
 * @property {number} score — 0-100
 */

/**
 * @typedef {Object} SkillFile
 * @property {string} path
 * @property {string} name
 * @property {string} description
 * @property {string[]} keywords
 * @property {string[]} domains
 * @property {string} content — text after frontmatter
 */

// ── Constants ──────────────────────────────────────────────────────────────────

const MIN_DESC_LEN = 40;
const MAX_DESC_LEN = 400;
const MIN_KEYWORDS = 3;
const MAX_KEYWORDS = 15;
const MIN_TOKENS = 100;
const MAX_TOKENS = 800;
const DOMAINS_DIR = resolve('data/domains');

// ── Frontmatter parsing ────────────────────────────────────────────────────────

/**
 * Parse YAML-like frontmatter from a Markdown string.
 * Mirrors the implementation in src/loader.mjs for standalone CLI use.
 *
 * @param {string} content
 * @returns {object}
 */
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

// ── Token counting ─────────────────────────────────────────────────────────────

/**
 * Count whitespace-separated tokens in a string.
 *
 * @param {string} text
 * @returns {number}
 */
function countTokens(text) {
  return text.split(/\s+/).filter((t) => t.length > 0).length;
}

// ── Domain registry ────────────────────────────────────────────────────────────

/**
 * Read registered domain names from data/domains/<name>/meta.json files.
 *
 * @returns {string[]}
 */
function getRegisteredDomains() {
  if (!existsSync(DOMAINS_DIR)) return [];
  try {
    const entries = readdirSync(DOMAINS_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// ── Core validation ────────────────────────────────────────────────────────────

/**
 * Validate a single skill file.
 *
 * @param {string} filePath — absolute path to a SKILL.md file
 * @param {string[]} registeredDomains
 * @returns {ValidationResult}
 */
export function validateSkill(filePath, registeredDomains = []) {
  const issues = [];

  let content;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    return {
      valid: false,
      issues: [{ field: 'file', message: `Cannot read file: ${err.message}` }],
      score: 0,
    };
  }

  const fm = parseFrontmatter(content);
  const name = fm.name || '';
  const description = fm.description || '';
  const keywords = Array.isArray(fm.keywords) ? fm.keywords : [];
  const domains = Array.isArray(fm.domains) ? fm.domains : [];
  const contentAfterFm = content.replace(/^---\s*\n[\s\S]+?\n---\s*\n?/, '').trim();
  const tokenCount = countTokens(contentAfterFm);

  // ── Check: name present ─────────────────────────────────────────────────
  if (!name || name.trim() === '') {
    issues.push({ field: 'name', message: 'Missing or empty name field' });
  }

  // ── Check: name pattern {domain}-{specific} ─────────────────────────────
  if (name && domains.length > 0) {
    const hasDomainPrefix = domains.some(
      (d) => name.toLowerCase().startsWith(`${d.toLowerCase()}-`),
    );
    if (!hasDomainPrefix) {
      issues.push({
        field: 'name',
        message: `Name "${name}" does not start with any of its domain(s): ${domains.join(',')}`,
      });
    }
  }

  // ── Check: description length ───────────────────────────────────────────
  if (description.length < MIN_DESC_LEN) {
    issues.push({
      field: 'description',
      message: `Description too short (${description.length} chars, minimum ${MIN_DESC_LEN})`,
    });
  } else if (description.length > MAX_DESC_LEN) {
    issues.push({
      field: 'description',
      message: `Description too long (${description.length} chars, maximum ${MAX_DESC_LEN})`,
    });
  }

  // ── Check: keywords count ───────────────────────────────────────────────
  if (keywords.length < MIN_KEYWORDS) {
    issues.push({
      field: 'keywords',
      message: `Too few keywords (${keywords.length}, minimum ${MIN_KEYWORDS})`,
    });
  } else if (keywords.length > MAX_KEYWORDS) {
    issues.push({
      field: 'keywords',
      message: `Too many keywords (${keywords.length}, maximum ${MAX_KEYWORDS})`,
    });
  }

  // ── Check: domains are registered ───────────────────────────────────────
  if (domains.length > 0) {
    const unknownDomains = domains.filter(
      (d) => !registeredDomains.includes(d),
    );
    if (unknownDomains.length > 0) {
      issues.push({
        field: 'domains',
        message: `Unknown domain(s): ${unknownDomains.join(',')}`,
      });
    }
  }

  // ── Check: content token count ──────────────────────────────────────────
  if (tokenCount < MIN_TOKENS) {
    issues.push({
      field: 'content',
      message: `Content too short (${tokenCount} tokens, minimum ${MIN_TOKENS})`,
    });
  } else if (tokenCount > MAX_TOKENS) {
    issues.push({
      field: 'content',
      message: `Content too long (${tokenCount} tokens, maximum ${MAX_TOKENS})`,
    });
  }

  // ── Compute score ───────────────────────────────────────────────────────
  // Each check contributes equally.满分 = 6 checks passed.
  const totalChecks = 6;
  const passedChecks = totalChecks - issues.length;
  const score = Math.round((passedChecks / totalChecks) * 100);

  return {
    valid: issues.length === 0,
    issues,
    score,
  };
}

// ── Walk + batch validation ────────────────────────────────────────────────────

/**
 * Recursively yield SKILL.md file paths from a directory.
 *
 * @param {string} dir
 * @yields {string}
 */
function* walkSkillFiles(dir) {
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
 * Validate all SKILL.md files in a directory.
 *
 * @param {string} skillsDir
 * @returns {Array<{path: string, result: ValidationResult}>}
 */
export function validateSkillsDir(skillsDir) {
  const registeredDomains = getRegisteredDomains();
  const results = [];

  for (const filePath of walkSkillFiles(skillsDir)) {
    const result = validateSkill(filePath, registeredDomains);
    results.push({ path: filePath, result });
  }

  results.sort((a, b) => a.path.localeCompare(b.path));
  return results;
}

// ── CLI entry point ────────────────────────────────────────────────────────────

const _cliArgv1 = process.argv[1]?.replace(/\\/g, '/') ?? '';
if (_cliArgv1 && import.meta.url.endsWith(_cliArgv1)) {
  const skillsDir = process.argv[2];
  if (!skillsDir) {
    console.error('Usage: node src/quality/validator.mjs <skills-directory>');
    process.exit(1);
  }

  const resolvedDir = resolve(skillsDir);
  if (!existsSync(resolvedDir)) {
    console.error(`Directory not found: ${resolvedDir}`);
    process.exit(1);
  }

  console.log(`Validating skills in: ${resolvedDir}`);
  console.log(`Registered domains: ${getRegisteredDomains().join(', ') || '(none)'}`);
  console.log('');

  const results = validateSkillsDir(resolvedDir);
  const valid = results.filter((r) => r.result.valid).length;
  const invalid = results.length - valid;

  console.log(`Total skills:  ${results.length}`);
  console.log(`Valid:         ${valid}`);
  console.log(`Issues found:  ${invalid}`);
  console.log('');

  if (invalid > 0) {
    console.log('── Issues ────────────────────────────────────────────────────────────────');
    for (const { path, result } of results) {
      if (!result.valid) {
        const relPath = path.replace(resolvedDir + '/', '').replace(/\\/g, '/');
        console.log(`\n  ❌ ${relPath}  (score: ${result.score})`);
        for (const issue of result.issues) {
          console.log(`     • [${issue.field}] ${issue.message}`);
        }
      }
    }
  }

  process.exit(invalid > 0 ? 1 : 0);
}
