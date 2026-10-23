/**
 * Outcomes correlation for the adaptive feedback system.
 *
 * Correlates routing decisions with user feedback signals to classify each
 * decision as positive, negative, or unknown. Signals captured within the
 * recent window (see thresholds below) override the default classification.
 *
 * Classification rules (applied in priority order):
 *   1. retry within 5m          → negative (user re-submitted same prompt)
 *   2. explicit_override within 2m → negative (user forced a different routing)
 *   3. rephrase within 5m      → negative (user rephrased, dissatisfied)
 *   4. no signals within 10m   → positive (no corrective action taken)
 *   5. signals older than 10m  → unknown (too stale to interpret)
 *
 * Raw prompts are never accessed — only hashes link decisions to signals.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const SIGNALS_LOG_DIR = resolve('logs');
const SIGNALS_PREFIX = 'signals';

// Time windows in milliseconds
const RETRY_WINDOW_MS = 5 * 60 * 1000;
const OVERRIDE_WINDOW_MS = 2 * 60 * 1000;
const REPHRASE_WINDOW_MS = 5 * 60 * 1000;
const POSITIVE_WINDOW_MS = 10 * 60 * 1000;
const STALE_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Correlate decisions and signals to produce outcome classifications.
 *
 * @param {Decision[]} decisions — routing decisions (from readDecisions)
 * @param {Signal[]} signals — feedback signals (from readSignals)
 * @param {object} [opts]
 * @param {number} [opts.now] — fixed timestamp for deterministic testing (ms since epoch)
 * @param {string} [opts.logDir] — override signals log directory (for testing)
 * @returns {Outcome[]}
 */
export function correlate(decisions, signals, opts = {}) {
  const logDir = opts.logDir ?? SIGNALS_LOG_DIR;
  const now = opts.now ?? Date.now();
  const results = [];

  // Build a lookup: decisionHash → list of signals
  const signalsByHash = new Map();
  for (const s of signals) {
    if (!signalsByHash.has(s.decisionHash)) {
      signalsByHash.set(s.decisionHash, []);
    }
    signalsByHash.get(s.decisionHash).push(s);
  }

  for (const decision of decisions) {
    const decisionTime = new Date(decision.ts).getTime();
    const relatedSignals = signalsByHash.get(decision.promptHash) ?? [];
    const latencyMs = decision.latencyMs?.total ?? 0;

    // Classify based on signal proximity
    let outcome = 'unknown';
    let reason = '';
    let hasAnySignal = relatedSignals.length > 0;

    for (const signal of relatedSignals) {
      const signalTime = new Date(signal.ts).getTime();
      const ageMs = now - signalTime;

      // Skip signals that are too old to be relevant
      if (ageMs > STALE_THRESHOLD_MS) continue;

      if (signal.type === 'retry' && ageMs <= RETRY_WINDOW_MS) {
        outcome = 'negative';
        reason = 'retry within 5 minutes';
        break;
      }
      if (signal.type === 'explicit_override' && ageMs <= OVERRIDE_WINDOW_MS) {
        outcome = 'negative';
        reason = 'explicit override within 2 minutes';
        break;
      }
      if (signal.type === 'rephrase' && ageMs <= REPHRASE_WINDOW_MS) {
        outcome = 'negative';
        reason = 'rephrase within 5 minutes';
        break;
      }
    }

    if (outcome === 'unknown') {
      if (!hasAnySignal) {
        outcome = 'positive';
        reason = 'no signals within 10 minutes';
      } else {
        // There are signals but none within the relevant windows
        const recentSignal = relatedSignals.find((s) => {
          const ageMs = now - new Date(s.ts).getTime();
          return ageMs <= POSITIVE_WINDOW_MS;
        });
        if (!recentSignal) {
          outcome = 'unknown';
          reason = 'signals older than 10 minutes';
        } else {
          outcome = 'positive';
          reason = 'no signals within 10 minutes';
        }
      }
    }

    results.push({
      decisionHash: decision.promptHash,
      outcome,
      reason,
      decision: {
        mode: decision.mode,
        tier: decision.tier,
        selectedSkills: decision.selectedSkills,
        confidence: decision.confidence,
      },
      signals: relatedSignals.filter((s) => now - new Date(s.ts).getTime() <= STALE_THRESHOLD_MS),
      latencyMs,
    });
  }

  return results;
}

/**
 * Read signals from the signals log directory.
 *
 * P6-H-016: only ENOENT on the (optional) directory or a single file, and
 * EISDIR on a single file (a directory masquerading as a signals-*.jsonl
 * entry — we never read or recurse into directories, so it holds no data),
 * are treated as "no data". Any other error (EACCES, EPERM, EIO, ...) means
 * we could not actually read the signals, so it is surfaced as a named error
 * instead of being silently turned into an empty list.
 *
 * @param {string} logDir
 * @param {{readdir?:Function, readFile?:Function}} [reader] — injectable fs (test seam)
 * @returns {Promise<Signal[]>}
 */
async function readSignalFiles(logDir, reader = {}) {
  const fsReaddir = reader.readdir ?? readdir;
  const fsReadFile = reader.readFile ?? readFile;
  const results = [];

  let files;
  try {
    files = await fsReaddir(logDir);
  } catch (err) {
    if (err && err.code === 'ENOENT') return []; // the signals dir is optional
    const named = new Error(`failed to read signals directory ${logDir}: ${err.code ?? err.message}`);
    named.code = err.code;
    throw named;
  }

  const signalFiles = files
    .filter((f) => f.startsWith(SIGNALS_PREFIX + '-') && f.endsWith('.jsonl'))
    .sort();

  for (const file of signalFiles) {
    let content;
    try {
      content = await fsReadFile(join(logDir, file), 'utf-8');
    } catch (err) {
      // ENOENT: the file vanished mid-read. EISDIR: a directory is masquerading
      // as a signals-*.jsonl entry — readdir() lists directories too, but we
      // never read or recurse into them, so such an entry holds no signal lines
      // and skipping it loses no data. Both are benign skips. EACCES/EPERM/EIO
      // on a real file are NOT skipped: they mean the data could not be read,
      // so they surface as a named error (P6-H-016).
      if (err && (err.code === 'ENOENT' || err.code === 'EISDIR')) continue;
      const named = new Error(`failed to read signal file ${join(logDir, file)}: ${err.code ?? err.message}`);
      named.code = err.code;
      throw named;
    }
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        results.push(JSON.parse(trimmed));
      } catch {
        // Skip malformed
      }
    }
  }

  return results;
}

/**
 * Convenience function: correlate from log files directly.
 *
 * @param {import('../telemetry/feedback.mjs').Decision[]} decisions
 * @param {object} [opts]
 * @param {{readdir?:Function, readFile?:Function}} [opts.reader] — injectable fs (test seam)
 * @returns {Promise<Outcome[]>}
 */
export async function correlateFromLogs(decisions, opts = {}) {
  // opts.logDir may be undefined; readSignalFiles has no default of its own, so
  // an undefined path makes readdir() fail and every decision is classified
  // "positive" (no signals found). Resolve the default here — the same default
  // `correlate()` uses — so the CLI reads logs/signals-*.jsonl without an
  // explicit logDir. See src/cli/feedback.mjs printOutcomes().
  const logDir = opts.logDir ?? SIGNALS_LOG_DIR;
  const signals = await readSignalFiles(logDir, opts.reader);
  return correlate(decisions, signals, opts);
}

/**
 * Outcome record shape.
 * @typedef {object} Outcome
 * @property {string} decisionHash — SHA-256 hash of the associated prompt
 * @property {string} outcome — 'positive' | 'negative' | 'unknown'
 * @property {string} reason — human-readable explanation
 * @property {object} decision — { mode, tier, selectedSkills, confidence }
 * @property {Signal[]} signals — related signals (within stale threshold)
 * @property {number} latencyMs
 */

/**
 * Signal record shape.
 * @typedef {object} Signal
 * @property {string} ts
 * @property {string} decisionHash
 * @property {string} type
 * @property {object} details
 */
