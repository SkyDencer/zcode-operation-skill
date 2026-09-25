/**
 * Disabler — manage disabled skills in the ZCode mirror.
 *
 * ZCode has no built-in per-skill disable mechanism. Skills are discovered
 * by filesystem presence in configured scan paths (~/.zcode/skills/, etc.).
 *
 * This module implements a best-guess mechanism guarded by --experimental-disable:
 *   - disableSkill : Remove the mirror directory of a managed skill.
 *                    ZCode will no longer discover it.
 *   - enableSkill  : Re-copy the skill from the project source into the mirror.
 *
 * Safety: Only mirror directories bearing .skill-router-meta.json are touched.
 * User-created / hand-edited skills (no meta) are never modified or deleted.
 * Every derived path must resolve inside the mirror (and project) root.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  copyFileSync,
  mkdirSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { isWithinRoot } from '../utils/fs.mjs';

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SkillEntry
 * @property {string} name — skill directory name (e.g. "backend-eloquent")
 * @property {string} path — relative path from skills root (e.g. "backend/eloquent")
 * @property {string} hash — SHA-256 hex digest of SKILL.md content
 */

/**
 * @typedef {'mirror' | 'shadow'} DisableMechanism
 *
 * mirror  — Delete the managed mirror directory entirely.
 *           ZCode stops discovering the skill because SKILL.md is gone.
 *           (Primary mechanism; requires the skill to have a .skill-router-meta.json.)
 *
 * shadow  — Create an empty SKILL.md with disabled: true frontmatter at the same
 *           path, shadowing the real skill. ZCode discovers the shadow first (same
 *           path) and loads a no-op skill. The real directory is left in place so
 *           enable can restore it by overwriting the shadow.
 *           (Fallback for environments where directory deletion is undesirable.)
 */

/**
 * @typedef {Object} DisableResult
 * @property {boolean} success
 * @property {string}  message
 * @property {'mirror'|'shadow'} [mechanism]
 */

// ── Constants ──────────────────────────────────────────────────────────────────

const META_FILENAME = '.skill-router-meta.json';
const SKILL_FILE_NAME = 'SKILL.md';

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Read the .skill-router-meta.json for a mirror skill directory, if present.
 */
function readMeta(mirrorSkillDir) {
  const metaPath = join(mirrorSkillDir, META_FILENAME);
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Read a SKILL.md file and return its content, or null if missing.
 */
function readSkillContent(skillDir) {
  const skillPath = join(skillDir, SKILL_FILE_NAME);
  if (!existsSync(skillPath)) return null;
  try {
    return readFileSync(skillPath, 'utf-8');
  } catch {
    return null;
  }
}

// ── Core API ───────────────────────────────────────────────────────────────────

/**
 * Disable a skill in the ZCode mirror.
 *
 * Removes the managed mirror directory (mirror mechanism) or writes a shadow
 * file (shadow mechanism). The skill is no longer discovered by ZCode.
 *
 * @param {string}          mirrorPath  — absolute path to the ZCode skills mirror root
 * @param {SkillEntry}      entry       — the skill to disable ({name, path, hash})
 * @param {DisableMechanism} [mechanism] — 'mirror' (default) or 'shadow'
 * @returns {DisableResult}
 */
export function disableSkill(mirrorPath, entry, mechanism = 'mirror') {
  const mirrorRoot = resolve(mirrorPath);
  const mirrorSkillDir = join(mirrorRoot, entry.path);

  // ── Guard: the entry path must stay inside the mirror root ───────────────
  // entry.path reaches us from .skill-router-disabled.json via --disable, so
  // an unsanitised name could otherwise delete or shadow outside the mirror.
  if (!isWithinRoot(mirrorRoot, mirrorSkillDir)) {
    return {
      success: false,
      message: `Cannot disable ${entry.name}: path escapes the mirror root: ${entry.path}`,
    };
  }

  // ── Guard: only touch managed directories ─────────────────────────────────
  if (mechanism === 'mirror') {
    // Idempotent: if the directory is already gone, nothing to do
    if (!existsSync(mirrorSkillDir)) {
      return {
        success: true,
        message: `${entry.name}: already absent from mirror.`,
        mechanism,
      };
    }

    const meta = readMeta(mirrorSkillDir);
    if (!meta) {
      return {
        success: false,
        message: `Cannot disable ${entry.name}: directory not managed by skill-router (no ${META_FILENAME}).`,
      };
    }

    try {
      rmSync(mirrorSkillDir, { recursive: true, force: true });
      return {
        success: true,
        message: `${entry.name}: disabled (mirror dir removed).`,
        mechanism,
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to disable ${entry.name}: ${err.message}`,
      };
    }
  }

  if (mechanism === 'shadow') {
    // Ensure the parent directory exists
    const parentDir = dirname(mirrorSkillDir);
    mkdirSync(parentDir, { recursive: true });

    const shadowContent = [
      '---',
      `name: ${entry.name}`,
      'description: This skill has been disabled.',
      'keywords: []',
      'domains: []',
      'disabled: true',
      '---',
      '',
      '# Disabled',
      '',
      'This skill is disabled via the skill-router. It will not be used by ZCode.',
    ].join('\n');

    try {
      writeFileSync(join(mirrorSkillDir, SKILL_FILE_NAME), shadowContent, 'utf-8');
      // Preserve the meta file so we can later distinguish shadow from user content
      // If meta doesn't exist, create it so enable can restore the real skill
      if (!readMeta(mirrorSkillDir)) {
        writeFileSync(join(mirrorSkillDir, META_FILENAME), JSON.stringify({
          source: 'project',
          managedBy: 'zcode-skill-router',
          hash: entry.hash,
          disabled: true,
          disabledAt: new Date().toISOString(),
        }, null, 2) + '\n', 'utf-8');
      }
      return {
        success: true,
        message: `${entry.name}: disabled (shadow written).`,
        mechanism,
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to disable ${entry.name}: ${err.message}`,
      };
    }
  }

  return {
    success: false,
    message: `Unknown disable mechanism: ${mechanism}. Use 'mirror' or 'shadow'.`,
  };
}

/**
 * Enable a previously-disabled skill by restoring it to the mirror.
 *
 * Re-copies the SKILL.md from the project source directory into the mirror.
 * Works for both mirror-mode and shadow-mode disabled skills.
 *
 * @param {string}          mirrorPath      — absolute path to the ZCode skills mirror root
 * @param {SkillEntry}      entry           — the skill to enable ({name, path, hash})
 * @param {string}          projectSkillsDir — absolute path to the project skills root
 * @param {DisableMechanism} [mechanism]     — 'mirror' (default) or 'shadow'
 * @returns {DisableResult}
 */
export function enableSkill(mirrorPath, entry, projectSkillsDir, mechanism = 'mirror') {
  const mirrorRoot = resolve(mirrorPath);
  const projectRoot = resolve(projectSkillsDir);
  const mirrorSkillDir = join(mirrorRoot, entry.path);
  const sourcePath = join(projectRoot, entry.path, SKILL_FILE_NAME);

  // ── Guard: the entry path must stay inside both roots ────────────────────
  if (!isWithinRoot(mirrorRoot, mirrorSkillDir) || !isWithinRoot(projectRoot, sourcePath)) {
    return {
      success: false,
      message: `Cannot enable ${entry.name}: path escapes the project or mirror root: ${entry.path}`,
    };
  }

  if (!existsSync(sourcePath)) {
    return {
      success: false,
      message: `Cannot enable ${entry.name}: source SKILL.md not found at ${sourcePath}`,
    };
  }

  try {
    mkdirSync(mirrorSkillDir, { recursive: true });
    copyFileSync(sourcePath, join(mirrorSkillDir, SKILL_FILE_NAME));
    writeFileSync(join(mirrorSkillDir, META_FILENAME), JSON.stringify({
      source: 'project',
      managedBy: 'zcode-skill-router',
      hash: entry.hash,
      disabled: false,
      enabledAt: new Date().toISOString(),
    }, null, 2) + '\n', 'utf-8');

    return {
      success: true,
      message: `${entry.name}: enabled (restored to mirror).`,
      mechanism,
    };
  } catch (err) {
    return {
      success: false,
      message: `Failed to enable ${entry.name}: ${err.message}`,
    };
  }
}

/**
 * Read the disabled-skills registry from the project root.
 *
 * @param {string} [projectRoot] — absolute path to the project root
 * @returns {{ disabled: string[], lastModified: string | null }}
 */
export function readDisabledRegistry(projectRoot = process.cwd()) {
  const registryPath = join(resolve(projectRoot), '.skill-router-disabled.json');
  if (!existsSync(registryPath)) {
    return { disabled: [], lastModified: null };
  }
  try {
    const data = JSON.parse(readFileSync(registryPath, 'utf-8'));
    return {
      disabled: Array.isArray(data.disabled) ? data.disabled : [],
      lastModified: data.lastModified ?? null,
    };
  } catch {
    return { disabled: [], lastModified: null };
  }
}

/**
 * Write the disabled-skills registry to the project root.
 *
 * @param {string[]} disabled       — array of skill names to disable
 * @param {string}   [projectRoot] — absolute path to the project root
 */
export function writeDisabledRegistry(disabled, projectRoot = process.cwd()) {
  const registryPath = join(resolve(projectRoot), '.skill-router-disabled.json');
  writeFileSync(registryPath, JSON.stringify({
    disabled,
    lastModified: new Date().toISOString(),
  }, null, 2) + '\n', 'utf-8');
}

// ── CLI entry point ────────────────────────────────────────────────────────────
const _cliArgv1 = process.argv[1]?.replace(/\\/g, '/') ?? '';
if (_cliArgv1 && import.meta.url.endsWith(_cliArgv1)) {
  console.log('This module is not meant to be run directly. Use: node bin/skill-router.mjs sync');
  process.exit(1);
}
