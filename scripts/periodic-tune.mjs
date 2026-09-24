#!/usr/bin/env node
/**
 * periodic-tune — Daily automated tuning job for Task Scheduler / cron.
 *
 * Runs `skill-router tune --auto --threshold N` once per day.
 * Safe when llama-server is off (BM25-only mode, no SLM dependency).
 *
 * Usage:
 *   node scripts/periodic-tune.mjs [--threshold N] [--log <path>]
 *
 * Environment variables:
 *   TUNE_THRESHOLD  — minimum outcomes required (default 20)
 *   TUNE_LOG        — path to append status log lines
 */
import { resolve } from 'node:path';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

/**
 * Strip ANSI escape codes from a string.
 */
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

const ROOT = resolve('.');
const CLI = resolve(ROOT, 'bin', 'skill-router.mjs');
const DEFAULT_LOG = resolve(ROOT, 'logs', 'periodic-tune.log');
const DEFAULT_THRESHOLD = 20;

// Parse CLI args
const args = process.argv.slice(2);
let threshold = DEFAULT_THRESHOLD;
let logPath = DEFAULT_LOG;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--threshold' && args[i + 1]) {
    const v = parseInt(args[++i], 10);
    if (!Number.isNaN(v) && v >= 1) threshold = v;
  } else if (args[i] === '--log' && args[i + 1]) {
    logPath = resolve(args[++i]);
  }
}

// Also check env vars
const envThreshold = process.env.TUNE_THRESHOLD;
if (envThreshold) {
  const v = parseInt(envThreshold, 10);
  if (!Number.isNaN(v) && v >= 1) threshold = v;
}
const envLog = process.env.TUNE_LOG;
if (envLog) logPath = resolve(envLog);

/**
 * Log a status line.
 */
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    mkdirSync(resolve(logPath, '..'), { recursive: true });
    appendFileSync(logPath, line, 'utf-8');
  } catch {
    // Fail silently — logging must not break the job
  }
  console.log(line.trimEnd());
}

/**
 * Run the tune --auto command and return exit code.
 */
function runTune() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, 'tune', '--auto', '--threshold', String(threshold)], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; })
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on('error', (err) => {
      resolve({ code: 1, stdout: '', stderr: err.message });
    });
  });
}

/**
 * Main entry point.
 */
async function main() {
  log(`Starting periodic tune (threshold=${threshold}, log=${logPath})`);

  // Check that required files exist
  const indexExists = existsSync(resolve(ROOT, 'data', 'skill-index.json'));
  if (!indexExists) {
    log('ERROR: data/skill-index.json not found — skipping tune');
    process.exit(0); // Exit 0 for cron safety (no data to tune)
  }

  const result = await runTune();

  if (result.code === 0) {
    log(`tune --auto completed successfully (exit 0)`);
  } else if (result.code === 1) {
    // Exit code 1 from tune may mean "refused by guardrail" or "no snapshots"
    // Both are safe states — not an error
    const stderr = stripAnsi(result.stderr.trim());
    if (stderr.includes('refuse') || stderr.includes('No snapshots')) {
      log(`tune --auto exited ${result.code}: ${stderr.slice(0, 100)}`);
    } else {
      log(`tune --auto exited ${result.code}: ${stderr.slice(0, 200)}`);
    }
  } else {
    log(`tune --auto exited ${result.code}: ${stripAnsi(result.stderr.trim()).slice(0, 200)}`);
  }

  // Exit 0 for cron — we never want the scheduler to think this failed
  process.exit(0);
}

main().catch((err) => {
  log(`Fatal error: ${err.message}`);
  process.exit(0);
});
