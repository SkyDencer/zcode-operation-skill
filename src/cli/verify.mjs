/**
 * verify — Run health checks for sync state and index integrity.
 *
 * Usage: node bin/skill-router.mjs verify [--skills-dir <dir>] [--zcode-dir <dir>] [--deep] [--json]
 *
 * Checks (default 5):
 *   1. Mirror directories match project skills (no drift)
 *   2. Orphan mirror directories flagged
 *   3. Meta files present in router-managed mirrors
 *   4. Index is up to date (hash matches corpus)
 *   5. Thresholds file exists and is valid
 *
 * Deep checks (with --deep, adds 2 more):
 *   6. Hook registered: checks if hooks.events.UserPromptSubmit in ZCode CLI config
 *      contains our hook (args includes '${ZCODE_PLUGIN_ROOT}/hooks/route.mjs')
 *   7. Hook invocable: spawns `node hooks/route.mjs` with test stdin and verifies
 *      valid JSON output with hookSpecificOutput.additionalContext field
 *
 * Exit code 0 = all checks pass, 1 = one or more failures.
 */
import { resolve, join } from 'node:path';
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
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

function green(msg) { return `${GREEN}${msg}${RESET}`; }
function red(msg) { return `${RED}${msg}${RESET}`; }
function yellow(msg) { return `${YELLOW}${msg}${RESET}`; }
function bold(msg) { return `${BOLD}${msg}${RESET}`; }
function dim(msg) { return `${DIM}${msg}${RESET}`; }

// ── Check result tracking ─────────────────────────────────────────────────────

const results = [];

function pass(check, detail) { results.push({ check, ok: true, detail }); }
function fail(check, detail) { results.push({ check, ok: false, detail }); }
function warn(check, detail) { results.push({ check, ok: null, detail }); }

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

function getZcodeCliConfigPath() {
  return resolve(homedir(), '.zcode', 'cli', 'config.json');
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

    const expectedHashes = new Map();
    const skills = await loadSkills(resolve(skillsDir ?? join(process.cwd(), 'data', 'skills')));
    for (const skill of skills) {
      const hash = computeSkillHash(skill.path);
      if (hash) {
        expectedHashes.set(skill.name, hash);
      }
    }

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

// ── 6. Hook registered (deep) ─────────────────────────────────────────────────

function checkHookRegistered() {
  const label = 'Hook registered';
  const configPath = getZcodeCliConfigPath();

  if (!existsSync(configPath)) {
    fail(label, `ZCode CLI config not found at ${configPath}`);
    return;
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    const hooks = config?.hooks?.events?.UserPromptSubmit;

    if (!Array.isArray(hooks) || hooks.length === 0) {
      fail(label, 'No UserPromptSubmit hooks configured in ZCode CLI config');
      return;
    }

    // Check if any hook references our route.mjs
    let found = false;
    for (const hookGroup of hooks) {
      const hookList = hookGroup?.hooks || [];
      for (const hook of hookList) {
        const args = hook?.args || [];
        const argsStr = JSON.stringify(args);
        if (argsStr.includes('hooks/route.mjs') || argsStr.includes('route.mjs')) {
          found = true;
          break;
        }
      }
      if (found) break;
    }

    if (found) {
      pass(label, 'hook registered in ZCode CLI config');
    } else {
      fail(label, 'hook not found in UserPromptSubmit hooks — run deploy to register');
    }
  } catch (err) {
    fail(label, `config parse error: ${err.message}`);
  }
}

// ── 7. Hook invocable (deep) ──────────────────────────────────────────────────

function checkHookInvocable() {
  const label = 'Hook invocable';
  const routePath = resolve('hooks', 'route.mjs');

  if (!existsSync(routePath)) {
    fail(label, `hook script not found: ${routePath}`);
    return;
  }

  const testInput = JSON.stringify({ prompt: 'test', cwd: '.' });
  const idxPath = resolve('data', 'skill-index.json');

  if (!existsSync(idxPath)) {
    fail(label, 'skill-index.json not found — cannot test hook invocation');
    return;
  }

  return new Promise((resolve) => {
    try {
      const child = spawn(process.execPath, [routePath], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, INDEX_PATH: idxPath },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });

      child.on('error', (err) => {
        fail(label, `failed to spawn hook: ${err.message}`);
        resolve();
      });

      child.stdin.write(testInput);
      child.stdin.end();

      child.on('close', (code) => {
        if (code !== 0) {
          fail(label, `hook exited with code ${code}${stderr ? ': ' + stderr.trim().slice(0, 100) : ''}`);
          resolve();
          return;
        }

        try {
          const output = JSON.parse(stdout);
          if (output?.hookSpecificOutput?.additionalContext !== undefined) {
            pass(label, 'hook responds with valid JSON and additionalContext field');
          } else {
            fail(label, 'hook output missing hookSpecificOutput.additionalContext');
          }
        } catch (parseErr) {
          fail(label, `hook output is not valid JSON: ${parseErr.message}`);
        }
        resolve();
      });
    } catch (err) {
      fail(label, `spawn error: ${err.message}`);
      resolve();
    }
  });
}

// ── Output ─────────────────────────────────────────────────────────────────────

function printResults(isJson, isDeep) {
  const total = results.length;
  const passed = results.filter((r) => r.ok === true).length;
  const failed_ = results.filter((r) => r.ok === false).length;
  const warned = results.filter((r) => r.ok === null).length;

  if (isJson) {
    const output = {
      checks: results.map((r) => ({
        name: r.check,
        passed: r.ok === true,
        warning: r.ok === null,
        detail: r.detail,
      })),
      passed,
      failed: failed_,
      warned,
      deep: isDeep,
    };
    console.log(JSON.stringify(output, null, 2));
    return failed_ === 0;
  }

  console.log('');
  console.log(bold('Skill Router — Verify'));
  console.log('');

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
  let deep = false;
  let isJson = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--skills-dir' && argv[i + 1]) {
      skillsDir = resolve(argv[++i]);
    } else if (argv[i] === '--zcode-dir' && argv[i + 1]) {
      zcodeDir = resolve(argv[++i]);
    } else if (argv[i] === '--deep') {
      deep = true;
    } else if (argv[i] === '--json') {
      isJson = true;
    }
  }

  const projectSkillsDir = skillsDir ?? join(process.cwd(), 'data', 'skills');

  // ── Default 5 checks ─────────────────────────────────────────────────────
  await checkMirrorSync(projectSkillsDir, zcodeDir);
  await checkOrphanMirrors(projectSkillsDir, zcodeDir);
  await checkMetaFiles(projectSkillsDir, zcodeDir);
  await checkIndexUpToDate(skillsDir);
  checkThresholds();

  // ── Deep checks 6 & 7 ────────────────────────────────────────────────────
  if (deep) {
    checkHookRegistered();
    await checkHookInvocable();
  }

  const allPass = printResults(isJson, deep);
  process.exit(allPass ? 0 : 1);
}
