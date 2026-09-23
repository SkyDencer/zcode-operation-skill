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
 * @param {string} [logDir] - Path to logs directory (default: ./logs)
 * @returns {LogEntry[]} Array of parsed log entries, sorted by timestamp
 */
export function readLogs(logDir = LOG_DIR) {
  const entries = [];
  const resolvedDir = resolve(logDir);

  // Handle missing directory gracefully
  try {
    const files = readdirSync(resolvedDir).filter((f) => f.endsWith('.jsonl'));
    for (const file of files.sort()) {
      const filePath = resolve(resolvedDir, file);
      try {
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        for (const line of lines) {
          const entry = parseLine(line);
          if (entry) {
            entries.push(entry);
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Directory doesn't exist — return empty array
  }

  // Sort by timestamp
  entries.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  return entries;
}
