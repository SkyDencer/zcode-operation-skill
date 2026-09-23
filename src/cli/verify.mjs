/**
 * verify — Run health checks for sync state and index integrity.
 *
 * Usage: node bin/skill-router.mjs verify [--skills-dir <dir>] [--zcode-dir <dir>]
 *
 * Checks:
 *   1. Mirror directories match project skills (no drift)
 *   2. Orphan mirror directories flagged
 *   3. Meta files present in router-managed mirrors
 *   4. Index is up to date (hash matches corpus)
 *   5. Thresholds file exists and is valid
 *
 * Exit code 0 = all checks pass, 1 = one or more failures.
 */
import { resolve, join } from 'node:path';
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { planSync } from '../sync/planner.mjs';
import { readSyncState } from '../sync/state.mjs';
import { loadSkills } from '../loader.mjs';

// ── ANSI color helpers ────────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

function green(msg) {
  return `${GREEN}${msg}${RESET}`;
}
function red(msg) {
  return `${RED}${msg}${RESET}`;
}
function yellow(msg) {
  return `${YELLOW}${msg}${RESET}`;
}
function bold(msg) {
  return `${BOLD}${msg}${RESET}`;
}
function dim(msg) {
  return `${DIM}${msg}${RESET}`;
}

// ── Check result tracking ─────────────────────────────────────────────────────

const results = [];

function pass(check, detail) {
  results.push({ check, ok: true, detail });
}

function fail(check, detail) {
  results.push({ check, ok: false, detail });
}

function warn(check, detail) {
  results.push({ check, ok: null, detail });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeSkillHash(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return createHash('sha256').update(content, 'utf-8').digest('hex');
  } catch {
    return null;
  }
}

function hasMetaFile(skillDir) {
  const metaPath = join(skillDir, '.skill-router-meta.json');
  return existsSync(metaPath);
}

function readMetaFile(skillDir) {
  try {
    const content = readFileSync(join(skillDir, '.skill-router-meta.json'), 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// ── 1. Mirror sync check ─────────────────────────────────────────────────────

async function checkMirrorSync(projectSkillsDir, zcodeSkillsDir) {
  const label = 'Mirror sync status';

  let projectSkillsDirResolved = resolve(projectSkillsDir ?? join(process.cwd(), 'data', 'skills'));
  let zcodeSkillsDirResolved = zcodeSkillsDir
    ? resolve(zcodeSkillsDir)
    : process.env.SKILL_ROUTER_ZCODE_DIR
      ? resolve(process.env.SKILL_ROUTER_ZCODE_DIR)
      : join(homedir(), '.zcode', 'skills');

  try {
    const plan = await planSync(projectSkillsDirResolved, zcodeSkillsDirResolved, {
      projectRoot: process.cwd(),
    });

    if (plan.add.length === 0 && plan.update.length === 0 && plan.remove.length === 0) {
      pass(label, `mirror is in sync — ${plan.unchanged.length} skill(s) match`);
    } else {
      const parts = [];
      if (plan.add.length > 0) parts.push(`${plan.add.length} missing`);
      if (plan.update.length > 0) parts.push(`${plan.update.length} stale`);
      if (plan.remove.length > 0) parts.push(`${plan.remove.length} orphan(s)`);
      fail(label, `mirror has drift — ${parts.join(', ')}`);
    }
  } catch (err) {
    fail(label, `sync check failed: ${err.message}`);
  }
}

// ── 2. Orphan mirror directories ──────────────────────────────────────────────

async function checkOrphanMirrors(projectSkillsDir, zcodeSkillsDir) {
  const label = 'Orphan mirror directories';

  let projectSkillsDirResolved = resolve(projectSkillsDir ?? join(process.cwd(), 'data', 'skills'));
  let zcodeSkillsDirResolved = zcodeSkillsDir
    ? resolve(zcodeSkillsDir)
    : process.env.SKILL_ROUTER_ZCODE_DIR
      ? resolve(process.env.SKILL_ROUTER_ZCODE_DIR)
      : join(homedir(), '.zcode', 'skills');

  try {
    const plan = await planSync(projectSkillsDirResolved, zcodeSkillsDirResolved, {
      projectRoot: process.cwd(),
    });

    if (plan.remove.length === 0) {
      pass(label, 'no orphan directories found');
    } else {
      const names = plan.remove.map((e) => e.name).join(', ');
      fail(label, `${plan.remove.length} orphan(s): ${names}`);
    }
  } catch (err) {
    warn(label, `could not check orphans: ${err.message}`);
  }
}

// ── 3. Meta files in mirror ───────────────────────────────────────────────────

async function checkMetaFiles(projectSkillsDir, zcodeSkillsDir) {
  const label = 'Meta files in mirror';

  let projectSkillsDirResolved = resolve(projectSkillsDir ?? join(process.cwd(), 'data', 'skills'));
  let zcodeSkillsDirResolved = zcodeSkillsDir
    ? resolve(zcodeSkillsDir)
    : process.env.SKILL_ROUTER_ZCODE_DIR
      ? resolve(process.env.SKILL_ROUTER_ZCODE_DIR)
      : join(homedir(), '.zcode', 'skills');

  try {
    const plan = await planSync(projectSkillsDirResolved, zcodeSkillsDirResolved, {
      projectRoot: process.cwd(),
    });

    // Check that all unchanged skills in the mirror have a .skill-router-meta.json
    const missing = [];
    for (const entry of plan.unchanged) {
      const mirrorDir = join(zcodeSkillsDirResolved, entry.path);
      if (!hasMetaFile(mirrorDir)) {
        missing.push(entry.name);
      }
    }

    if (missing.length === 0) {
      pass(label, `all ${plan.unchanged.length} managed mirror dirs have meta files`);
    } else {
      fail(label, `${missing.length} mirror dir(s) missing meta: ${missing.join(', ')}`);
    }
  } catch (err) {
    warn(label, `could not check meta files: ${err.message}`);
  }
}

// ── 4. Index up-to-date check ─────────────────────────────────────────────────

async function checkIndexUpToDate(skillsDir) {
  const label = 'Index up to date';
  const indexPath = resolve('data', 'skill-index.json');

  if (!existsSync(indexPath)) {
    fail(label, 'skill-index.json not found');
    return;
  }

  try {
    const indexContent = readFileSync(indexPath, 'utf-8');
    const index = JSON.parse(indexContent);

    if (!Array.isArray(index) || index.length === 0) {
      fail(label, 'skill-index.json is empty or not an array');
      return;
    }

    // Build a map of expected hashes from the actual files
    const expectedHashes = new Map();
    const skills = await loadSkills(resolve(skillsDir ?? join(process.cwd(), 'data', 'skills')));
    for (const skill of skills) {
      const hash = computeSkillHash(skill.path);
      if (hash) {
        expectedHashes.set(skill.name, hash);
      }
    }

    // Each index entry should have a path that exists and matches its hash
    const mismatches = [];
    for (const entry of index) {
      const expectedHash = expectedHashes.get(entry.name);
      if (expectedHash === undefined) {
        mismatches.push(`${entry.name} (missing from corpus)`);
        continue;
      }
      const actualHash = computeSkillHash(entry.path);
      if (actualHash !== expectedHash) {
        mismatches.push(`${entry.name} (hash mismatch)`);
      }
    }

    if (mismatches.length === 0) {
      pass(label, `index is up to date — ${index.length} skill(s) match`);
    } else {
      fail(label, `${mismatches.length} mismatch(es): ${mismatches.slice(0, 5).join(', ')}${mismatches.length > 5 ? ' ...' : ''}`);
    }
  } catch (err) {
    fail(label, `index check failed: ${err.message}`);
  }
}

// ── 5. Thresholds file ────────────────────────────────────────────────────────

function checkThresholds() {
  const label = 'Thresholds file';
  const thresholdsPath = resolve('data', 'thresholds.json');

  if (!existsSync(thresholdsPath)) {
    fail(label, 'data/thresholds.json not found');
    return;
  }

  try {
    const raw = readFileSync(thresholdsPath, 'utf-8');
    const data = JSON.parse(raw);

    const issues = [];
    if (typeof data.high !== 'number') issues.push('missing high threshold');
    else if (data.high <= 0 || data.high >= 1) issues.push(`high threshold out of range: ${data.high}`);
    if (typeof data.medium !== 'number') issues.push('missing medium threshold');
    else if (data.medium <= 0 || data.medium >= 1) issues.push(`medium threshold out of range: ${data.medium}`);
    if (data.medium >= data.high) issues.push('medium >= high threshold');

    if (issues.length === 0) {
      pass(label, `valid — high=${data.high}, medium=${data.medium}`);
    } else {
      fail(label, issues.join('; '));
    }
  } catch (err) {
    fail(label, `invalid JSON: ${err.message}`);
  }
}

// ── Output ─────────────────────────────────────────────────────────────────────

function printResults() {
  console.log('');
  console.log(bold('Skill Router — Verify'));
  console.log('');

  const total = results.length;
  const passed = results.filter((r) => r.ok === true).length;
  const failed_ = results.filter((r) => r.ok === false).length;
  const warned = results.filter((r) => r.ok === null).length;

  // Header row
  const header = `${dim('Check')}${' '.repeat(38)} | ${dim('Status')}`;
  console.log(header);
  console.log(dim('─'.repeat(62)));

  for (const r of results) {
    let status;
    if (r.ok === true) {
      status = green('PASS');
    } else if (r.ok === false) {
      status = red('FAIL');
    } else {
      status = yellow('WARN');
    }
    console.log(`${r.check.padEnd(40)} | ${status}  ${r.detail ? dim(r.detail) : ''}`);
  }

  console.log(dim('─'.repeat(62)));
  const summaryParts = [];
  if (passed > 0) summaryParts.push(`${passed} passed`);
  if (failed_ > 0) summaryParts.push(`${failed_} failed`);
  if (warned > 0) summaryParts.push(`${warned} warning(s)`);
  console.log(bold(`  ${summaryParts.join(' · ')}  (${total} total)`));
  console.log('');

  return failed_ === 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function main(argv) {
  let skillsDir = null;
  let zcodeDir = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--skills-dir' && argv[i + 1]) {
      skillsDir = resolve(argv[++i]);
    } else if (argv[i] === '--zcode-dir' && argv[i + 1]) {
      zcodeDir = resolve(argv[++i]);
    }
  }

  const projectSkillsDir = skillsDir ?? join(process.cwd(), 'data', 'skills');

  await checkMirrorSync(projectSkillsDir, zcodeDir);
  await checkOrphanMirrors(projectSkillsDir, zcodeDir);
  await checkMetaFiles(projectSkillsDir, zcodeDir);
  await checkIndexUpToDate(skillsDir);
  checkThresholds();

  const allPass = printResults();
  process.exit(allPass ? 0 : 1);
}
