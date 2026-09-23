/**
 * Reader tests.
 *
 * Verifies:
 * - readLogs returns entries from existing log files
 * - Missing log directory returns empty array
 * - Malformed JSON lines are skipped gracefully
 * - Partial/incomplete lines are skipped
 * - Entries are sorted by timestamp
 * - Empty files are handled
 */
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { readLogs } from '../../src/analytics/reader.mjs';

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

console.log('\n=== Reader Tests ===\n');

// ─── 1. Read real log files ──────────────────────────────────────────────────
console.log('1. Read real log files');
const realEntries = readLogs();
assert(Array.isArray(realEntries), 'readLogs returns an array');
assert(realEntries.length > 0, `readLogs found ${realEntries.length} entries`);

// Check structure of first entry
if (realEntries.length > 0) {
  const first = realEntries[0];
  assert(typeof first.ts === 'string', 'entry has ts field');
  assert(typeof first.event === 'string', 'entry has event field');
}

// ─── 2. Entries sorted by timestamp ──────────────────────────────────────────
console.log('\n2. Entries sorted by timestamp');
let sorted = true;
for (let i = 1; i < realEntries.length; i++) {
  if (new Date(realEntries[i].ts) < new Date(realEntries[i - 1].ts)) {
    sorted = false;
    break;
  }
}
assert(sorted, 'entries are sorted by timestamp');

// ─── 3. Missing directory returns empty array ────────────────────────────────
console.log('\n3. Missing directory');
const missingEntries = readLogs('/nonexistent/path/that/does/not/exist');
assert(Array.isArray(missingEntries), 'missing dir returns array');
assert(missingEntries.length === 0, 'missing dir returns empty array');

// ─── 4. Malformed JSON lines are skipped ─────────────────────────────────────
console.log('\n4. Malformed JSON handling');
const testDir = resolve(BASE, 'tests/analytics/tmp-logs');
try {
  mkdirSync(testDir, { recursive: true });

  const badContent = [
    '{"ts":"2026-01-01T00:00:00.000Z","event":"retrieve","query":"test","resultCount":1,"durationMs":10}\n',
    'this is not json at all\n',
    '{"ts":"2026-01-01T00:00:01.000Z","event":"build","totalDocs":5,"durationMs":20}\n',
    '{malformed json\n',
    '\n', // empty line
    '{"ts":"2026-01-01T00:00:02.000Z","event":"retrieve","query":"another test","resultCount":0,"durationMs":15}\n',
  ].join('');

  writeFileSync(resolve(testDir, '2026-01-01.jsonl'), badContent, 'utf-8');
  const testEntries = readLogs(testDir);
  assert(testEntries.length === 3, `found 3 valid entries, got ${testEntries.length}`);
  assert(testEntries[0].event === 'retrieve', 'first entry is retrieve');
  assert(testEntries[1].event === 'build', 'second entry is build');
  assert(testEntries[2].event === 'retrieve', 'third entry is retrieve');
} finally {
  rmSync(testDir, { recursive: true, force: true });
}

// ─── 5. Empty file handled ──────────────────────────────────────────────────
console.log('\n5. Empty log file');
const emptyDir = resolve(BASE, 'tests/analytics/tmp-empty');
try {
  mkdirSync(emptyDir, { recursive: true });
  writeFileSync(resolve(emptyDir, '2026-01-01.jsonl'), '', 'utf-8');
  const emptyEntries = readLogs(emptyDir);
  assert(emptyEntries.length === 0, 'empty file returns no entries');
} finally {
  rmSync(emptyDir, { recursive: true, force: true });
}

// ─── 6. Partial line at end of file ─────────────────────────────────────────
console.log('\n6. Partial line at end of file');
const partialDir = resolve(BASE, 'tests/analytics/tmp-partial');
try {
  mkdirSync(partialDir, { recursive: true });
  const partialContent = '{"ts":"2026-01-01T00:00:00.000Z","event":"retrieve","query":"test","resultCount":1,"durationMs":10}\n{"incomplete';
  writeFileSync(resolve(partialDir, 'test.jsonl'), partialContent, 'utf-8');
  const partialEntries = readLogs(partialDir);
  assert(partialEntries.length === 1, `partial file returns 1 entry, got ${partialEntries.length}`);
} finally {
  rmSync(partialDir, { recursive: true, force: true });
}

// ─── 7. Multiple files sorted together ──────────────────────────────────────
console.log('\n7. Multiple files');
const multiDir = resolve(BASE, 'tests/analytics/tmp-multi');
try {
  mkdirSync(multiDir, { recursive: true });
  writeFileSync(
    resolve(multiDir, '2026-01-02.jsonl'),
    '{"ts":"2026-01-02T00:00:00.000Z","event":"retrieve","query":"b","resultCount":1,"durationMs":5}\n',
    'utf-8',
  );
  writeFileSync(
    resolve(multiDir, '2026-01-01.jsonl'),
    '{"ts":"2026-01-01T00:00:00.000Z","event":"retrieve","query":"a","resultCount":2,"durationMs":10}\n',
    'utf-8',
  );
  const multiEntries = readLogs(multiDir);
  assert(multiEntries.length === 2, 'two files give two entries');
  assert(multiEntries[0].ts < multiEntries[1].ts, 'entries cross-file sorted by timestamp');
} finally {
  rmSync(multiDir, { recursive: true, force: true });
}

// ─── 8. Only .jsonl files are read ──────────────────────────────────────────
console.log('\n8. Non-.jsonl files ignored');
const filterDir = resolve(BASE, 'tests/analytics/tmp-filter');
try {
  mkdirSync(filterDir, { recursive: true });
  writeFileSync(
    resolve(filterDir, '2026-01-01.jsonl'),
    '{"ts":"2026-01-01T00:00:00.000Z","event":"retrieve","query":"test","resultCount":1,"durationMs":10}\n',
    'utf-8',
  );
  writeFileSync(resolve(filterDir, 'notes.txt'), 'this should be ignored\n', 'utf-8');
  writeFileSync(resolve(filterDir, '2026-01-01.json'), '{"not":"jsonl"}\n', 'utf-8');
  const filterEntries = readLogs(filterDir);
  assert(filterEntries.length === 1, 'only .jsonl files are read');
} finally {
  rmSync(filterDir, { recursive: true, force: true });
}

// ─── 9. Missing required fields skipped ─────────────────────────────────────
console.log('\n9. Missing required fields');
const fieldsDir = resolve(BASE, 'tests/analytics/tmp-fields');
try {
  mkdirSync(fieldsDir, { recursive: true });
  const content = [
    '{"ts":"2026-01-01T00:00:00.000Z","event":"retrieve","query":"ok","resultCount":1,"durationMs":10}\n',
    '{"event":"retrieve","query":"no-timestamp","resultCount":1,"durationMs":10}\n',
    '{"ts":"2026-01-01T00:00:01.000Z","resultCount":1,"durationMs":10}\n',
    '{"ts":"2026-01-01T00:00:02.000Z","event":"retrieve","query":"also ok","resultCount":2,"durationMs":20}\n',
  ].join('');
  writeFileSync(resolve(fieldsDir, 'test.jsonl'), content, 'utf-8');
  const fieldEntries = readLogs(fieldsDir);
  assert(fieldEntries.length === 2, `only entries with ts+event: got ${fieldEntries.length}`);
} finally {
  rmSync(fieldsDir, { recursive: true, force: true });
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
