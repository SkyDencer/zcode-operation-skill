/**
 * Hook process E2E test.
 *
 * Spawns real Node subprocesses to test hooks/route.mjs against 20 payloads:
 *   - 10 normal prompts
 *   - 5 explicit $mention prompts ($next, $laravel, $react, $design, $test, $meta)
 *   - 1 empty prompt
 *   - 1 malformed JSON
 *   - 1 very long prompt (>5000 chars)
 *   - 1 prompt with special characters
 *   - 1 prompt containing </script>
 *
 * For each payload verifies:
 *   - Exit code is 0 (fail-open behavior)
 *   - .zcode/output.json is valid JSON (or absent for fail-open cases)
 *   - For valid prompts: additionalContext is present and non-empty
 *   - For empty/malformed: fail-open (no output.json)
 *
 * Uses the project directory as cwd since the hook resolves INDEX_PATH
 * relative to its own location (hooks/../data/skill-index.json).
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const HOOK_PATH = resolve(PROJECT_ROOT, 'hooks', 'route.mjs');
const ZCODE_OUT = resolve(PROJECT_ROOT, '.zcode', 'output.json');
const TMP = resolve(PROJECT_ROOT, 'tests', 'e2e', 'tmp-hook-process');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function cleanTmp() {
  if (existsSync(TMP)) {
    rmSync(TMP, { recursive: true, force: true });
  }
  mkdirSync(TMP, { recursive: true });
}

/**
 * Run the hook with the given stdin payload.
 * Returns { exitCode, outputJson } where outputJson is null if no output was written.
 */
function runHook(payloadStr) {
  return new Promise((resolve) => {
    const p = spawn('node', [HOOK_PATH], { cwd: PROJECT_ROOT });
    let stdoutBuf = '';
    let stderrBuf = '';
    p.stdout.on('data', (c) => { stdoutBuf += c; });
    p.stderr.on('data', (c) => { stderrBuf += c; });
    p.stdin.write(payloadStr);
    p.stdin.end();
    p.on('close', (code) => {
      let outputJson = null;
      try {
        if (existsSync(ZCODE_OUT)) {
          outputJson = JSON.parse(readFileSync(ZCODE_OUT, 'utf-8'));
        }
      } catch {
        // ignore
      }
      resolve({ exitCode: code ?? 0, stdout: stdoutBuf, stderr: stderrBuf, outputJson });
    });
  });
}

// ── Setup: ensure index exists ─────────────────────────────────────────────────

console.log('\n=== Setup ===');

assert(existsSync(resolve(PROJECT_ROOT, 'data', 'skill-index.json')), 'skill-index.json exists');

const idx = JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'data', 'skill-index.json'), 'utf-8'));
const routerNames = idx.filter(s => s.name.startsWith('router-')).map(s => s.name);
assert(routerNames.length >= 6, `index has ${routerNames.length} router skills (${routerNames.join(', ')})`);

// Clean any leftover output from previous runs
if (existsSync(ZCODE_OUT)) {
  rmSync(ZCODE_OUT, { force: true });
}

// ── Test payloads ──────────────────────────────────────────────────────────────

const payloads = [
  // 1-10: Normal prompts (implicit BM25 routing)
  { name: 'normal-1-laravel-n-plus-one',     prompt: 'fix N+1 query in Laravel',                      expectContext: true  },
  { name: 'normal-2-react-hooks',            prompt: 'set up React hooks for state management',       expectContext: true  },
  { name: 'normal-3-nextjs-routing',         prompt: 'Next.js app router data fetching patterns',     expectContext: true  },
  { name: 'normal-4-design-spacing',         prompt: 'design spacing and layout conventions',         expectContext: true  },
  { name: 'normal-5-testing-tdd',            prompt: 'write unit tests with TDD methodology',         expectContext: true  },
  { name: 'normal-6-backend-api',            prompt: 'create REST API endpoints in Laravel',          expectContext: true  },
  { name: 'normal-7-frontend-css',           prompt: 'implement responsive CSS grid layouts',         expectContext: true  },
  { name: 'normal-8-meta-refactor',          prompt: 'refactor code for better readability',          expectContext: true  },
  { name: 'normal-9-backend-migration',      prompt: 'database migration for user preferences',       expectContext: true  },
  { name: 'normal-10-frontend-state',        prompt: 'manage global state in React application',      expectContext: true  },
  // 11-16: Explicit $mention prompts (router dispatch)
  { name: 'mention-next',    prompt: '$next set up ISR for blog post',    expectContext: true, expectExplicit: true,  expectRouter: 'router-next'    },
  { name: 'mention-laravel', prompt: '$laravel write migration for users', expectContext: true, expectExplicit: true,  expectRouter: 'router-laravel' },
  { name: 'mention-react',   prompt: '$react context API patterns',       expectContext: true, expectExplicit: true,  expectRouter: 'router-react'   },
  { name: 'mention-design',  prompt: '$design color palette for dashboard',expectContext: true, expectExplicit: true,  expectRouter: 'router-design'  },
  { name: 'mention-test',    prompt: '$test integration tests with Playwright', expectContext: true, expectExplicit: true, expectRouter: 'router-test'  },
  { name: 'mention-meta',    prompt: '$meta code review best practices',  expectContext: true, expectExplicit: true,  expectRouter: 'router-meta'    },
  // 17-20: Edge cases (fail-open)
  { name: 'edge-empty',        prompt: '',                              expectContext: false, expectOutputJson: false },
  { name: 'edge-malformed',    payloadRaw: 'not valid json{{{',        expectContext: false, expectOutputJson: false },
  { name: 'edge-long-prompt',  prompt: 'x'.repeat(5500),                expectContext: true  },
  { name: 'edge-special-chars',prompt: 'fix <script>alert("xss")</script> bug', expectContext: true  },
];

console.log('\n=== Running 20 payloads ===\n');

const results = [];

for (const t of payloads) {
  const payloadStr = t.payloadRaw !== undefined
    ? t.payloadRaw + '\n'
    : JSON.stringify({ prompt: t.prompt, cwd: PROJECT_ROOT }) + '\n';

  const { exitCode, outputJson } = await runHook(payloadStr);
  const isMalformed = t.payloadRaw !== undefined;
  const isEmpty = !isMalformed && t.prompt === '';

  const result = { name: t.name, exitCode, extra: {} };

  // 1. Exit code must always be 0 (fail-open)
  assert(exitCode === 0, `[${t.name}] exit code is 0 (got ${exitCode})`);

  // 2. Empty / malformed inputs must fail open (no output.json)
  if (isEmpty || isMalformed) {
    assert(outputJson === null, `[${t.name}] no output.json for ${isMalformed ? 'malformed' : 'empty'} input (fail-open)`);
    result.extra.failOpen = true;
    results.push(result);
    continue;
  }

  // 3. Valid prompts must produce valid output.json with additionalContext
  assert(outputJson !== null, `[${t.name}] output.json was written`);
  if (outputJson !== null) {
    assert(typeof outputJson.hookSpecificOutput === 'object', `[${t.name}] has hookSpecificOutput`);
    assert(typeof outputJson.hookSpecificOutput.additionalContext === 'string', `[${t.name}] additionalContext is string`);

    const ctx = outputJson.hookSpecificOutput.additionalContext;
    if (t.expectContext) {
      assert(ctx.length > 0, `[${t.name}] additionalContext is non-empty (len=${ctx.length})`);
    } else {
      assert(ctx.length === 0, `[${t.name}] additionalContext is empty`);
    }

    // RoutePlan structure
    assert(typeof outputJson.RoutePlan === 'object', `[${t.name}] has RoutePlan`);
    assert(typeof outputJson.RoutePlan.latencyMs === 'number', `[${t.name}] RoutePlan.latencyMs is number (${outputJson.RoutePlan.latencyMs})`);

    // Explicit detection checks
    if (t.expectExplicit) {
      const lines = ctx.split('\n');
      const modeLine = lines.find(l => l.startsWith('Mode:'));
      const routerLine = lines.find(l => l.startsWith('Router:'));
      assert(modeLine && modeLine.includes('explicit'), `[${t.name}] mode is explicit: ${modeLine}`);
      assert(routerLine && routerLine.includes(t.expectRouter), `[${t.name}] router is ${t.expectRouter}: ${routerLine}`);
      result.extra.mode = 'explicit';
      result.extra.router = t.expectRouter;
    } else {
      const lines = ctx.split('\n');
      const modeLine = lines.find(l => l.startsWith('Mode:'));
      result.extra.mode = modeLine && modeLine.includes('explicit') ? 'explicit' : 'implicit';
    }
  }

  results.push(result);

  // Clean up output.json for next iteration
  if (existsSync(ZCODE_OUT)) {
    rmSync(ZCODE_OUT, { force: true });
  }
}

// ── Summary ────────────────────────────────────────────────────────────────────

console.log('\n=== Results ===');
const total = payloads.length;
const allExitZero = results.filter(r => r.exitCode === 0).length;
const ctxPresent = results.filter(r => r.extra.mode === 'explicit' || r.extra.mode === 'implicit').length;
const explicitCount = results.filter(r => r.extra.mode === 'explicit').length;
const failOpenCount = results.filter(r => r.extra.failOpen).length;

console.log(`  Total payloads:      ${total}`);
console.log(`  All exit 0:          ${allExitZero}/${total}`);
console.log(`  Context produced:    ${ctxPresent}/${total - failOpenCount} (non-fail-open)`);
console.log(`  Explicit routed:     ${explicitCount}/6`);
console.log(`  Fail-open cases:     ${failOpenCount}/2`);

console.log(`\n  Passed assertions:   ${passed}`);
console.log(`  Failed assertions:   ${failed}`);

// Cleanup temp dir
cleanTmp();

if (failed > 0) {
  console.error('\nSome assertions failed — see FAIL lines above.');
  process.exit(1);
}
