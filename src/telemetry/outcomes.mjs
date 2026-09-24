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
 * @param {string} logDir
 * @returns {Promise<Signal[]>}
 */
async function readSignalFiles(logDir) {
  const results = [];
  try {
    const files = await readdir(logDir);
    const signalFiles = files
      .filter((f) => f.startsWith(SIGNALS_PREFIX + '-') && f.endsWith('.jsonl'))
      .sort();

    for (const file of signalFiles) {
      const content = await readFile(join(logDir, file), 'utf-8');
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
  } catch {
    // Directory doesn't exist
  }
  return results;
}

/**
 * Convenience function: correlate from log files directly.
 *
 * @param {import('../telemetry/feedback.mjs').Decision[]} decisions
 * @param {object} [opts]
 * @returns {Promise<Outcome[]>}
 */
export async function correlateFromLogs(decisions, opts = {}) {
  // opts.logDir may be undefined; readSignalFiles has no default of its own, so
  // an undefined path makes readdir() fail and every decision is classified
  // "positive" (no signals found). Resolve the default here — the same default
  // `correlate()` uses — so the CLI reads logs/signals-*.jsonl without an
  // explicit logDir. See src/cli/feedback.mjs printOutcomes().
  const logDir = opts.logDir ?? SIGNALS_LOG_DIR;
  const signals = await readSignalFiles(logDir);
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
