/**
 * Signal collection layer for the adaptive feedback system.
 *
 * Records user feedback signals (retry, rephrase, explicit_override, success,
 * dismiss) as JSONL entries in logs/signals-YYYYMMDD.jsonl. Signals are
 * separate from routing decisions and are never co-mingled with decision logs.
 *
 * Privacy-preserving: only SHA-256 hashes of prompts are stored, never raw
 * prompt text. The Signal schema uses decisionHash (a prompt hash) to link
 * signals back to decisions without exposing the original text.
 */
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const SIGNALS_LOG_DIR = resolve('logs');
const SIGNALS_PREFIX = 'signals';
const VALID_TYPES = new Set(['retry', 'dismiss', 'rephrase', 'success', 'explicit_override']);

/**
 * Hash a string with SHA-256.
 *
 * @param {string} text
 * @returns {string}
 */
export function hashText(text) {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Return the path for today's signals log file.
 *
 * @returns {string}
 */
function signalsLogPath() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return resolve(SIGNALS_LOG_DIR, `${SIGNALS_PREFIX}-${y}${m}${d}.jsonl`);
}

/**
 * Validate that a signal has the required fields and a known type.
 *
 * @param {object} signal
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateSignal(signal) {
  if (!signal || typeof signal !== 'object') {
    return { valid: false, error: 'signal must be an object' };
  }
  if (typeof signal.ts !== 'string' || !signal.ts) {
    return { valid: false, error: 'ts is required and must be a string' };
  }
  if (typeof signal.decisionHash !== 'string' || !signal.decisionHash) {
    return { valid: false, error: 'decisionHash is required and must be a string' };
  }
  if (typeof signal.type !== 'string' || !VALID_TYPES.has(signal.type)) {
    return { valid: false, error: `type must be one of: ${[...VALID_TYPES].join(', ')}` };
  }
  if (signal.details !== undefined && typeof signal.details !== 'object') {
    return { valid: false, error: 'details must be an object or omitted' };
  }
  return { valid: true };
}

/**
 * Record a user feedback signal to the daily JSONL log.
 *
 * Signals are appended (not overwritten) so that the full history is preserved
 * for later outcome correlation. The write is fire-and-forget: failures do not
 * propagate to the caller.
 *
 * @param {Signal} signal
 * @returns {Promise<void>}
 */
export async function recordSignal(signal) {
  try {
    const validation = validateSignal(signal);
    if (!validation.valid) {
      return;
    }

    await mkdir(SIGNALS_LOG_DIR, { recursive: true });
    const entry = {
      ts: signal.ts,
      decisionHash: signal.decisionHash,
      type: signal.type,
      details: signal.details ?? {},
    };
    const line = JSON.stringify(entry) + '\n';
    await appendFile(signalsLogPath(), line, 'utf-8');
  } catch {
    // Fail silently — signal logging must never break the hook
  }
}

/**
 * Read signals from logs with optional filters.
 *
 * P6-H-016: only ENOENT on the (optional) log directory or a single file, and
 * EISDIR on a single file (a directory masquerading as a signals-*.jsonl
 * entry — we never read or recurse into directories, so it holds no data),
 * are treated as "no data". Any other read error (EACCES, EPERM, EIO, ...)
 * is surfaced as a named error, because a permission failure must never be
 * mistaken for "no signals".
 *
 * @param {object} [opts]
 * @param {string} [opts.since] — YYYY-MM-DD to filter by ts prefix
 * @param {number} [opts.limit] — max results to return
 * @param {string} [opts.type] — filter by signal type
 * @param {string} [opts.logDir] — override default log directory (for testing)
 * @param {{readdir?:Function, readFile?:Function}} [opts.reader] — injectable fs (test seam)
 * @returns {Signal[]}
 */
export async function readSignals(opts = {}) {
  const { since, limit, type, logDir, reader = {} } = opts;
  const fsReaddir = reader.readdir ?? readdir;
  const fsReadFile = reader.readFile ?? readFile;
  const logDirResolved = logDir ?? SIGNALS_LOG_DIR;
  const results = [];

  let files;
  try {
    files = await fsReaddir(logDirResolved);
  } catch (err) {
    if (err && err.code === 'ENOENT') return []; // Directory doesn't exist — empty
    const named = new Error(`failed to read log directory ${logDirResolved}: ${err.code ?? err.message}`);
    named.code = err.code;
    throw named;
  }

  const signalFiles = files
    .filter((f) => f.startsWith(SIGNALS_PREFIX + '-') && f.endsWith('.jsonl'))
    .sort();

  for (const file of signalFiles) {
    const filePath = join(logDirResolved, file);
    let content;
    try {
      content = await fsReadFile(filePath, 'utf-8');
    } catch (err) {
      // ENOENT: the file vanished mid-read. EISDIR: a directory is
      // masquerading as a signals-*.jsonl entry — we never read or recurse
      // into directories, so it holds no signal lines and skipping it loses
      // no data. Both are benign skips. EACCES/EPERM/EIO on a real file are
      // NOT skipped: they mean the data could not be read, so they surface as
      // a named error (P6-H-016).
      if (err && (err.code === 'ENOENT' || err.code === 'EISDIR')) continue;
      const named = new Error(`failed to read ${filePath}: ${err.code ?? err.message}`);
      named.code = err.code;
      throw named;
    }

    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry;
      try {
        entry = JSON.parse(trimmed);
      } catch {
        continue;
      }

      if (since && entry.ts && entry.ts.slice(0, 10) < since) continue;
      if (type && entry.type !== type) continue;

      results.push(entry);
    }
  }

  if (limit && results.length > limit) {
    return results.slice(-limit);
  }

  return results;
}

/**
 * Signal record shape.
 * @typedef {object} Signal
 * @property {string} ts — ISO 8601 timestamp
 * @property {string} decisionHash — SHA-256 hash of the associated prompt
 * @property {string} type — one of: retry, dismiss, rephrase, success, explicit_override
 * @property {object} [details] — additional context (e.g. { attemptCount, previousHash })
 */
