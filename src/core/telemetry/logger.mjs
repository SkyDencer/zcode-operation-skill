/**
 * Structured JSONL logger for the Skill Router.
 *
 * Appends one JSON object per line to a date-rotated log file
 * under logs/<timestamp>.jsonl.
 *
 * Privacy: raw prompt text is NEVER written. Any record carrying a `query` or
 * `prompt` field is passed through `sanitizeRecord()` in `logRecord()`, which
 * replaces the raw value with a non-reversible SHA-256 hash (`queryHash` /
 * `promptHash`). This is the single gate every write path (retrieve, route,
 * cache, budget, error, build) flows through, so no raw prompt ever reaches a
 * log file on disk.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const LOG_DIR = resolve('logs');

/**
 * Return the path for today's log file.
 * @returns {string}
 */
function logPath() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
  return resolve(LOG_DIR, `${date}.jsonl`);
}

/**
 * SHA-256 hex digest of a value (empty string for null/undefined).
 *
 * @param {string|undefined|null} text
 * @returns {string} 64-char hex digest
 */
function sha256Hex(text) {
  return createHash('sha256').update(text ?? '').digest('hex');
}

/**
 * Replace raw prompt-bearing fields with non-reversible hashes so no raw
 * prompt text is ever persisted. `query` -> `queryHash`, `prompt` ->
 * `promptHash`. Other fields pass through untouched.
 *
 * @param {object} record
 * @returns {object} a new record safe to write to disk
 */
function sanitizeRecord(record) {
  const out = { ...record };
  if ('query' in out) {
    out.queryHash = sha256Hex(out.query);
    delete out.query;
  }
  if ('prompt' in out) {
    out.promptHash = sha256Hex(out.prompt);
    delete out.prompt;
  }
  return out;
}

/**
 * Append a structured log record as a single JSON line.
 *
 * Raw prompt text (`query` / `prompt`) is replaced by a SHA-256 hash before
 * the record is written, so the log file never contains a raw prompt.
 *
 * @param {object} record — arbitrary key-value pairs to log
 */
export async function logRecord(record) {
  try {
    await mkdir(LOG_DIR, { recursive: true });
    const entry = { ts: new Date().toISOString(), ...sanitizeRecord(record) };
    await appendFile(logPath(), JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // Fail silently — logging must not break the hook
  }
}

/**
 * Log a retrieval event. `opts.query` is the raw prompt; it is replaced by a
 * `queryHash` before the record is written (see `logRecord`).
 *
 * @param {object} opts
 * @param {string} opts.query
 * @param {number} opts.resultCount
 * @param {number} opts.durationMs
 */
export async function logRetrieve(opts) {
  await logRecord({ event: 'retrieve', ...opts });
}

/**
 * Log a build event.
 *
 * @param {object} opts
 * @param {number} opts.totalDocs
 * @param {number} opts.totalTerms
 * @param {number} opts.durationMs
 */
export async function logBuild(opts) {
  await logRecord({ event: 'build', ...opts });
}

/**
 * Log an error event. `opts.query` (the raw prompt, if present) is replaced by
 * a `queryHash` before the record is written (see `logRecord`).
 *
 * @param {object} opts
 * @param {string} opts.query
 * @param {string} opts.error
 */
export async function logError(opts) {
  await logRecord({ event: 'error', ...opts });
}
