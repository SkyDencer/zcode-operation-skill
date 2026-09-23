/**
 * Idempotency test.
 *
 * Verifies that running deploy twice on the same mirror produces zero changes
 * on the second run.
 *   1. Deploy to temp dir
 *   2. Deploy again to same dir
 *   3. Verify second deploy reports zero changes
 */
import { describe, it } from 'node:test';
import { equal, ok } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { planDeploy } from '../../src/deploy/planner.mjs';
import { applyDeploy } from '../../src/deploy/writer.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const REAL_ROUTERS = join(PROJECT_ROOT, 'router-skills');
const TMP_PREFIX = join(mkdtempSync(join(homedir(), '.zcode-test-')));

function copyRouter(srcDir, name, dstRoot) {
  const src = join(srcDir, name);
  const dst = join(dstRoot, name);
  mkdirSync(dst, { recursive: true });
  const skillMd = join(src, 'SKILL.md');
  if (existsSync(skillMd)) {
    copyFileSync(skillMd, join(dst, 'SKILL.md'));
  }
}

describe('deploy idempotency', () => {
  let projectDir, mirrorRoot;

  it('should report zero changes on second deploy', () => {
    // Setup
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

    // Create empty disabled registry
    const disabledPath = join(projectDir, '.skill-router-disabled.json');
    writeFileSync(disabledPath,
      JSON.stringify({ disabled: [], lastModified: new Date().toISOString() }, null, 2) + '\n',
      'utf-8');

    // ── First deploy ─────────────────────────────────────────────────────────────
    const plan1 = planDeploy(projectDir, mirrorRoot);
    equal(plan1.routers.add.length, 6, 'first plan adds 6 routers');
    equal(plan1.routers.update.length, 0, 'first plan has 0 updates');
    equal(plan1.routers.unchanged.length, 0, 'first plan has 0 unchanged');

    const result1 = applyDeploy(plan1, projectDir, mirrorRoot, { quiet: true });
    equal(result1.added, 6, 'first deploy adds 6');
    equal(result1.errors.length, 0, 'first deploy has no errors');

    // Verify routers exist after first deploy
    for (const name of routers) {
      ok(existsSync(join(mirrorRoot, name, 'SKILL.md')), `router ${name} exists after first deploy`);
    }

    // ── Second deploy (idempotency check) ───────────────────────────────────────
    const plan2 = planDeploy(projectDir, mirrorRoot);
    equal(plan2.routers.add.length, 0, 'second plan adds 0');
    equal(plan2.routers.update.length, 0, 'second plan updates 0');
    equal(plan2.routers.unchanged.length, 6, 'second plan has 6 unchanged');

    const result2 = applyDeploy(plan2, projectDir, mirrorRoot, { quiet: true });
    equal(result2.added, 0, 'second deploy adds 0');
    equal(result2.updated, 0, 'second deploy updates 0');
    equal(result2.unchanged, 6, 'second deploy reports 6 unchanged');
    equal(result2.errors.length, 0, 'second deploy has no errors');

    // Verify routers still exist and unchanged
    for (const name of routers) {
      ok(existsSync(join(mirrorRoot, name, 'SKILL.md')), `router ${name} still exists after second deploy`);
      const meta = JSON.parse(readFileSync(join(mirrorRoot, name, '.skill-router-meta.json'), 'utf-8'));
      ok(typeof meta.hash === 'string' && meta.hash.length === 64, `router ${name} meta still valid`);
    }
  });

  it('should clean up temp directory', () => {
    rmSync(TMP_PREFIX, { recursive: true, force: true });
    ok(!existsSync(TMP_PREFIX), 'temp directory cleaned up');
  });
});

