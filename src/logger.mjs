import { appendFile, mkdir } from 'fs/promises';
import { resolve } from 'path';

const LOG_DIR = resolve('logs');
const LOG_PATH = resolve(LOG_DIR, 'routing.jsonl');

/**
 * Append a decision record as a JSON line to logs/routing.jsonl.
 *
 * @param {object} record
 * @param {string} record.timestamp
 * @param {string} record.prompt
 * @param {Array}  record.candidates
 * @param {object|null} record.selected
 * @param {'direct'|'top-k'|'none'} record.mode
 * @param {number} record.latency_ms
 */
export async function logDecision(record) {
  try {
    await mkdir(LOG_DIR, { recursive: true });
    const line = JSON.stringify(record) + '\n';
    await appendFile(LOG_PATH, line, 'utf-8');
  } catch {
    // Fail silently — logging must not break the hook
  }
}
