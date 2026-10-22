/**
 * Logger privacy regression test.
 *
 * Guards the Phase 7 pre-tag security fix: the structured JSONL logger
 * (src/core/telemetry/logger.mjs) must NEVER write a raw prompt to a log file.
 * Any record carrying a `query` or `prompt` field is replaced on disk with a
 * non-reversible `queryHash` / `promptHash` (SHA-256). This test writes
 * marker-tagged records through every public write path and asserts that the
 * on-disk line has the hash and not the raw text.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { logRecord, logRetrieve, logError } from '../../src/core/telemetry/logger.mjs';

// Resolve the log file the same way the logger does (cwd-relative `logs/`),
// so we always read the file the logger actually writes.
const LOG_DIR = resolve('logs');
const DAY = new Date().toISOString().slice(0, 10);
const LOG_FILE = resolve(LOG_DIR, `${DAY}.jsonl`);

const sha = (s) => createHash('sha256').update(s ?? '').digest('hex');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log('  ✓', msg);
  } else {
    failed++;
    console.error('  ✗', msg);
  }
}

// Unique markers so we can find exactly the lines this test appended.
const M = {
  retrieve: 'LOGGER_PRIVACY_RETRIEVE_XK4',
  record: 'LOGGER_PRIVACY_RECORD_QZ9',
  error: 'LOGGER_PRIVACY_ERROR_MT2',
  budget: 'LOGGER_PRIVACY_BUDGET_WN7',
};
const MARKERS = Object.values(M);

function linesWith(marker) {
  if (!existsSync(LOG_FILE)) return [];
  const content = readFileSync(LOG_FILE, 'utf-8');
  return content
    .split('\n')
    .filter((l) => l.includes(marker))
    .map((l) => JSON.parse(l));
}

// Collect the lines that existed before we write anything, so cleanup only
// removes what this test added.
function currentMarkerLines() {
  if (!existsSync(LOG_FILE)) return [];
  return readFileSync(LOG_FILE, 'utf-8')
    .split('\n')
    .filter((l) => MARKERS.some((m) => l.includes(m)));
}

async function main() {
  mkdirSync(LOG_DIR, { recursive: true });
  const before = currentMarkerLines();

  const RAW_QUERY = 'SECRET-RAW-QUERY-DO-NOT-LEAK-alpha';
  const RAW_PROMPT = 'SECRET-RAW-PROMPT-DO-NOT-LEAK-bravo';

  console.log('\n=== Logger Privacy Tests ===\n');

  await logRetrieve({ query: RAW_QUERY, resultCount: 1, durationMs: 3, marker: M.retrieve });
  await logRecord({ event: 'route', query: RAW_QUERY, tier: 'bm25', marker: M.record });
  await logError({ query: RAW_QUERY, error: 'boom', marker: M.error });
  await logRecord({ event: 'budget', prompt: RAW_PROMPT, marker: M.budget });

  const retrieve = linesWith(M.retrieve).pop();
  const record = linesWith(M.record).pop();
  const error = linesWith(M.error).pop();
  const budget = linesWith(M.budget).pop();

  console.log('retrieve / route / error / budget records');
  assert(!!retrieve, 'retrieve record was written');
  assert(!!record, 'route record was written');
  assert(!!error, 'error record was written');
  assert(!!budget, 'budget record was written');

  if (retrieve) {
    assert(retrieve.queryHash === sha(RAW_QUERY), 'retrieve carries queryHash = SHA-256 of the prompt');
    assert(!('query' in retrieve), 'retrieve record has no raw `query` field');
  }
  if (record) {
    assert(record.queryHash === sha(RAW_QUERY), 'route record carries queryHash');
    assert(!('query' in record), 'route record has no raw `query` field');
  }
  if (error) {
    assert(error.queryHash === sha(RAW_QUERY), 'error record carries queryHash');
    assert(!('query' in error), 'error record has no raw `query` field');
  }
  if (budget) {
    assert(budget.promptHash === sha(RAW_PROMPT), 'budget record carries promptHash = SHA-256 of the prompt');
    assert(!('prompt' in budget), 'budget record has no raw `prompt` field');
  }

  // The raw secrets must not appear anywhere in the log file at all.
  const content = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf-8') : '';
  assert(!content.includes(RAW_QUERY), 'raw query text is absent from the log file');
  assert(!content.includes(RAW_PROMPT), 'raw prompt text is absent from the log file');

  // ── Cleanup: remove only the marker lines this test appended ────────────
  const existing = existsSync(LOG_FILE)
    ? readFileSync(LOG_FILE, 'utf-8').split('\n').filter(Boolean)
    : [];
  const kept = existing.filter((l) => !MARKERS.some((m) => l.includes(m)));
  void before;
  writeFileSync(LOG_FILE, kept.map((l) => l + '\n').join(''), 'utf-8');

  console.log('\n=== Results ===');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('logger-privacy test crashed:', err);
  process.exit(1);
});
