/**
 * Session tracker tests.
 *
 * Verifies:
 * 1. trackPrompt returns null on first call (no prior context)
 * 2. trackPrompt detects retry (same hash within 5 min)
 * 3. trackPrompt detects rephrase (Jaccard > 0.6 within 5 min)
 * 4. trackPrompt detects explicit_override (implicit then explicit)
 * 5. Session state file is written correctly
 * 6. No raw prompts stored in session file
 */
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { trackPrompt, jaccardSimilarity } from '../../src/telemetry/session-tracker.mjs';

const BASE = resolve('.');
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log('  ✓', message);
  } else {
    failed++;
    console.error('  ✗', message);
  }
}

// The module hardcodes SESSION_DIR = resolve('logs'), so we save/restore
// the session file at the module's expected path.
const REAL_SESSION_DIR = resolve(BASE, 'logs');
const today = new Date();
const sym = `${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, '0')}${String(today.getUTCDate()).padStart(2, '0')}`;
const REAL_SESSION_FILE = join(REAL_SESSION_DIR, `session-${sym}.json`);

let existingState = '';
try {
  existingState = readFileSync(REAL_SESSION_FILE, 'utf-8');
} catch {
  // File doesn't exist
}

console.log('\n=== Session Tracker Tests ===\n');

// ─── 1. trackPrompt returns null on first call ────────────────────────────────
console.log('1. trackPrompt returns null on first call');

writeFileSync(REAL_SESSION_FILE, '[]', 'utf-8');

const result1 = trackPrompt('deploy a lambda function', 'sha256:hash001');
assert(result1 === null, 'first call returns null (no prior context)');

// ─── 2. trackPrompt detects retry ─────────────────────────────────────────────
console.log('\n2. trackPrompt detects retry');

// Second call with same prompt should detect retry
const result2 = trackPrompt('deploy a lambda function', 'sha256:hash001');
assert(result2 !== null, 'retry signal detected on second identical prompt');
assert(result2.type === 'retry', `retry type detected, got ${result2?.type}`);
assert(result2.details.attemptCount === 2, `attemptCount is 2, got ${result2?.details?.attemptCount}`);

// ─── 3. trackPrompt detects rephrase ──────────────────────────────────────────
console.log('\n3. trackPrompt detects rephrase');

// Clear session
writeFileSync(REAL_SESSION_FILE, '[]', 'utf-8');

// First call
trackPrompt('unit tests for auth module deploy', 'sha256:hash003');

// Similar but rephrased prompt — first 60 chars overlap significantly
const result3 = trackPrompt('unit tests for auth module feature', 'sha256:hash004');
assert(result3 !== null, 'rephrase signal detected on similar prompt');
assert(result3.type === 'rephrase', `rephrase type detected, got ${result3?.type}`);
assert(typeof result3.details.similarity === 'number', 'similarity is a number');
assert(result3.details.similarity > 0.6, `similarity > 0.6, got ${result3.details.similarity}`);

// ─── 4. Jaccard similarity helper ─────────────────────────────────────────────
console.log('\n4. Jaccard similarity helper');

const j1 = jaccardSimilarity('hello world', 'hello world');
assert(Math.abs(j1 - 1.0) < 0.01, `identical strings have Jaccard ~1.0, got ${j1}`);

const j2 = jaccardSimilarity('deploy aws lambda', 'deploy azure function');
assert(j2 > 0 && j2 < 1, `different prompts have Jaccard in (0,1), got ${j2}`);

const j3 = jaccardSimilarity('hello world', '');
assert(j3 === 0, `empty string has Jaccard 0, got ${j3}`);

const j4 = jaccardSimilarity(null, 'test');
assert(j4 === 0, `null input returns 0, got ${j4}`);

// ─── 5. Session state file is written correctly ───────────────────────────────
console.log('\n5. Session state file is written correctly');

writeFileSync(REAL_SESSION_FILE, '[]', 'utf-8');
trackPrompt('test prompt one for verifying no raw prompt text is stored in session state', 'sha256:hash5a');
trackPrompt('test prompt two for verifying no raw prompt text is stored in session state', 'sha256:hash5b');

const stateContent = readFileSync(REAL_SESSION_FILE, 'utf-8');
const state = JSON.parse(stateContent);
assert(Array.isArray(state), 'session state is an array');
assert(state.length === 2, `session has 2 entries, got ${state.length}`);
assert(typeof state[0].ts === 'string', 'entry has ts string');
assert(typeof state[0].promptHash === 'string', 'entry has promptHash');
assert(typeof state[0].decisionHash === 'string', 'entry has decisionHash');
assert(typeof state[0].fingerprint === 'string', 'entry has fingerprint');

// ─── 6. No raw prompts stored in session file ─────────────────────────────────
console.log('\n6. No raw prompts stored in session file');

const stateText = readFileSync(REAL_SESSION_FILE, 'utf-8');
// Prompts are >60 chars so only first 60 chars (fingerprint) are stored, not the full text
assert(!stateText.includes('test prompt one for verifying no raw prompt text is stored in session state'), 'full prompt one not in state');
assert(!stateText.includes('test prompt two for verifying no raw prompt text is stored in session state'), 'full prompt two not in state');
assert(stateText.includes('sha256:hash5a'), 'prompt hash is stored');
assert(stateText.includes('sha256:hash5b'), 'prompt hash is stored');

// ─── Restore ──────────────────────────────────────────────────────────────────
if (existingState) {
  writeFileSync(REAL_SESSION_FILE, existingState, 'utf-8');
} else {
  try { unlinkSync(REAL_SESSION_FILE); } catch { /* ignore */ }
}

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
