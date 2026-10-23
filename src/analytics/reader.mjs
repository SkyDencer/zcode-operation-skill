/**
 * Log reader for usage analytics.
 *
 * Reads JSONL log files from the logs/ directory and parses them into
 * structured LogEntry objects. Handles missing files, partial lines,
 * and malformed JSON gracefully.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const LOG_DIR = resolve('logs');

/**
 * Parse a single JSONL line into a LogEntry.
 *
 * @param {string} line
 * @returns {object|null} Parsed entry or null if malformed
 */
function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const entry = JSON.parse(trimmed);
    // Validate required fields
    if (!entry.ts || !entry.event) return null;
    return entry;
  } catch {
    return null;
  }
}

/**
 * Read all .jsonl log files from the logs directory.
 *
 * P6-H-016: only ENOENT on the (optional) directory or a single file is
 * treated as "no data". Any other error (EACCES, EPERM, EIO, ...) is
 * surfaced as a named error rather than silently returning an empty list.
 *
 * @param {string} [logDir] - Path to logs directory (default: ./logs)
 * @param {{readdirSync?:Function, readFileSync?:Function}} [reader] - injectable fs (test seam)
 * @param {string[]} [files] - optional whitelist of file names to read; when
 *   given, only those names are scanned so a caller can bound the read to a
 *   subset of the directory (e.g. the newest files) instead of everything
 * @returns {LogEntry[]} Array of parsed log entries, sorted by timestamp
 */
export function readLogs(logDir = LOG_DIR, reader = {}, files) {
  const fsReaddirSync = reader.readdirSync ?? readdirSync;
  const fsReadFileSync = reader.readFileSync ?? readFileSync;
  const entries = [];
  const resolvedDir = resolve(logDir);

  let names;
  try {
    names = fsReaddirSync(resolvedDir).filter((f) => f.endsWith('.jsonl'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return []; // Directory doesn't exist — empty
    const named = new Error(`failed to read log directory ${resolvedDir}: ${err.code ?? err.message}`);
    named.code = err.code;
    throw named;
  }
  if (Array.isArray(files)) {
    const allow = new Set(files);
    names = names.filter((f) => allow.has(f));
  }

  for (const file of names.sort()) {
    const filePath = resolve(resolvedDir, file);
    let content;
    try {
      content = fsReadFileSync(filePath, 'utf-8');
    } catch (err) {
      if (err && err.code === 'ENOENT') continue; // file vanished mid-read
      const named = new Error(`failed to read ${filePath}: ${err.code ?? err.message}`);
      named.code = err.code;
      throw named;
    }
    const lines = content.split('\n');
    for (const line of lines) {
      const entry = parseLine(line);
      if (entry) {
        entries.push(entry);
      }
    }
  }

  // Sort by timestamp
  entries.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  return entries;
}
