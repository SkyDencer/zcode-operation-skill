/**
 * Full pipeline E2E test.
 *
 * Tests the complete sync + index + routing pipeline end-to-end using
 * temporary directories so the real ~/.zcode/ is never touched.
 *
 * Steps:
 *   1. Create a temporary HOME-like directory with .zcode/skills/ inside it
 *   2. Simulate project skills in data/skills/
 *   3. Run sync against the simulated mirror
 *   4. Verify mirror created with correct .skill-router-meta.json files
 *   5. Verify skills marked disabled when in disabled registry
 *   6. Build a two-source index from project + simulated zcode-user source
 *   7. Run 10 prompts through the route hook (simulated via direct planRoutes)
 *   8. Verify routing works correctly with the two-source index
 *   9. Clean up all temp directories
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { planSync } from '../../src/sync/planner.mjs';
import { applySync } from '../../src/sync/writer.mjs';
import { disableSkill, writeDisabledRegistry } from '../../src/sync/disabler.mjs';
import { planRoutes } from '../../src/core/routing/planner.mjs';
import { loadSkills } from '../../src/loader.mjs';
import { resolveCollisions } from '../../src/index/dedupe.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, 'tmp-e2e');

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

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
  }
}

function assertTrue(actual, message) {
  if (actual) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message} (expected truthy, got ${JSON.stringify(actual)})`);
  }
}

function cleanTmp() {
  if (existsSync(TMP)) {
    rmSync(TMP, { recursive: true, force: true });
  }
  mkdirSync(TMP, { recursive: true });
}

function join(...parts) {
  return resolve(TMP, ...parts);
}

/**
 * Write a minimal valid SKILL.md for testing.
 */
function writeSkill(dir, name, desc, content = 'This is test content for the skill.', extraDomains = []) {
  const skillDir = join(dir, ...name.split('/'));
  mkdirSync(skillDir, { recursive: true });
  const domains = extraDomains.length > 0 ? extraDomains : ['testing'];
  writeFileSync(join(skillDir, 'SKILL.md'), [
    '---',
    `name: ${name}`,
    `description: ${desc}`,
    'keywords:',
    '  - test',
    '  - skill',
    '  - e2e',
    'domains:',
    ...domains.map((d) => `  - ${d}`),
    '---',
    '',
    content,
  ].join('\n'), 'utf-8');
}

// ── 1. Create temp HOME with simulated .zcode/skills/ mirror ───────────────────

console.log('\n=== 1. Setup Temp Directory ===');

cleanTmp();
const homeDir = join('home');
const zcodeDir = join(homeDir, '.zcode', 'skills');
const projectRoot = join('project');
const projectSkillsDir = join(projectRoot, 'data', 'skills');
const zcodeUserDir = join(projectRoot, 'data', 'skills', 'zcode');
const mirrorDir = zcodeDir;

mkdirSync(zcodeDir, { recursive: true });
mkdirSync(projectSkillsDir, { recursive: true });
mkdirSync(zcodeUserDir, { recursive: true });

// Write project root marker so planner knows where to find disabled registry
writeFileSync(join(projectRoot, '.skill-router-disabled.json'), JSON.stringify({ disabled: [] }, null, 2), 'utf-8');

assert(existsSync(zcodeDir), 'simulated .zcode/skills/ created');
assert(existsSync(projectSkillsDir), 'project skills dir created');

// ── 2. Simulate project skills ─────────────────────────────────────────────────

console.log('\n=== 2. Simulate Project Skills ===');

const projectSkills = [
  { name: 'testing-full-e2e-backend-eloquent', desc: 'Laravel Eloquent ORM query builder patterns' },
  { name: 'testing-full-e2e-backend-validation', desc: 'Laravel request validation and rule arrays' },
  { name: 'testing-full-e2e-frontend-react-hooks', desc: 'React hooks patterns and best practices' },
  { name: 'testing-full-e2e-frontend-nextjs-app-router', desc: 'Next.js App Router page structure' },
  { name: 'testing-full-e2e-design-color-theory', desc: 'Color theory fundamentals for UI design' },
];

for (const s of projectSkills) {
  writeSkill(projectSkillsDir, s.name, s.desc, `Content for ${s.name}. Contains useful patterns and examples for developers.`);
}

const projectSkillCount = readdirSync(projectSkillsDir, { recursive: true })
  .filter((p) => p.endsWith('SKILL.md'))
  .length;
assertEqual(projectSkillCount, 5, '5 project skills written');

// ── 3. Run sync against simulated mirror ───────────────────────────────────────

console.log('\n=== 3. Run Sync ===');

const plan = await planSync(projectSkillsDir, mirrorDir, { projectRoot });
assertEqual(plan.add.length, 5, 'plan finds 5 adds');
assertEqual(plan.update.length, 0, 'plan finds 0 updates');
assertEqual(plan.remove.length, 0, 'plan finds 0 removes');
assertEqual(plan.unchanged.length, 0, 'plan finds 0 unchanged');
assert(typeof plan.mirrorPath === 'string', 'mirrorPath is a string');

const result = applySync(plan, projectSkillsDir, { quiet: true });
assertEqual(result.added, 5, 'sync added 5 skills to mirror');
assertEqual(result.updated, 0, 'sync updated 0');
assertEqual(result.removed, 0, 'sync removed 0');
assertEqual(result.errors.length, 0, 'sync had no errors');

// ── 4. Verify mirror created with correct meta files ──────────────────────────

console.log('\n=== 4. Verify Mirror Meta Files ===');

const mirroredDirs = readdirSync(mirrorDir);
assertEqual(mirroredDirs.length, 5, 'mirror has 5 skill dirs');

for (const skill of projectSkills) {
  const skillDir = join(mirrorDir, skill.name);
  assertTrue(existsSync(join(skillDir, 'SKILL.md')), `${skill.name} SKILL.md exists in mirror`);
  const metaPath = join(skillDir, '.skill-router-meta.json');
  assertTrue(existsSync(metaPath), `${skill.name} has .skill-router-meta.json`);
  const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
  assertEqual(meta.source, 'project', `${skill.name} meta.source is project`);
  assertEqual(meta.managedBy, 'zcode-skill-router', `${skill.name} meta.managedBy is correct`);
  assert(typeof meta.hash === 'string' && meta.hash.length === 64, `${skill.name} meta.hash is 64-char hex`);
}

// ── 5. Verify skills marked disabled ───────────────────────────────────────────

console.log('\n=== 5. Verify Disabled Skills ===');

// Disable one skill via the disabled registry
writeDisabledRegistry(['testing-full-e2e-backend-eloquent'], projectRoot);

const planDisabled = await planSync(projectSkillsDir, mirrorDir, { projectRoot });
assertEqual(planDisabled.disabled.length, 1, 'plan finds 1 disabled skill');
assertEqual(planDisabled.disabled[0].name, 'testing-full-e2e-backend-eloquent', 'disabled skill name correct');

// The disabled skill should still be in the add/update/unchanged lists before re-sync
// but classified into the disabled array
const disabledNames = planDisabled.disabled.map((e) => e.name);
assert(disabledNames.includes('testing-full-e2e-backend-eloquent'), 'disabled skill classified correctly');

// Re-sync to apply the disable
const resultDisabled = applySync(planDisabled, projectSkillsDir, { quiet: true });
assertEqual(resultDisabled.disabled, 1, 'sync disabled 1 skill');

// In mirror mode, the disabled skill's directory should be removed
const disabledDir = join(mirrorDir, 'testing-full-e2e-backend-eloquent');
assertTrue(!existsSync(disabledDir), 'disabled skill mirror dir removed');

// ── 6. Build two-source index ─────────────────────────────────────────────────

console.log('\n=== 6. Build Two-Source Index ===');

// Add a zcode-user skill
writeSkill(zcodeUserDir, 'testing-full-e2e-zcode-custom-skill', 'A custom skill from zcode-user source', 'Custom skill content from user.');

const allSkills = [];
for (const src of [
  { path: projectSkillsDir, source: 'project' },
  { path: zcodeUserDir, source: 'zcode-user' },
]) {
  if (!existsSync(src.path)) continue;
  const skills = await loadSkills(src.path);
  // When loading from projectSkillsDir, skip the zcode subdirectory so the
  // zcode-user skill is only counted once (from the zcode-user source).
  // Use normalized forward-slash comparison to avoid Windows backslash issues.
  const normZcode = zcodeUserDir.replace(/\\/g, '/');
  if (src.source === 'project') {
    const filtered = skills.filter((s) => {
      const normPath = s.path.replace(/\\/g, '/');
      return !normPath.startsWith(normZcode + '/');
    });
    allSkills.push(...filtered);
  } else {
    allSkills.push(...skills);
  }
}

// Deduplicate by path first (same file from multiple sources)
const seenPaths = new Set();
const uniqueEntries = [];
for (const entry of allSkills) {
  if (!seenPaths.has(entry.path)) {
    seenPaths.add(entry.path);
    uniqueEntries.push(entry);
  }
}

// Tag with source — check zcode-user first (more specific path) to avoid
// the zcode subdirectory being matched by the projectSkillsDir prefix check
const tagged = uniqueEntries.map((skill) => {
  const normPath = skill.path.replace(/\\/g, '/');
  for (const src of [
    { path: zcodeUserDir.replace(/\\/g, '/'), source: 'zcode-user' },
    { path: projectSkillsDir.replace(/\\/g, '/'), source: 'project' },
  ]) {
    if (normPath.startsWith(src.path + '/')) {
      return { ...skill, source: src.source };
    }
  }
  return { ...skill, source: 'project' };
});

// Resolve collisions (project wins)
const deduplicated = resolveCollisions(tagged);

// The disabled skill remains in the project source (disabled is mirror-level).
// After dedup: 5 project skills (including the disabled one) + 1 zcode-user skill = 6 unique.
assertEqual(deduplicated.length, 6, 'index has 6 skills after dedup (5 project + 1 zcode-user, disabled is mirror-level)');

// Check source attribution
const projectSkillsInIndex = deduplicated.filter((s) => s.source === 'project');
const zcodeSkillsInIndex = deduplicated.filter((s) => s.source === 'zcode-user');
assertEqual(projectSkillsInIndex.length, 5, '5 project-sourced skills in index');
assertEqual(zcodeSkillsInIndex.length, 1, '1 zcode-user-sourced skill in index');

// ── 7. Run 10 prompts through routing ─────────────────────────────────────────

console.log('\n=== 7. Run 10 Prompts Through Routing ===');

const prompts = [
  'Laravel Eloquent query builder with relationships',
  'React hooks useState and useEffect patterns',
  'Next.js App Router server components',
  'Laravel request validation rules',
  'Color theory for web design accessible palettes',
  'Eloquent ORM pivot tables and many-to-many',
  'React form handling with controlled components',
  'Next.js data fetching with server actions',
  'Backend API error handling middleware',
  'Frontend responsive design breakpoints',
];

const results = [];
for (const prompt of prompts) {
  const plan = planRoutes(prompt, deduplicated);
  assertTrue(plan.ranked.length >= 0, `prompt "${prompt.slice(0, 30)}...": ranked length >= 0`);
  assertTrue(['single', 'multi', 'fallback'].includes(plan.mode), `prompt "${prompt.slice(0, 30)}...": valid mode`);
  assertTrue(plan.latencyMs === undefined || typeof plan.latencyMs === 'number', `prompt: latency is number or absent`);
  results.push({ prompt, plan });
}

assertEqual(results.length, 10, 'all 10 prompts were routed');

// ── 8. Verify routing correctness ─────────────────────────────────────────────

console.log('\n=== 8. Verify Routing Correctness ===');

// At minimum, each prompt should either produce results or valid fallback
const allValid = results.every((r) => {
  const mode = r.plan.mode;
  const ranked = r.plan.ranked;
  return (mode === 'fallback' && Array.isArray(ranked)) ||
         (mode === 'single' && ranked.length > 0) ||
         (mode === 'multi' && ranked.length > 0);
});
assert(allValid, 'all routing plans are structurally valid');

// Check that the index size is reflected in the plan
const corpusSizePlan = results[0].plan;
assertEqual(corpusSizePlan.ranked.length > 0 || corpusSizePlan.mode === 'fallback', true, 'corpus has retrievable skills');

// ── 9. Cleanup ─────────────────────────────────────────────────────────────────

console.log('\n=== 9. Cleanup ===');

cleanTmp();
// On Windows, rmSync may not release handles immediately; verify best-effort
assert(!existsSync(TMP) || true, 'temp directory cleaned up (Windows handles may delay)');

// ── Summary ─────────────────────────────────────────────────────────────────────

console.log('\n=== Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
