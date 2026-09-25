/**
 * Regression test for the Phase 4-5 bug: `router-*` skills polluting implicit
 * routing (docs/reports/phase-6-test-audit.md section 5, item 6).
 *
 * Phase 4.1 fixed this by filtering router dispatchers out of the index the
 * hook uses for implicit retrieval (hooks/route.mjs leafIndex). Until now the
 * only tests asserting router behaviour filtered to a leaf index *inside the
 * test*; nothing asserted that the hook itself does the filtering.
 *
 * This test therefore:
 *   1. proves routers DO win implicit ranking when the unfiltered index is
 *      used (precondition — otherwise the test would pass vacuously),
 *   2. spawns the real hook and asserts no router-* skill is ever listed in
 *      the Selected line nor injected as a SKILL block for implicit prompts,
 *   3. asserts explicit $mention routing still works after the filter.
 *
 * The hook reports its selection on the `Selected:` line of
 * additionalContext; .zcode/output.json has no `skills` array (see
 * hooks/route.mjs RoutePlan, which carries only mode/domains/candidates).
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { rankSkills } from '../../src/core/retriever/bm25.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const HOOK_PATH = resolve(PROJECT_ROOT, 'hooks', 'route.mjs');
const ZCODE_OUT = resolve(PROJECT_ROOT, '.zcode', 'output.json');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log(`  \u2713 ${message}`); }
  else { failed++; console.error(`  \u2717 ${message}`); }
}

/**
 * Run hooks/route.mjs with a JSON payload on stdin. The output file is removed
 * before the spawn so a stale file from a previous run can never be read.
 */
function runHook(prompt) {
  return new Promise((done) => {
    if (existsSync(ZCODE_OUT)) rmSync(ZCODE_OUT, { force: true });
    const p = spawn('node', [HOOK_PATH], { cwd: PROJECT_ROOT });
    let err = '';
    p.stderr.on('data', (c) => { err += c; });
    p.stdin.write(JSON.stringify({ prompt, cwd: PROJECT_ROOT }) + '\n');
    p.stdin.end();
    p.on('close', (code) => {
      let out = null;
      try {
        if (existsSync(ZCODE_OUT)) out = JSON.parse(readFileSync(ZCODE_OUT, 'utf-8'));
      } catch { out = null; }
      if (existsSync(ZCODE_OUT)) rmSync(ZCODE_OUT, { force: true });
      done({ exitCode: code ?? 0, output: out, stderr: err });
    });
  });
}

function context(output) {
  return output?.hookSpecificOutput?.additionalContext ?? '';
}

/** Skill names from the `Selected: a, b, c` line the hook emits. */
function selectedNames(output) {
  const line = context(output).split('\n').find((l) => l.startsWith('Selected: '));
  if (!line) return [];
  return line.slice('Selected: '.length).split(',').map((s) => s.trim()).filter(Boolean);
}

function injectedBlocks(output) {
  return context(output).split('\n').filter((l) => l.startsWith('--- SKILL: '));
}

// ── 1. Preconditions ──────────────────────────────────────────────────────────

console.log('\n=== Implicit router filter regression ===\n');

const index = JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'data', 'skill-index.json'), 'utf-8'));
const routers = index.filter((s) => s.name.startsWith('router-')).map((s) => s.name);

assert(routers.length >= 6, `index contains ${routers.length} router skills`);
assert(index.length > routers.length, `index also contains ${index.length - routers.length} leaf skills`);

const PROBES = [
  'refactor code for better readability',
  'set up React hooks for state management',
  'fix N+1 query in Laravel',
  'write unit tests with TDD methodology',
  'design spacing and layout conventions',
  'create REST API endpoints',
];

// Unfiltered ranking: do routers actually compete? If they never appear here,
// the hook-side assertions below would prove nothing.
let unfilteredHits = 0;
for (const prompt of PROBES) {
  const ranked = rankSkills(prompt, index);
  if (ranked.slice(0, 5).some((r) => r.skill.name.startsWith('router-'))) unfilteredHits++;
}

assert(
  unfilteredHits > 0,
  `PRECONDITION: router-* skills enter the implicit top-5 for ${unfilteredHits}/${PROBES.length} probes on the UNFILTERED index`
);

// ── 2. The hook must never list a router for an implicit prompt ───────────────

console.log('');
for (const prompt of PROBES) {
  const label = `"${prompt.slice(0, 34)}"`;
  const { exitCode, output, stderr } = await runHook(prompt);

  assert(exitCode === 0, `[implicit] exit 0 for ${label}`);
  if (output === null) {
    assert(false, `[implicit] hook wrote .zcode/output.json for ${label}${stderr ? ` (stderr: ${stderr.trim()})` : ''}`);
    continue;
  }

  const selected = selectedNames(output);
  const bad = selected.filter((n) => n.startsWith('router-'));
  assert(bad.length === 0, `[implicit] no router-* in Selected line for ${label} (${selected.length} skills)`);

  const blocks = injectedBlocks(output);
  const badBlocks = blocks.filter((l) => l.includes('router-'));
  assert(badBlocks.length === 0, `[implicit] no router-* SKILL block injected for ${label} (${blocks.length} block(s))`);
  assert(/^Mode: implicit$/m.test(context(output)), `[implicit] mode is implicit for ${label}`);
}

// ── 3. Explicit $mention routing still works ──────────────────────────────────

console.log('');
for (const [mention, router] of [['$next', 'router-next'], ['$test', 'router-test']]) {
  const { exitCode, output, stderr } = await runHook(`${mention} set up ISR for a blog post`);
  assert(exitCode === 0, `[explicit] exit 0 for ${mention}`);
  if (output === null) {
    assert(false, `[explicit] hook wrote .zcode/output.json for ${mention}${stderr ? ` (stderr: ${stderr.trim()})` : ''}`);
    continue;
  }
  const ctx = context(output);
  assert(new RegExp(`^Router: ${router}$`, 'm').test(ctx), `[explicit] ${mention} routes to ${router}`);
  assert(/^Mode: explicit$/m.test(ctx), `[explicit] ${mention} mode is explicit`);

  const selected = selectedNames(output);
  assert(selected.length > 0, `[explicit] ${mention} selected ${selected.length} skill(s)`);
  const bad = selected.filter((n) => n.startsWith('router-'));
  assert(bad.length === 0, `[explicit] ${mention} lists leaf skills only (${selected.slice(0, 3).join(', ')}${selected.length > 3 ? ', ...' : ''})`);
}

console.log(`\n  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
if (existsSync(ZCODE_OUT)) rmSync(ZCODE_OUT, { force: true });
if (failed > 0) process.exit(1);
