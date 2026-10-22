/**
 * P6-H-001 (Sub-Phase A.1) — topK shortlist policy for the route hook.
 *
 * Spawns the REAL hook (hooks/route.mjs) against a deterministic synthetic
 * index that is swapped into data/skill-index.json for the duration of the
 * test (same backup/restore pattern as tests/hooks/perf.test.mjs):
 *
 *   - 24 leaf skills share the keyword "quixotic"    (domains: backend)
 *   -  2 leaf skills share the keyword "zephyrkite"  (domains: backend)
 *   -  1 "router-laravel" dispatcher (domains: [], so it never competes
 *     in the backend-scoped explicit ranking)
 *
 * Invariants verified through the real hook:
 *   1. Default topK=5: a prompt matching 24 skills injects exactly 5.
 *   2. No padding: a prompt matching 2 skills injects exactly 2.
 *   3. SKILL_ROUTER_TOPK=3: injects exactly 3.
 *   4. SKILL_ROUTER_TOPK=100: clamped to 20 (with a warning), injects 20.
 *   5. SKILL_ROUTER_TOPK=0: clamped to 1, injects 1.
 *   6. Explicit "$laravel" prompt still respects the cap.
 *
 * The fixture corpus lives in a temp dir (absolute paths in the index, so
 * readSkillContent resolves them regardless of the hook's cwd). The index
 * and prebuilt cache are restored in a finally block, so a failing
 * assertion never leaves the working tree dirty.
 */
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const HOOK = join(ROOT, 'hooks', 'route.mjs');
const INDEX = join(ROOT, 'data', 'skill-index.json');
const INDEX_BACKUP = join(ROOT, 'data', 'skill-index.json.a1-backup');
const PREBUILT = join(ROOT, 'data', 'skill-index.prebuilt.json');
const PREBUILT_BACKUP = join(ROOT, 'data', 'skill-index.prebuilt.json.a1-backup');
const WORK = mkdtempSync(join(tmpdir(), 'sr-topk-'));

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

/** Build one fixture skill on disk (under WORK) and return its index entry. */
function makeSkill(name, description, keywords, domains) {
  const dir = join(WORK, 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${description}. Body padding ${name}.\n`,
    'utf-8'
  );
  return {
    name,
    description,
    keywords,
    domains,
    path: join(dir, 'SKILL.md'),
    version: '1',
  };
}

/**
 * Spawn the real hook once; resolves with exit code, stderr, the injected
 * context string (null when the hook abstained), and the RoutePlan.
 */
function runHook(prompt, env = {}) {
  return new Promise((done) => {
    const outJson = join(WORK, '.zcode', 'output.json');
    if (existsSync(outJson)) rmSync(outJson, { force: true });
    const child = spawn('node', [HOOK], {
      cwd: ROOT,
      env: { ...process.env, ...env },
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdout.on('data', () => {});
    child.on('close', (code) => {
      let context = null;
      let plan = null;
      if (existsSync(outJson)) {
        const parsed = JSON.parse(readFileSync(outJson, 'utf-8'));
        context = parsed.hookSpecificOutput?.additionalContext ?? '';
        plan = parsed.RoutePlan ?? null;
      }
      done({ code, stderr, context, plan });
    });
    child.stdin.write(JSON.stringify({ prompt, cwd: WORK }));
    child.stdin.end();
  });
}

/** Count the skill blocks actually present in the injected context. */
const injectedCount = (context) =>
  context ? (context.match(/--- SKILL: /g) ?? []).length : 0;

// ── Build the fixture corpus + the swapped-in index ─────────────────────────
const skills = [];
for (let i = 0; i < 24; i++) {
  skills.push(makeSkill(
    `topk-qa-${String(i).padStart(2, '0')}`,
    `quixotic caching pattern ${i} for backend services`,
    ['quixotic', 'backend'],
    ['backend']
  ));
}
for (let i = 0; i < 2; i++) {
  skills.push(makeSkill(
    `topk-zeta-${String(i).padStart(2, '0')}`,
    `zephyrkite utility ${i} for backend tooling`,
    ['zephyrkite', 'backend'],
    ['backend']
  ));
}
// The router dispatcher must be in the index for $laravel detection but must
// not compete in the backend-scoped explicit ranking (empty domains).
skills.push(makeSkill('router-laravel', 'laravel router dispatcher', ['laravel'], []));

// Swap the fixture into the hook's fixed index path; restore in finally.
const hadIndex = existsSync(INDEX);
if (hadIndex) copyFileSync(INDEX, INDEX_BACKUP);
writeFileSync(INDEX, JSON.stringify(skills), 'utf-8');
const hadPrebuilt = existsSync(PREBUILT);
if (hadPrebuilt) copyFileSync(PREBUILT, PREBUILT_BACKUP);
if (hadPrebuilt) rmSync(PREBUILT, { force: true });

console.log('\n=== Hook: topK shortlist policy (P6-H-001) ===\n');
try {
  // 1. Default topK=5: 24 matches, 5 injected.
  console.log('1. Default topK caps a 24-match prompt at 5');
  const def = await runHook('quixotic');
  assert(def.code === 0, 'hook exits 0');
  assert(def.context !== null, 'context is written');
  assert(injectedCount(def.context) === 5, `5 skills injected by default (got ${injectedCount(def.context)})`);
  const selectedLine = /Selected: (.+)/.exec(def.context ?? '')?.[1] ?? '';
  assert(selectedLine.split(', ').length === 5, `'Selected:' header lists exactly the 5 injected skills`);

  // 2. No padding: 2 matches, 2 injected.
  console.log('\n2. A 2-match prompt injects 2, not 5');
  const two = await runHook('zephyrkite');
  assert(injectedCount(two.context) === 2, `2 skills injected, no padding (got ${injectedCount(two.context)})`);

  // 3. Env override TOPK=3.
  console.log('\n3. SKILL_ROUTER_TOPK=3 injects exactly 3');
  const three = await runHook('quixotic', { SKILL_ROUTER_TOPK: '3' });
  assert(three.code === 0, 'hook exits 0');
  assert(injectedCount(three.context) === 3, `3 skills injected (got ${injectedCount(three.context)})`);

  // 4. Out-of-range high value clamps to 20 with a warning.
  console.log('\n4. SKILL_ROUTER_TOPK=100 clamps to 20 and warns');
  const clamped = await runHook('quixotic', { SKILL_ROUTER_TOPK: '100' });
  assert(injectedCount(clamped.context) === 20, `20 skills injected after clamp (got ${injectedCount(clamped.context)})`);
  assert(
    /SKILL_ROUTER_TOPK=100 out of range/.test(clamped.stderr),
    'out-of-range env value logged a clamp warning on stderr'
  );

  // 5. Out-of-range low value clamps to 1.
  console.log('\n5. SKILL_ROUTER_TOPK=0 clamps to 1');
  const low = await runHook('quixotic', { SKILL_ROUTER_TOPK: '0' });
  assert(injectedCount(low.context) === 1, `1 skill injected after clamp (got ${injectedCount(low.context)})`);

  // 6. Explicit $-mention respects the cap.
  console.log('\n6. Explicit "$laravel" prompt respects topK');
  const explicit = await runHook('$laravel quixotic');
  assert(explicit.code === 0, 'hook exits 0');
  assert(injectedCount(explicit.context) <= 5, `injected count respects topK=5 (got ${injectedCount(explicit.context)})`);
  assert(!/--- SKILL: router-/.test(explicit.context ?? ''), 'the router dispatcher itself is never injected');
} finally {
  // Restore the real index + prebuilt cache and remove the fixture tree.
  if (hadIndex && existsSync(INDEX_BACKUP)) {
    copyFileSync(INDEX_BACKUP, INDEX);
    rmSync(INDEX_BACKUP, { force: true });
  } else if (existsSync(INDEX)) {
    rmSync(INDEX, { force: true });
  }
  if (hadPrebuilt && existsSync(PREBUILT_BACKUP)) {
    copyFileSync(PREBUILT_BACKUP, PREBUILT);
    rmSync(PREBUILT_BACKUP, { force: true });
  }
  rmSync(WORK, { recursive: true, force: true });
}

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);
if (failed > 0) process.exit(1);
