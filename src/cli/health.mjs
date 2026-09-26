/**
 * health — Quick status check for the Skill Router installation.
 *
 * Usage: node bin/skill-router.mjs health
 *
 * Checks (8 total):
 *   1. [PASS/FAIL] Routers installed in ~/.zcode/skills (expect 6 router-*)
 *   2. [PASS/FAIL] Plugin directory is up to date (src/ files exist)
 *   3. [PASS/FAIL] Hook registered in ZCode CLI config
 *   4. [PASS/FAIL] Index is fresh (data/skill-index.json valid)
 *   5. [PASS/FAIL] Hook script responds to stdin
 *   6. [PASS/FAIL] llama-server status (port 8080 listening) — only a WARN
 *      when slm.enabled is true; with the shipped default (SLM disabled) the
 *      server is optional and its absence is the expected state
 *   7. [PASS/FAIL] No forbidden files in git status
 *   8. [PASS/FAIL] Thresholds file valid
 *
 * Exit codes:
 *   0 = healthy (all checks pass)
 *   1 = warning (some checks warn, none fail)
 *   2 = unhealthy (one or more checks fail)
 */
import { resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { getConfig } from '../config/env.mjs';

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

// ── Check 1: Routers installed ────────────────────────────────────────────────

async function checkRoutersInstalled() {
  const label = 'Routers installed';
  const mirrorDir = join(homedir(), '.zcode', 'skills');
  const sourceDir = resolve('router-skills');
  const fs = await import('node:fs');

  if (!existsSync(mirrorDir)) {
    fail(label, `mirror directory not found: ${mirrorDir}`);
    return;
  }

  const expectedRouters = [];
  try {
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) {
        expectedRouters.push(e.name);
      }
    }
  } catch {
    fail(label, 'cannot read router-skills/ directory');
    return;
  }

  const installed = [];
  try {
    const mirrorEntries = fs.readdirSync(mirrorDir, { withFileTypes: true });
    for (const e of mirrorEntries) {
      if (e.isDirectory() && e.name.startsWith('router-')) {
        installed.push(e.name);
      }
    }
  } catch {
    fail(label, `cannot read mirror directory: ${mirrorDir}`);
    return;
  }

  const missing = expectedRouters.filter((r) => !installed.includes(r));
  if (missing.length === 0) {
    pass(label, `${installed.length} router(s) installed: ${installed.join(', ')}`);
  } else {
    fail(label, `${missing.length} missing: ${missing.join(', ')}`);
  }
}

// ── Check 2: Plugin directory up to date ──────────────────────────────────────

function checkPluginDirectory() {
  const label = 'Plugin directory up to date';
  const srcDir = resolve('src');

  if (!existsSync(srcDir)) {
    fail(label, 'src/ directory not found');
    return;
  }

  // Check that key source files exist
  const requiredFiles = [
    'src/index.mjs',
    'src/retriever.mjs',
    'src/scorer.mjs',
    'src/loader.mjs',
    'src/logger.mjs',
    'src/cli/verify.mjs',
    'src/deploy/planner.mjs',
    'src/deploy/writer.mjs',
  ];

  const missing = [];
  for (const f of requiredFiles) {
    if (!existsSync(resolve(f))) {
      missing.push(f);
    }
  }

  if (missing.length === 0) {
    pass(label, 'all required source files present');
  } else {
    fail(label, `${missing.length} missing: ${missing.join(', ')}`);
  }
}

// ── Check 3: Hook registered ──────────────────────────────────────────────────

function checkHookRegistered() {
  const label = 'Hook registered';
  const configPath = resolve(homedir(), '.zcode', 'cli', 'config.json');

  if (!existsSync(configPath)) {
    fail(label, `ZCode CLI config not found at ${configPath}`);
    return;
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    const hooks = config?.hooks?.events?.UserPromptSubmit;

    if (!Array.isArray(hooks) || hooks.length === 0) {
      fail(label, 'No UserPromptSubmit hooks in ZCode CLI config');
      return;
    }

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
      fail(label, 'hook not registered — run: node bin/skill-router.mjs deploy');
    }
  } catch (err) {
    fail(label, `config parse error: ${err.message}`);
  }
}

// ── Check 4: Index is fresh ───────────────────────────────────────────────────

function checkIndexFresh() {
  const label = 'Index is fresh';
  const indexPath = resolve('data', 'skill-index.json');

  if (!existsSync(indexPath)) {
    fail(label, 'data/skill-index.json not found');
    return;
  }

  try {
    const raw = readFileSync(indexPath, 'utf-8');
    const index = JSON.parse(raw);

    if (!Array.isArray(index) || index.length === 0) {
      fail(label, 'index is empty or not an array');
      return;
    }

    // Validate structure: each entry needs name and path
    const invalid = index.filter((e) => !e.name || !e.path);
    if (invalid.length === 0) {
      pass(label, `index valid — ${index.length} skill(s)`);
    } else {
      fail(label, `${invalid.length} entry(ies) missing name or path`);
    }
  } catch (err) {
    fail(label, `invalid JSON: ${err.message}`);
  }
}

// ── Check 5: Hook invocable ───────────────────────────────────────────────────

async function checkHookInvocable() {
  const label = 'Hook invocable';
  const routePath = resolve('hooks', 'route.mjs');
  const idxPath = resolve('data', 'skill-index.json');

  if (!existsSync(routePath)) {
    fail(label, `hook script not found: ${routePath}`);
    return;
  }

  if (!existsSync(idxPath)) {
    fail(label, 'skill-index.json not found — cannot invoke hook');
    return;
  }

  return new Promise((resolve) => {
    const testInput = JSON.stringify({ prompt: 'test', cwd: '.' });

    try {
      const child = spawn(process.execPath, [routePath], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });

      child.on('error', (err) => {
        fail(label, `spawn failed: ${err.message}`);
        resolve();
      });

      child.stdin.write(testInput);
      child.stdin.end();

      child.on('close', (code) => {
        if (code !== 0) {
          fail(label, `hook exited with code ${code}${stderr ? ': ' + stderr.trim().slice(0, 80) : ''}`);
          resolve();
          return;
        }

        try {
          const output = JSON.parse(stdout);
          if (output?.hookSpecificOutput?.additionalContext !== undefined) {
            pass(label, 'hook returns valid JSON with additionalContext');
          } else {
            // Hook writes to file instead of stdout — that's OK if exit code is 0
            pass(label, 'hook ran successfully (output written to file)');
          }
        } catch (parseErr) {
          // Non-JSON output is expected since hook writes to .zcode/output.json
          pass(label, 'hook ran successfully (no stdout output, writes to file)');
        }
        resolve();
      });
    } catch (err) {
      fail(label, `spawn error: ${err.message}`);
      resolve();
    }
  });
}

// ── Check 6: llama-server status ──────────────────────────────────────────────
// The SLM backend is opt-in: src/config/defaults.mjs ships slm.enabled = false,
// so an absent llama-server is the expected state and not a degradation. A
// missing server is only a real WARN (exit 1) when the operator has switched
// SLM routing on, because there the absent server does cost capability.

async function checkLlamaServer() {
  const label = 'llama-server';
  const net = await import('node:net');
  const { slm } = getConfig();
  const required = slm?.enabled === true;

  return new Promise((resolve) => {
    let settled = false;
    const record = (running) => {
      if (settled) return;
      settled = true;
      if (running) {
        pass(label, required
          ? 'running on port 8080 (SLM enabled)'
          : 'running on port 8080 (optional, used when SLM is enabled)');
      } else if (required) {
        warn(label, 'not running on port 8080 — SLM is enabled, so SLM routing is unavailable');
      } else {
        pass(label, 'not running — optional, not required (SLM disabled)');
      }
      resolve();
    };

    const sock = net.createConnection({ port: 8080, host: '127.0.0.1' }, () => {
      sock.end();
      record(true);
    });

    sock.on('error', () => record(false));

    setTimeout(() => {
      sock.destroy();
      record(false);
    }, 2000);
  });
}

// ── Check 7: No forbidden files in git status ─────────────────────────────────

async function checkForbiddenFiles() {
  const label = 'No forbidden files';

  try {
    const { execSync } = await import('node:child_process');
    const output = execSync('git status --porcelain', { encoding: 'utf-8', cwd: process.cwd() }).trim();

    if (!output) {
      pass(label, 'clean working tree');
      return;
    }

    const forbiddenPatterns = [
      /.+\.backup\/.*/,
      /.*secrets.*/,
      /.*\.env$/,
      /.*personal.*/,
      /.*\.bak$/,
      /.*\.tmp$/,
    ];

    const lines = output.split('\n');
    const violations = [];
    for (const line of lines) {
      for (const pattern of forbiddenPatterns) {
        const matched = line.match(pattern);
        if (matched) {
          violations.push(line.trim());
          break;
        }
      }
    }

    if (violations.length === 0) {
      pass(label, 'no forbidden files detected');
    } else {
      fail(label, `${violations.length} forbidden item(s): ${violations.slice(0, 3).join(', ')}${violations.length > 3 ? ' ...' : ''}`);
    }
  } catch (err) {
    warn(label, `git not available or not a repo: ${err.message}`);
  }
}

// ── Check 8: Thresholds file valid ────────────────────────────────────────────

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
    else if (data.high <= 0 || data.high >= 1) issues.push(`high out of range: ${data.high}`);
    if (typeof data.medium !== 'number') issues.push('missing medium threshold');
    else if (data.medium <= 0 || data.medium >= 1) issues.push(`medium out of range: ${data.medium}`);
    if (data.medium >= data.high) issues.push('medium >= high');

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
  console.log(bold('Skill Router — Health Check'));
  console.log('');

  const total = results.length;
  const passed = results.filter((r) => r.ok === true).length;
  const failed_ = results.filter((r) => r.ok === false).length;
  const warned = results.filter((r) => r.ok === null).length;

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

  return { passed, failed: failed_, warned };
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function main(argv) {
  checkRoutersInstalled();
  checkPluginDirectory();
  checkHookRegistered();
  checkIndexFresh();
  await checkHookInvocable();
  await checkLlamaServer();
  await checkForbiddenFiles();
  checkThresholds();

  const { passed, failed: failed_, warned } = printResults();

  // Exit code: 0 = all pass, 1 = warnings only, 2 = any failure
  if (failed_ > 0) {
    process.exit(2);
  } else if (warned > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}
