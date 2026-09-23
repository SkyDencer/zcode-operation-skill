/**
 * Hook edge case tests.
 *
 * Verifies that hooks/route.mjs handles all edge cases gracefully:
 * - Empty prompt, whitespace-only, invalid JSON, missing fields
 * - Very long prompts, emojis, SQL injection, null bytes
 * - All cases must exit 0 with valid output or no output
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const HOOK_PATH = resolve('hooks/route.mjs');
const TEST_DIR = resolve('.test-hook-temp');

function setup() {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
}

function runHook(input, opts = {}) {
  const cwd = opts.cwd || '.'; // Hook must run from project dir to find data/skill-index.json
  try {
    execSync(`node "${HOOK_PATH}"`, {
      input,
      cwd,
      timeout: 5000,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    return { exitCode: 0, stdout: '', stderr: '' };
  } catch (err) {
    return {
      exitCode: err.status ?? 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}

function assert(condition, message) {
  if (condition) {
    console.log('  ✓', message);
  } else {
    console.error('  ✗', message);
    throw new Error('Assertion failed: ' + message);
  }
}

console.log('\n=== Hook Edge Case Tests ===\n');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error('  ✗', name, '-', e.message);
  }
}

setup();

// 1. Empty input
check('empty input exits 0', () => {
  const r = runHook('');
  assert(r.exitCode === 0, 'empty input → exit 0');
});

// 2. Whitespace-only input
check('whitespace-only input exits 0', () => {
  const r = runHook('   \n\t  ');
  assert(r.exitCode === 0, 'whitespace input → exit 0');
});

// 3. Invalid JSON
check('invalid JSON exits 0', () => {
  const r = runHook('not valid json{{{');
  assert(r.exitCode === 0, 'invalid JSON → exit 0');
});

// 4. Missing prompt field
check('missing prompt uses safe default', () => {
  const r = runHook(JSON.stringify({ cwd: TEST_DIR }));
  assert(r.exitCode === 0, 'missing prompt → exit 0');
});

// 5. Empty prompt string
check('empty prompt string exits 0', () => {
  const r = runHook(JSON.stringify({ prompt: '', cwd: TEST_DIR }));
  assert(r.exitCode === 0, 'empty prompt → exit 0');
});

// 6. Very long prompt (truncation)
check('long prompt truncated and exits 0', () => {
  const longPrompt = 'x'.repeat(20000);
  const r = runHook(JSON.stringify({ prompt: longPrompt, cwd: TEST_DIR }));
  assert(r.exitCode === 0, 'long prompt → exit 0');
});

// 7. Prompt with emojis
check('emoji prompt exits 0', () => {
  const r = runHook(JSON.stringify({ prompt: 'Build a 🚀 React app with 💅 styling', cwd: TEST_DIR }));
  assert(r.exitCode === 0, 'emoji prompt → exit 0');
});

// 8. Prompt with SQL injection strings
check('SQL injection string exits 0', () => {
  const r = runHook(JSON.stringify({ prompt: "DROP TABLE users; SELECT * FROM secrets", cwd: TEST_DIR }));
  assert(r.exitCode === 0, 'SQL injection prompt → exit 0');
});

// 9. Prompt with null bytes
check('null bytes in prompt exits 0', () => {
  const r = runHook(JSON.stringify({ prompt: 'Hello\x00World', cwd: TEST_DIR }));
  assert(r.exitCode === 0, 'null bytes → exit 0');
});

// 10. Non-string prompt
check('non-string prompt exits 0', () => {
  const r = runHook(JSON.stringify({ prompt: 12345, cwd: TEST_DIR }));
  assert(r.exitCode === 0, 'non-string prompt → exit 0');
});

// 11. Null stdin
check('null stdin exits 0', () => {
  const r = runHook(null);
  assert(r.exitCode === 0, 'null stdin → exit 0');
});

// 12. Valid prompt produces output file
check('valid prompt creates output file', () => {
  const r = runHook(JSON.stringify({ prompt: 'Laravel eager loading optimization', cwd: TEST_DIR }));
  assert(r.exitCode === 0, 'valid prompt → exit 0');
  const outputPath = join(TEST_DIR, '.zcode', 'output.json');
  assert(existsSync(outputPath), 'output.json created');
  const output = JSON.parse(readFileSync(outputPath, 'utf-8'));
  assert('hookSpecificOutput' in output, 'output has hookSpecificOutput');
});

// 13. Output is always valid JSON or empty
check('output is valid JSON when present', () => {
  const r = runHook(JSON.stringify({ prompt: 'React useState hook example', cwd: TEST_DIR }));
  const outputPath = join(TEST_DIR, '.zcode', 'output.json');
  if (existsSync(outputPath)) {
    const content = readFileSync(outputPath, 'utf-8');
    const parsed = JSON.parse(content);
    assert(parsed.hookSpecificOutput !== undefined, 'parsed JSON has hookSpecificOutput');
  }
});

// 14. Prompt with unicode characters
check('unicode prompt exits 0', () => {
  const r = runHook(JSON.stringify({ prompt: '你好世界 — build a React component', cwd: TEST_DIR }));
  assert(r.exitCode === 0, 'unicode prompt → exit 0');
});

// 15. Special JSON characters in prompt
check('special JSON chars in prompt exits 0', () => {
  const r = runHook(JSON.stringify({ prompt: 'Handle "quotes" and \\backslashes\\ and newlines\n', cwd: TEST_DIR }));
  assert(r.exitCode === 0, 'special chars → exit 0');
});

// 16. Very short prompt
check('single char prompt exits 0', () => {
  const r = runHook(JSON.stringify({ prompt: 'x', cwd: TEST_DIR }));
  assert(r.exitCode === 0, 'single char → exit 0');
});

// 17. Hook is cwd-independent — runs from tmpdir (no index) with safeCwd pointing
//     to TEST_DIR; should exit 0 and write output.json at safeCwd/.zcode/.
check('hook is cwd-independent', () => {
  const runFromTmpdir = (input) => {
    try {
      execSync(`node "${HOOK_PATH}"`, {
        input,
        cwd: tmpdir(),
        timeout: 5000,
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      return { exitCode: 0, stdout: '', stderr: '' };
    } catch (err) {
      return {
        exitCode: err.status ?? 1,
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? '',
      };
    }
  };
  // Index is at hooks/../data/skill-index.json (resolved via import.meta.url),
  // so it should be found regardless of process.cwd() which is tmpdir().
  const r = runFromTmpdir(JSON.stringify({ prompt: 'Laravel eager loading optimization', cwd: TEST_DIR }));
  assert(r.exitCode === 0, 'hook from tmpdir exits 0');
  const outputPath = join(TEST_DIR, '.zcode', 'output.json');
  assert(existsSync(outputPath), 'output.json created at safeCwd path');
  const output = JSON.parse(readFileSync(outputPath, 'utf-8'));
  assert('hookSpecificOutput' in output, 'output.json has hookSpecificOutput');
});

// Cleanup
rmSync(TEST_DIR, { recursive: true, force: true });

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) process.exit(1);
