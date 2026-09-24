/**
 * Session-tracked prompt monitoring for adaptive feedback collection.
 *
 * Detects implicit user feedback signals by analyzing the stream of routing
 * decisions:
 *   - retry: same prompt hash re-issued within 5 minutes
 *   - rephrase: semantically similar prompt (Jaccard > 0.6) within 5 minutes
 *   - explicit_override: implicit routing immediately followed by explicit
 *
 * Sessions are defined as 30-minute windows of continuous activity. State is
 * persisted to logs/session-YYYYMMDD.json (not JSONL) because sessions are
 * read-modify-write objects. Raw prompts are NEVER stored — only SHA-256
 * hashes appear in session state. For rephrase detection, the first 20 chars
 * of each prompt are stored as a truncation fingerprint.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SESSION_DIR = resolve('logs');
const SESSION_PREFIX = 'session';
const SESSION_WINDOW_MS = 30 * 60 * 1000;   // 30 minutes
const RECENT_WINDOW_MS = 5 * 60 * 1000;     // 5 minutes (retry/rephrase)
const OVERRIDE_WINDOW_MS = 2 * 60 * 1000;   // 2 minutes (explicit override)
const MAX_HISTORY = 50;                       // max entries per session file

/**
 * Compute SHA-256 hash of a string.
 *
 * @param {string} text
 * @returns {string}
 */
function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Compute Jaccard similarity between two token sets.
 *
 * Tokens are lowercased, non-alphanumeric characters stripped, and empty
 * strings removed.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function jaccardSimilarity(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return 0;
  const tokenize = (s) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Return the path for today's session state file.
 *
 * @returns {string}
 */
function sessionFilePath() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return resolve(SESSION_DIR, `${SESSION_PREFIX}-${y}${m}${d}.json`);
}

/**
 * Read today's session state. Returns empty array if file missing or corrupt.
 *
 * @returns {SessionEntry[]}
 */
function readSession() {
  try {
    const content = readFileSync(sessionFilePath(), 'utf-8');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

/**
 * Write today's session state (overwrite).
 *
 * @param {SessionEntry[]} entries
 */
function writeSession(entries) {
  try {
    writeFileSync(sessionFilePath(), JSON.stringify(entries, null, 2), 'utf-8');
  } catch {
    // Fail silently
  }
}

/**
 * Track a prompt event, detect signals, and persist session state.
 *
 * @param {string} prompt — the raw prompt text (hashed before storage)
 * @param {string} decisionHash — SHA-256 hash of the prompt
 * @returns {Signal|null} — a Signal if a feedback signal was detected, null otherwise
 */
export function trackPrompt(prompt, decisionHash) {
  const entries = readSession();
  const now = new Date();
  const nowMs = now.getTime();
  const promptHash = sha256(prompt);
  // Store a truncated fingerprint (first 60 chars) for rephrase detection only;
  // this is not the full prompt and cannot be reversed to recover raw text.
  const fingerprint = prompt.slice(0, 60);

  // Prune entries outside the session window
  const recent = entries.filter((e) => nowMs - new Date(e.ts).getTime() < SESSION_WINDOW_MS);

  // Detect signal types
  let signal = null;
  const lastEntry = recent.length > 0 ? recent[recent.length - 1] : null;

  // 1. Retry: same prompt hash within 5 minutes
  if (lastEntry && lastEntry.promptHash === promptHash) {
    const elapsed = nowMs - new Date(lastEntry.ts).getTime();
    if (elapsed < RECENT_WINDOW_MS) {
      signal = {
        ts: now.toISOString(),
        decisionHash,
        type: 'retry',
        details: { attemptCount: recent.filter((e) => e.promptHash === promptHash).length + 1 },
      };
    }
  }

  // 2. Rephrase: Jaccard > 0.6 with any recent entry within 5 minutes
  if (!signal && lastEntry && lastEntry.fingerprint) {
    const elapsed = nowMs - new Date(lastEntry.ts).getTime();
    if (elapsed < RECENT_WINDOW_MS) {
      const sim = jaccardSimilarity(prompt, lastEntry.fingerprint);
      if (sim > 0.6) {
        signal = {
          ts: now.toISOString(),
          decisionHash,
          type: 'rephrase',
          details: { previousHash: lastEntry.promptHash, similarity: Math.round(sim * 100) / 100 },
        };
      }
    }
  }

  // 3. Explicit override: implicit decision followed by explicit within 2 min
  if (!signal && lastEntry && lastEntry.mode === 'implicit') {
    const elapsed = nowMs - new Date(lastEntry.ts).getTime();
    if (elapsed < OVERRIDE_WINDOW_MS) {
      signal = {
        ts: now.toISOString(),
        decisionHash,
        type: 'explicit_override',
        details: { previousHash: lastEntry.promptHash },
      };
    }
  }

  // Append this entry (store hash + fingerprint, not raw prompt)
  recent.push({
    ts: now.toISOString(),
    promptHash,
    decisionHash,
    mode: 'implicit',
    fingerprint,
  });

  // Cap history
  if (recent.length > MAX_HISTORY) {
    recent.splice(0, recent.length - MAX_HISTORY);
  }

  writeSession(recent);
  return signal;
}

/**
 * Session entry shape persisted to logs/session-YYYYMMDD.json.
 * @typedef {object} SessionEntry
 * @property {string} ts
 * @property {string} promptHash — SHA-256 of the prompt (never raw)
 * @property {string} decisionHash
 * @property {string} [mode]
 * @property {string} [fingerprint] — first 20 chars of prompt for rephrase detection
 */
