/**
 * Structured JSONL logger for the Skill Router.
 *
 * Appends one JSON object per line to a date-rotated log file
 * under logs/<timestamp>.jsonl.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

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
 * Append a structured log record as a single JSON line.
 *
 * @param {object} record — arbitrary key-value pairs to log
 */
export async function logRecord(record) {
  try {
    await mkdir(LOG_DIR, { recursive: true });
    const entry = { ts: new Date().toISOString(), ...record };
    await appendFile(logPath(), JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // Fail silently — logging must not break the hook
  }
}

/**
 * Log a retrieval event.
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
 * Log an error event.
 *
 * @param {object} opts
 * @param {string} opts.query
 * @param {string} opts.error
 */
export async function logError(opts) {
  await logRecord({ event: 'error', ...opts });
}
