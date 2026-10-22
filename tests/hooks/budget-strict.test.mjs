/**
 * P6-H-002 (Sub-Phase A.2) — strict context budget for the route hook.
 *
 * Spawns the REAL hook (hooks/route.mjs) against a deterministic synthetic
 * index swapped into data/skill-index.json (same backup/restore pattern as
 * tests/hooks/topk.test.mjs):
 *
 *   - 3 leaf skills share the keyword "budgetgamma", each SKILL.md padded
 *     to exactly 900 chars
 *   - 1 leaf skill "budgetdelta" with a 1500-char SKILL.md (unique keyword)
 *
 * Cases (SKILL_ROUTER_BUDGET_MAX_CHARS is schema-clamped to ≥ 1024):
 *   1. Under budget (default 24000): all 3 matching skills injected whole.
 *   2. Over budget (1024): the top-ranked 900-char skill is injected whole
 *      and the other two are DROPPED — no mid-paragraph truncation, and the
 *      injected content total (900) stays under the hard limit.
 *   3. Reject-all (1024, the 1500-char skill alone): nothing is injected —
 *      output.json exists with an empty additionalContext (fail-open,
 *      exit 0), distinct from an abstention (no output.json at all).
 *
 * The fixture corpus lives in a temp dir (absolute paths in the index, so
 * readSkillContent resolves them regardless of the hook's cwd). The index
 * and prebuilt cache are restored in a finally block.
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
const INDEX_BACKUP = join(ROOT, 'data', 'skill-index.json.a2-backup');
const PREBUILT = join(ROOT, 'data', 'skill-index.prebuilt.json');
const PREBUILT_BACKUP = join(ROOT, 'data', 'skill-index.prebuilt.json.a2-backup');
const WORK = mkdtempSync(join(tmpdir(), 'sr-budget-'));

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

/** Build one fixture skill on disk with the SKILL.md padded to exactly totalLen. */
function makeSkill(name, description, keywords, domains, totalLen) {
  const dir = join(WORK, 'skills', name);
  mkdirSync(dir, { recursive: true });
  const front = `---\nname: ${name}\ndescription: ${description}\n---\n\n`;
  const body = 'P'.repeat(Math.max(0, totalLen - front.length));
  writeFileSync(join(dir, 'SKILL.md'), front + body, 'utf-8');
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
 * context string (null when output.json was not written, '' when it was
 * written with an empty context), and the RoutePlan.
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

/** The per-skill section contents actually present in the injected context. */
function sectionContents(context) {
  if (!context) return [];
  // buildContext emits "<marker>\n\n<content>\n" per skill; split on the
  // marker plus its blank line, then strip the trailing blank line.
  return context
    .split(/--- SKILL: [^\n]+ ---\n\n/)
    .slice(1)
    .map((s) => s.replace(/\s+$/, ''));
}
const injectedCount = (context) =>
  context ? (context.match(/--- SKILL: /g) ?? []).length : 0;

// ── Build the fixture corpus + the swapped-in index ─────────────────────────
const gamma = [];
for (let i = 0; i < 3; i++) {
  gamma.push(
    makeSkill(
      `budget-gamma-${String(i).padStart(2, '0')}`,
      `budgetgamma pattern ${i} for backend services`,
      ['budgetgamma', 'backend'],
      ['backend'],
      900
    )
  );
}
gamma.push(
  makeSkill(
    'budgetdelta',
    'budgetdelta heavy reference for backend docs',
    ['budgetdelta', 'backend'],
    ['backend'],
    1500
  )
);

// Swap the fixture into the hook's fixed index path; restore in finally.
const hadIndex = existsSync(INDEX);
if (hadIndex) copyFileSync(INDEX, INDEX_BACKUP);
writeFileSync(INDEX, JSON.stringify(gamma), 'utf-8');
const hadPrebuilt = existsSync(PREBUILT);
if (hadPrebuilt) copyFileSync(PREBUILT, PREBUILT_BACKUP);
if (hadPrebuilt) rmSync(PREBUILT, { force: true });

const BUDGET = { SKILL_ROUTER_BUDGET_MAX_CHARS: '1024' };

console.log('\n=== Hook: strict context budget (P6-H-002) ===\n');
try {
  // 1. Under budget: all matching skills injected whole.
  console.log('1. Under budget (default 24000): all matching skills kept');
  const under = await runHook('budgetgamma');
  assert(under.code === 0, 'hook exits 0');
  assert(injectedCount(under.context) === 3, `3 matching skills injected (got ${injectedCount(under.context)})`);
  const underSections = sectionContents(under.context);
  assert(
    underSections.every((s) => s.length === 900),
    'each section is the full 900-char content, untruncated'
  );

  // 2. Over budget: whole-skill drop, hard limit held.
  console.log('\n2. Over budget (1024): top skill kept, the rest dropped whole');
  const over = await runHook('budgetgamma', BUDGET);
  assert(over.code === 0, 'hook exits 0');
  assert(injectedCount(over.context) === 1, `exactly 1 skill injected (got ${injectedCount(over.context)})`);
  assert(/Selected: budget-gamma-00/.test(over.context ?? ''), 'the top-ranked skill is the one kept');
  assert(!/budget-gamma-0[12]/.test(over.context ?? ''), 'dropped skills are absent from the context');
  const overSections = sectionContents(over.context);
  const overTotal = overSections.reduce((sum, s) => sum + s.length, 0);
  assert(overTotal === 900 && overTotal <= 1024, `injected content total ${overTotal} ≤ 1024 hard limit`);

  // 3. Reject-all: the top skill alone exceeds the budget → empty context.
  console.log('\n3. Top skill alone over budget → rejected, empty context');
  const reject = await runHook('budgetdelta', BUDGET);
  assert(reject.code === 0, 'hook exits 0 (fail-open)');
  assert(
    reject.context === '',
    `output.json written with EMPTY additionalContext (got ${JSON.stringify(reject.context?.slice(0, 40))})`
  );
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
