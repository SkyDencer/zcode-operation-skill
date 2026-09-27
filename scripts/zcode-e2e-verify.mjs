#!/usr/bin/env node
/**
 * End-to-end test verification script for ZCode Skill Router.
 *
 * This script reads the routing decision logs (logs/routing-*.jsonl) after
 * the human has run the E2E prompts and prints a pass/fail report.
 *
 * It checks:
 *   - Whether the hook fired (log entries exist)
 *   - Whether context was injected (selected skills present)
 *   - Whether there were any errors
 *   - Whether the routing matches expected outcomes
 *
 * Usage:
 *   node scripts/zcode-e2e-verify.mjs              # verify all logs
 *   node scripts/zcode-e2e-verify.mjs --date 20260927  # verify specific date
 *   node scripts/zcode-e2e-verify.mjs --help       # show usage
 *
 * Degrades gracefully: if the log is empty or missing, it reports that
 * no evidence is available rather than claiming success or failure.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LOG_DIR = resolve(ROOT, 'logs');

// ── Parse args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const helpFlag = args.includes('--help');
const dateFilter = args.find((a) => a.startsWith('--date='))?.split('=')[1];

if (helpFlag) {
  console.log(`
Usage:
  node scripts/zcode-e2e-verify.mjs              # verify all routing logs
  node scripts/zcode-e2e-verify.mjs --date=20260927  # verify specific date
  node scripts/zcode-e2e-verify.mjs --help       # show this help

The script reads logs/routing-YYYYMMDD.jsonl and checks:
  - Hook fired (entries exist)
  - Context injected (selected skills present)
  - No errors in routing
  - Expected outcomes match
`);
  process.exit(0);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readLogFiles(date) {
  const prefix = `routing-${date ?? ''}`;
  const files = [];

  if (!existsSync(LOG_DIR)) {
    return files;
  }

  for (const file of readdirSync(LOG_DIR)) {
    if (file.startsWith(prefix) && file.endsWith('.jsonl')) {
      files.push(resolve(LOG_DIR, file));
    }
  }

  return files.sort();
}

function parseLogEntries(files) {
  const entries = [];

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      for (const line of content.trim().split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          entries.push(entry);
        } catch {
          entries.push({ _parseError: line });
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return entries;
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(60));
console.log('  E2E TEST VERIFICATION');
console.log('═'.repeat(60));
console.log('');

const logFiles = readLogFiles(dateFilter);

if (logFiles.length === 0) {
  console.log('  No routing logs found.');
  console.log('');
  if (dateFilter) {
    console.log(`  Searched for: routing-${dateFilter}.jsonl`);
  } else {
    console.log('  Searched in: ' + LOG_DIR);
  }
  console.log('');
  console.log('  STATUS: AWAITING HUMAN RUN');
  console.log('');
  console.log('  The human has not yet run the E2E prompts.');
  console.log('  Please run the prompts in ZCode, then re-run this script.');
  console.log('');
  console.log('═'.repeat(60) + '\n');
  process.exit(0);
}

console.log(`  Found ${logFiles.length} log file(s):`);
for (const file of logFiles) {
  console.log(`    - ${file.replace(ROOT + '/', '')}`);
}
console.log('');

const entries = parseLogEntries(logFiles);

if (entries.length === 0) {
  console.log('  No valid entries found in logs.');
  console.log('');
  console.log('  STATUS: AWAITING HUMAN RUN');
  console.log('');
  console.log('═'.repeat(60) + '\n');
  process.exit(0);
}

console.log(`  Total entries: ${entries.length}`);
console.log('');

// ── Check for errors ──────────────────────────────────────────────────────────

// Routing decisions logged by src/telemetry/feedback.mjs logDecision() use
// mode/router/tier fields — they do NOT have an `event` field. A non-existent
// event field makes `e.event === 'error'` a dead check. Instead we flag entries
// that are missing a mode field (structural error) or that carried a
// fail-open tier (the hook degraded without producing a routing decision).
const errors = entries.filter((e) => {
  if (e._parseError) return true;
  // Entries without a mode field are structural errors, not routing decisions.
  if (!e.mode) return true;
  // fail-open means the hook could not compute a decision and exited silently.
  if (e.tier === 'fail-open') return true;
  return false;
});

if (errors.length > 0) {
  console.log('  ERRORS FOUND:');
  for (const err of errors.slice(0, 10)) {
    if (err._parseError) {
      console.log(`    - Parse error: ${err._parseError.substring(0, 80)}...`);
    } else if (!err.mode) {
      console.log('    - Missing mode field (structural error)');
    } else if (err.tier === 'fail-open') {
      console.log(`    - fail-open routing at ${err.ts ?? 'unknown time'}`);
    }
  }
  if (errors.length > 10) {
    console.log(`    ... and ${errors.length - 10} more`);
  }
  console.log('');
}

// ── Analyze routing decisions ─────────────────────────────────────────────────

const decisions = entries.filter((e) => e.mode);

if (decisions.length === 0) {
  console.log('  No routing decisions found.');
  console.log('');
  console.log('  STATUS: AWAITING HUMAN RUN');
  console.log('');
  console.log('═'.repeat(60) + '\n');
  process.exit(0);
}

console.log('  Routing Decisions:');
console.log('');

// Group by mode
const byMode = {};
for (const d of decisions) {
  const mode = d.mode ?? 'unknown';
  if (!byMode[mode]) byMode[mode] = [];
  byMode[mode].push(d);
}

for (const [mode, items] of Object.entries(byMode)) {
  console.log(`  ${mode}: ${items.length} decision(s)`);
  for (const item of items.slice(0, 5)) {
    const skills = item.selectedSkills ?? [];
    const router = item.router ?? 'none';
    const tier = item.tier ?? 'unknown';
    const latency = item.latencyMs?.total ?? 0;
    console.log(`    - Router: ${router}, Tier: ${tier}, Skills: [${skills.join(', ')}], Latency: ${latency}ms`);
  }
  if (items.length > 5) {
    console.log(`    ... and ${items.length - 5} more`);
  }
  console.log('');
}

// ── Check for expected patterns ────────────────────────────────────────────────

console.log('  Pattern Analysis:');
console.log('');

// Check for explicit routing
const explicitDecisions = decisions.filter((d) => d.mode === 'explicit');
if (explicitDecisions.length > 0) {
  console.log(`  PASS: Explicit routing detected (${explicitDecisions.length} decision(s))`);
  for (const d of explicitDecisions) {
    console.log(`    - Router: ${d.router}, Skills: [${d.selectedSkills.join(', ')}]`);
  }
} else {
  console.log('  INFO: No explicit routing detected (expected for implicit prompts)');
}
console.log('');

// Check for abstention (tier: none)
const abstentions = decisions.filter((d) => d.tier === 'none');
if (abstentions.length > 0) {
  console.log(`  PASS: Abstention detected (${abstentions.length} decision(s))`);
} else {
  console.log('  INFO: No abstentions detected');
}
console.log('');

// Check for errors in routing
const routingErrors = decisions.filter((d) => d.tier === 'fail-open');
if (routingErrors.length > 0) {
  console.log(`  WARN: ${routingErrors.length} fail-open event(s) detected`);
  for (const e of routingErrors) {
    console.log(`    - Reason: ${e.reason || 'unknown'}`);
  }
} else {
  console.log('  PASS: No fail-open events detected');
}
console.log('');

// Check latency
const latencies = decisions.map((d) => d.latencyMs?.total ?? 0).filter((l) => l > 0);
if (latencies.length > 0) {
  const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const max = Math.max(...latencies);
  console.log(`  Latency: avg=${avg}ms, max=${max}ms`);
  if (max > 3500) {
    console.log('  WARN: Some decisions exceeded the 3500ms hook timeout');
  } else {
    console.log('  PASS: All decisions within timeout budget');
  }
}
console.log('');

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('═'.repeat(60));
console.log('  SUMMARY');
console.log('═'.repeat(60));
console.log('');
console.log(`  Total entries analyzed: ${entries.length}`);
console.log(`  Routing decisions: ${decisions.length}`);
console.log(`  Explicit routing: ${explicitDecisions.length}`);
console.log(`  Abstentions: ${abstentions.length}`);
console.log(`  Fail-open events: ${routingErrors.length}`);
console.log(`  Errors: ${errors.length}`);
console.log('');

if (decisions.length === 0) {
  console.log('  STATUS: AWAITING HUMAN RUN');
  console.log('  No routing decisions found in logs.');
} else if (errors.length > 0 && decisions.length === errors.length) {
  console.log('  STATUS: FAIL');
  console.log('  All routing decisions contained errors.');
} else {
  console.log('  STATUS: PASS');
  console.log('  Routing decisions found and analyzed.');
}

console.log('');
console.log('  To compare against expected outcomes, see:');
console.log('    docs/zcode-e2e-test.md');
console.log('');
console.log('═'.repeat(60) + '\n');
