/**
 * End-to-end deploy test.
 *
 * Verifies the full deploy pipeline:
 *   1. Create temp project with 6 routers + temp mirror with 53 leaf skills
 *   2. Run planDeploy + applyDeploy
 *   3. Verify 6 routers present and healthy
 *   4. Verify 53 leaves disabled via shadow mechanism
 *   5. Verify meta files written
 *   6. Verify no user-managed directories were touched
 *   7. Verify verifyDeploy() reports success
 *   8. Clean up temp directory
 */
import { describe, it } from 'node:test';
import { equal, ok, deepEqual } from 'node:assert';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { planDeploy } from '../../src/deploy/planner.mjs';
import { applyDeploy } from '../../src/deploy/writer.mjs';
import { verifyDeploy } from '../../src/deploy/verifier.mjs';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const REAL_ROUTERS = join(PROJECT_ROOT, 'router-skills');
const TMP_PREFIX = join(mkdtempSync(join(homedir(), '.zcode-test-')));

// ── Helpers ────────────────────────────────────────────────────────────────────

function hash(content) {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

function copyRouter(srcDir, name, dstRoot) {
  const src = join(srcDir, name);
  const dst = join(dstRoot, name);
  mkdirSync(dst, { recursive: true });
  const skillMd = join(src, 'SKILL.md');
  if (existsSync(skillMd)) {
    copyFileSync(skillMd, join(dst, 'SKILL.md'));
  }
}

function createLeafMirror(mirrorRoot, count) {
  for (let i = 0; i < count; i++) {
    const name = `leaf-skill-${String(i).padStart(3, '0')}`;
    const dir = join(mirrorRoot, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: Test leaf skill ${i}.\nkeywords: [test, leaf]\ndomains: [testing]\n---\n\n# ${name}\n\nThis is leaf skill ${i}.\n`,
      'utf-8');
  }
}

function createUserManagedDir(mirrorRoot, name) {
  const dir = join(mirrorRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), 'user-created content', 'utf-8');
  // No .skill-router-meta.json — this is user-managed
}

function readMeta(dir) {
  const p = join(dir, '.skill-router-meta.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8'));
}

// ── Test ───────────────────────────────────────────────────────────────────────

describe('deploy e2e', () => {
  let projectDir, mirrorRoot, snapshotPath;

  it('should deploy 6 routers and disable 53 leaves', () => {
    // Setup: create temp project with router-skills/ and temp mirror
    projectDir = join(TMP_PREFIX, 'project');
    mirrorRoot = join(TMP_PREFIX, 'mirror');
    const rsDir = join(projectDir, 'router-skills');
    mkdirSync(rsDir, { recursive: true });
    mkdirSync(mirrorRoot, { recursive: true });

    // Copy 6 real routers into project
    const routers = ['router-design', 'router-laravel', 'router-meta',
      'router-next', 'router-react', 'router-test'];
    for (const name of routers) {
      copyRouter(REAL_ROUTERS, name, rsDir);
    }

    // Populate mirror with 53 leaf skills + 1 user-managed dir
    createLeafMirror(mirrorRoot, 53);
    createUserManagedDir(mirrorRoot, 'user-custom-skill');

    // Create disabled registry with all 53 leaf names
    const disabledNames = [];
    for (let i = 0; i < 53; i++) {
      disabledNames.push(`leaf-skill-${String(i).padStart(3, '0')}`);
    }
    writeFileSync(join(projectDir, '.skill-router-disabled.json'),
      JSON.stringify({ disabled: disabledNames, lastModified: new Date().toISOString() }, null, 2) + '\n',
      'utf-8');

    // Plan
    const plan = planDeploy(projectDir, mirrorRoot);

    // Verify plan
    equal(plan.routers.add.length, 6, 'plan has 6 routers to add');
    equal(plan.routers.update.length, 0, 'plan has 0 updates');
    equal(plan.routers.unchanged.length, 0, 'plan has 0 unchanged');
    equal(plan.leaves.disable.length, 53, 'plan has 53 leaves to disable');
    equal(plan.leaves.alreadyDisabled.length, 0, 'plan has 0 already disabled');

    // Record pre-deploy state of user-managed dir
    const userDir = join(mirrorRoot, 'user-custom-skill');
    const userContentBefore = readFileSync(join(userDir, 'SKILL.md'), 'utf-8');

    // Apply deploy
    snapshotPath = join(TMP_PREFIX, 'snapshot');
    const result = applyDeploy(plan, projectDir, mirrorRoot, {
      quiet: true,
      snapshotDir: snapshotPath,
    });

    // ── Verify routers ─────────────────────────────────────────────────────────
    ok(result.added === 6, 'added 6 routers');
    ok(result.errors.length === 0, 'no errors');

    for (const name of routers) {
      const routerDir = join(mirrorRoot, name);
      ok(existsSync(join(routerDir, 'SKILL.md')), `router ${name} has SKILL.md`);
      const meta = readMeta(routerDir);
      ok(meta !== null, `router ${name} has meta`);
      equal(meta.managedBy, 'zcode-skill-router', `router ${name} meta.managedBy correct`);
      equal(meta.source, 'router-skills', `router ${name} meta.source correct`);
      ok(typeof meta.hash === 'string' && meta.hash.length === 64, `router ${name} meta.hash is 64-char hex`);
    }

    // ── Verify leaves disabled ─────────────────────────────────────────────────
    for (let i = 0; i < 53; i++) {
      const name = `leaf-skill-${String(i).padStart(3, '0')}`;
      const leafDir = join(mirrorRoot, name);
      ok(existsSync(leafDir), `leaf ${name} directory exists`);
      const skillContent = readFileSync(join(leafDir, 'SKILL.md'), 'utf-8');
      ok(skillContent.includes('disabled: true'), `leaf ${name} has disabled frontmatter`);
    }

    // ── Verify user-managed dir untouched ──────────────────────────────────────
    const userContentAfter = readFileSync(join(userDir, 'SKILL.md'), 'utf-8');
    equal(userContentAfter, userContentBefore, 'user-managed dir content preserved');
    ok(readMeta(userDir) === null, 'user-managed dir has no meta');

    // ── Verify verifyDeploy() ──────────────────────────────────────────────────
    const report = verifyDeploy(projectDir, mirrorRoot);
    ok(report.routersOk, 'routersOk is true');
    ok(report.leavesOk, 'leavesOk is true');
    equal(report.warnings.length, 0, 'no warnings');
  });

  it('should clean up temp directory', () => {
    rmSync(TMP_PREFIX, { recursive: true, force: true });
    ok(!existsSync(TMP_PREFIX), 'temp directory cleaned up');
  });
});
