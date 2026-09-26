/**
 * Corpus validator — judges whether a fetched SKILL.md is usable by the router.
 *
 * Sub-phase 7.2. The gate that a large external corpus has to clear before it is
 * imported into `data/skills/`. Four rules decide validity:
 *
 *   1. YAML frontmatter block is present (`---` delimited at the top).
 *   2. `name` is present and non-empty.
 *   3. `description` is present and between 40 and 400 characters.
 *   4. `name` matches the `{domain}-{specific}` shape the router expects:
 *      at least two lowercase alphanumeric segments joined by single hyphens,
 *      e.g. `backend-eloquent`, `testing-playwright`, `router-next`.
 *
 * Rule 4 is the router's own convention, taken from the shipped corpus: every
 * one of the 60 skill names in `data/skills/` and `router-skills/` is
 * lowercase-hyphenated, and the first segment is the skill's domain
 * (`src/quality/validator.mjs` enforces the same idea as "name starts with one
 * of its declared domains"). `src/config/aliases.mjs` keys the dispatcher
 * `router-*` names, so the two-segment rule accepts them unchanged.
 *
 * Deliberately NOT checked here, unlike `src/quality/validator.mjs`: keyword
 * count, content token count, and domain registration. An external corpus
 * brings its own domains, and `data/domains/` is this project's registry, so
 * enforcing it here would reject every skill from a domain the project has not
 * seen. The in-project quality validator still enforces all six rules for
 * `data/skills/`.
 *
 * `validateSkill()` never throws for a malformed file: it returns the issues.
 * It throws only for a file it cannot read, because that is an operational
 * failure the caller must hear about.
 *
 * `validateSkillContent()` applies exactly the same four rules to text that is
 * already in memory. It exists because a fetch manifest
 * (`src/corpus/manifest.mjs`) carries the SKILL.md bodies with it, and a
 * manifest record has no file to read — validating a path that no longer
 * exists is precisely the defect that made git-sourced imports fail.
 */

import { readFile } from 'node:fs/promises';
import { parseFrontmatter } from '../loader.mjs';

/** Minimum description length, matching `src/quality/validator.mjs`. */
export const MIN_DESC_LEN = 40;

/** Maximum description length, matching `src/quality/validator.mjs`. */
export const MAX_DESC_LEN = 400;

/**
 * The `{domain}-{specific}` name shape. Two or more lowercase alphanumeric
 * segments joined by single hyphens, no leading or trailing hyphen.
 */
export const NAME_SHAPE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;

/**
 * @typedef {Object} Issue
 * @property {string} field
 * @property {string} message
 */

/**
 * @typedef {Object} ParsedSkill
 * @property {boolean} hasFrontmatter
 * @property {string} name
 * @property {string} description
 * @property {string[]} keywords
 * @property {string[]} domains
 * @property {string} version
 * @property {number} descriptionLength
 * @property {number} contentTokens
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {Issue[]} issues
 * @property {ParsedSkill} parsed
 */

/**
 * Count whitespace-separated tokens in a string.
 *
 * @param {string} text
 * @returns {number}
 */
function countTokens(text) {
  return text.split(/\s+/).filter((t) => t.length > 0).length;
}

/**
 * Validate one SKILL.md file.
 *
 * @param {string} skillPath — path to the SKILL.md
 * @returns {Promise<ValidationResult>} `{ valid, issues, parsed }`
 * @throws when the file cannot be read
 */
export async function validateSkill(skillPath) {
  return validateSkillContent(await readFile(skillPath, 'utf-8'));
}

/**
 * Apply the four corpus rules to a SKILL.md body held in memory.
 *
 * @param {string} content — the full file text
 * @returns {ValidationResult} `{ valid, issues, parsed }`
 */
export function validateSkillContent(content) {
  /** @type {Issue[]} */
  const issues = [];

  const hasFrontmatter = /^---\s*\n[\s\S]+?\n---\s*\n?/.test(content);
  const fm = hasFrontmatter ? parseFrontmatter(content) : {};
  const name = typeof fm.name === 'string' ? fm.name.trim() : '';
  const description = typeof fm.description === 'string' ? fm.description.trim() : '';
  const keywords = Array.isArray(fm.keywords) ? fm.keywords : [];
  const domains = Array.isArray(fm.domains) ? fm.domains : [];
  const version = typeof fm.version === 'string' ? fm.version : '';
  const body = content.replace(/^---\s*\n[\s\S]+?\n---\s*\n?/, '').trim();

  const parsed = {
    hasFrontmatter,
    name,
    description,
    keywords,
    domains,
    version,
    descriptionLength: description.length,
    contentTokens: countTokens(body),
  };

  // ── Rule 1: frontmatter present ────────────────────────────────────────
  if (!hasFrontmatter) {
    issues.push({
      field: 'frontmatter',
      message: 'No YAML frontmatter block — the file must start with --- and close with ---',
    });
  }

  // ── Rule 2: name present ───────────────────────────────────────────────
  if (!name) {
    issues.push({ field: 'name', message: 'Missing or empty name field' });
  }

  // ── Rule 3: description present and 40-400 characters ──────────────────
  if (!description) {
    issues.push({ field: 'description', message: 'Missing or empty description field' });
  } else if (description.length < MIN_DESC_LEN) {
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

  // ── Rule 4: name is {domain}-{specific} ────────────────────────────────
  if (name && !NAME_SHAPE.test(name)) {
    issues.push({
      field: 'name',
      message:
        `Name "${name}" does not match the {domain}-{specific} shape ` +
        '(lowercase segments joined by hyphens, e.g. backend-eloquent)',
    });
  }

  return { valid: issues.length === 0, issues, parsed };
}

/**
 * Validate a list of SKILL.md paths.
 *
 * A path that cannot be read produces an invalid entry carrying the read error
 * rather than aborting the batch, so one bad file does not hide the rest of a
 * 200-skill corpus. The failure is preserved as an issue, not swallowed.
 *
 * @param {string[]} skillPaths
 * @returns {Promise<Array<{path: string, result: ValidationResult}>>}
 */
export async function validateSkills(skillPaths) {
  const results = [];
  for (const path of skillPaths) {
    try {
      results.push({ path, result: await validateSkill(path) });
    } catch (err) {
      results.push({
        path,
        result: {
          valid: false,
          issues: [{ field: 'file', message: `Cannot read file: ${err.message}` }],
          parsed: {
            hasFrontmatter: false,
            name: '',
            description: '',
            keywords: [],
            domains: [],
            version: '',
            descriptionLength: 0,
            contentTokens: 0,
          },
        },
      });
    }
  }
  results.sort((a, b) => a.path.localeCompare(b.path));
  return results;
}
