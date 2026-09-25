/**
 * Sync state tests for src/sync/state.mjs.
 *
 * Verifies:
 * 1. readSyncState returns empty state when file is absent
 " 2. readSyncState parses valid state file
 * 3. readSyncState handles malformed JSON gracefully
 * 4. writeSyncState writes a valid JSON file
 * 5. mergeSyncResult updates lastSyncAt and mirrorPath
 * 6. mergeSyncResult adds new skills
 * 7. mergeSyncResult updates existing skills
 * 8. mergeSyncResult removes deleted skills
 * 9. mergeSyncResult does not mutate the input state
 */
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  readSyncState,
  writeSyncState,
  mergeSyncResult,
} from '../../src/sync/state.mjs';

const TEST_ROOT = resolve('.tmp-sync-state-test');
const STATE_FILE = join(TEST_ROOT, '.skill-router-sync-state.json');

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

function setup() {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_ROOT, { recursive: true });
}

function teardown() {
  rmSync(TEST_ROOT, { recursive: true, force: true });
}

setup();

console.log('\n=== Sync State Tests ===\n');

// ─── 1. readSyncState returns empty state when file is absent ─────────────────
console.log('1. readSyncState returns empty state when absent');

const empty = readSyncState(TEST_ROOT);
assert(empty.lastSyncAt === null, 'lastSyncAt is null');
assert(empty.mirrorPath === null, 'mirrorPath is null');
assert(typeof empty.skills === 'object', 'skills is an object');
assert(Object.keys(empty.skills).length === 0, 'skills is empty');

// ─── 2. readSyncState parses valid state file ─────────────────────────────────
console.log('\n2. readSyncState parses valid state file');

const validState = {
  lastSyncAt: '2026-09-25T10:00:00.000Z',
  mirrorPath: '/zcode/skills',
  skills: {
    'backend-eloquent': { hash: 'abc123', syncedAt: '2026-09-25T10:00:00.000Z' },
    'frontend-nextjs': { hash: 'def456', syncedAt: '2026-09-25T10:00:00.000Z' },
  },
};
writeFileSync(STATE_FILE, JSON.stringify(validState, null, 2), 'utf-8');

const parsed = readSyncState(TEST_ROOT);
assert(parsed.lastSyncAt === '2026-09-25T10:00:00.000Z', 'lastSyncAt parsed correctly');
assert(parsed.mirrorPath === '/zcode/skills', 'mirrorPath parsed correctly');
assert(parsed.skills['backend-eloquent'].hash === 'abc123', 'backend-eloquent hash preserved');
assert(parsed.skills['frontend-nextjs'].syncedAt === '2026-09-25T10:00:00.000Z', 'frontend-nextjs syncedAt preserved');
assert(Object.keys(parsed.skills).length === 2, 'two skills in parsed state');

// ─── 3. readSyncState handles malformed JSON gracefully ───────────────────────
console.log('\n3. readSyncState handles malformed JSON gracefully');

writeFileSync(STATE_FILE, '{not valid json!!!', 'utf-8');
const malformed = readSyncState(TEST_ROOT);
assert(malformed.lastSyncAt === null, 'lastSyncAt is null for malformed JSON');
assert(malformed.mirrorPath === null, 'mirrorPath is null for malformed JSON');
assert(Object.keys(malformed.skills).length === 0, 'skills is empty for malformed JSON');

// ─── 4. writeSyncState writes a valid JSON file ───────────────────────────────
console.log('\n4. writeSyncState writes a valid JSON file');

const newState = {
  lastSyncAt: '2026-09-25T12:00:00.000Z',
  mirrorPath: '/zcode/skills',
  skills: { 'test-skill': { hash: 'xyz', syncedAt: '2026-09-25T12:00:00.000Z' } },
};
writeSyncState(newState, TEST_ROOT);
const written = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
assert(written.lastSyncAt === '2026-09-25T12:00:00.000Z', 'written lastSyncAt matches');
assert(written.skills['test-skill'].hash === 'xyz', 'written skill hash matches');

// ─── 5. mergeSyncResult updates lastSyncAt and mirrorPath ─────────────────────
console.log('\n5. mergeSyncResult updates lastSyncAt and mirrorPath');

const beforeMerge = readSyncState(TEST_ROOT);
const syncResult = {
  add: [],
  update: [],
  remove: [],
  unchanged: [],
  mirrorPath: '/new/zcode/skills',
};
const merged = mergeSyncResult(beforeMerge, syncResult, TEST_ROOT);
assert(merged.mirrorPath === '/new/zcode/skills', 'mirrorPath updated');
assert(merged.lastSyncAt !== beforeMerge.lastSyncAt, 'lastSyncAt was updated');
assert(typeof merged.lastSyncAt === 'string', 'lastSyncAt is an ISO string');

// ─── 6. mergeSyncResult adds new skills ───────────────────────────────────────
console.log('\n6. mergeSyncResult adds new skills');

const addResult = {
  add: [{ name: 'new-skill-a', hash: 'hashA' }, { name: 'new-skill-b', hash: 'hashB' }],
  update: [],
  remove: [],
  unchanged: [],
  mirrorPath: '/zcode/skills',
};
const withAdded = mergeSyncResult(merged, addResult, TEST_ROOT);
assert(withAdded.skills['new-skill-a'] !== undefined, 'new-skill-a was added');
assert(withAdded.skills['new-skill-a'].hash === 'hashA', 'new-skill-a hash is correct');
assert(withAdded.skills['new-skill-b'] !== undefined, 'new-skill-b was added');
assert(Object.keys(withAdded.skills).length === 3, 'three skills total after add');

// ─── 7. mergeSyncResult updates existing skills ───────────────────────────────
console.log('\n7. mergeSyncResult updates existing skills');

const updateResult = {
  add: [],
  update: [{ name: 'test-skill', hash: 'updatedHash' }],
  remove: [],
  unchanged: [],
  mirrorPath: '/zcode/skills',
};
const withUpdated = mergeSyncResult(withAdded, updateResult, TEST_ROOT);
assert(withUpdated.skills['test-skill'].hash === 'updatedHash', 'test-skill hash was updated');
assert(withUpdated.skills['test-skill'].syncedAt !== undefined, 'test-skill syncedAt was updated');

// ─── 8. mergeSyncResult removes deleted skills ────────────────────────────────
console.log('\n8. mergeSyncResult removes deleted skills');

const removeResult = {
  add: [],
  update: [],
  remove: [{ name: 'new-skill-a' }, { name: 'test-skill' }],
  unchanged: [],
  mirrorPath: '/zcode/skills',
};
const withRemoved = mergeSyncResult(withUpdated, removeResult, TEST_ROOT);
assert(withRemoved.skills['new-skill-a'] === undefined, 'new-skill-a was removed');
assert(withRemoved.skills['test-skill'] === undefined, 'test-skill was removed');
assert(withRemoved.skills['new-skill-b'] !== undefined, 'new-skill-b still exists');
assert(Object.keys(withRemoved.skills).length === 1, 'one skill remaining after removal');

// ─── 9. mergeSyncResult does not mutate the input state ───────────────────────
console.log('\n9. mergeSyncResult does not mutate input state');

const originalState = {
  lastSyncAt: '2026-01-01T00:00:00.000Z',
  mirrorPath: '/original/mirror',
  skills: { 'original-skill': { hash: 'origHash', syncedAt: '2026-01-01T00:00:00.000Z' } },
};
const beforeKeys = Object.keys(originalState.skills);
const immutResult = mergeSyncResult(originalState, removeResult, TEST_ROOT);
assert(Object.keys(originalState.skills).length === beforeKeys.length, 'input skills keys unchanged');
assert(originalState.mirrorPath === '/original/mirror', 'input mirrorPath unchanged');
assert(immutResult.mirrorPath === '/zcode/skills', 'returned state has updated mirrorPath');
assert(immutResult.skills['original-skill'] !== undefined, 'returned state still has original-skill');

// ─── Summary ──────────────────────────────────────────────────────────────────
teardown();

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
