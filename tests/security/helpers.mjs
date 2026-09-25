/**
 * Shared helpers for the Sub-Phase 6.4 path-traversal security tests.
 *
 * Provides the assertion counters, the sandbox layout, and the SKILL.md
 * builder used by `path-traversal.test.mjs` (library-level primitives) and
 * `cli-path-traversal.test.mjs` (CLI-level primitives).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..', '..');
export const BIN = resolve(REPO_ROOT, 'bin', 'skill-router.mjs');
export const TMP = resolve(__dirname, 'tmp');
export const ROOT = resolve(TMP, 'root');
export const SANDBOX = resolve(ROOT, 'sandbox');

/** A name that validateSkill() accepts but that escapes the skills directory. */
export const TRAVERSAL_NAME = 'backend-../../../../pwned';
/** The same escape written with Windows separators. */
export const BACKSLASH_NAME = 'backend-..\\..\\..\\..\\pwned-win';
/** A legitimate name, to prove the guard is not over-broad. */
export const LEGIT_NAME = 'backend-api-design';
/** resolve(<sandbox>/data/skills, 'backend', '../../../../pwned') -> <root>/pwned */
export const ESCAPE_DIR = resolve(ROOT, 'pwned');
export const ESCAPE_FILE = resolve(ESCAPE_DIR, 'SKILL.md');
export const BACKSLASH_ESCAPE_FILE = resolve(ROOT, 'pwned-win', 'SKILL.md');

let passed = 0;
let failed = 0;

export function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

export function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

export function cleanTmp() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

export function summary() {
  console.log('\n=== Test Results ===');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  if (failed > 0) process.exit(1);
}

/**
 * Write a SKILL.md whose frontmatter passes validateSkill() for the registered
 * `backend` domain, with the given name.
 */
export function writeSkill(filePath, name) {
  mkdirSync(dirname(filePath), { recursive: true });
  const body = Array.from(
    { length: 10 },
    (_, i) => `Step ${i + 1} explains how to use this skill safely with enough words to pass validation.`,
  ).join('\n');
  writeFileSync(
    filePath,
    [
      '---',
      `name: ${name}`,
      'description: A skill used by the path-traversal regression suite to verify import safety.',
      'keywords:',
      '  - security',
      '  - traversal',
      '  - regression',
      'domains:',
      '  - backend',
      '---',
      '',
      '## Instructions',
      '',
      body,
    ].join('\n'),
    'utf-8',
  );
}

export function candidate(sourcePath, name) {
  return {
    name,
    description: 'A skill used by the path-traversal regression suite to verify import safety.',
    keywords: ['security', 'traversal', 'regression'],
    domains: ['backend'],
    sourcePath,
    content: 'parsed content',
  };
}

/** Create the layout the CLIs resolve `data/domains` and `data/skills` against. */
export function seedSandbox() {
  mkdirSync(resolve(SANDBOX, 'data', 'domains', 'backend'), { recursive: true });
  writeFileSync(
    resolve(SANDBOX, 'data', 'domains', 'backend', 'meta.json'),
    JSON.stringify({ name: 'backend', description: 'Backend', keywords: ['backend'] }, null, 2),
    'utf-8',
  );
  mkdirSync(resolve(SANDBOX, 'data', 'skills'), { recursive: true });
  return resolve(SANDBOX, 'data', 'skills');
}

export function runCli(args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...args], {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      status: err.status ?? 1,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
    };
  }
}

export { join, resolve };
