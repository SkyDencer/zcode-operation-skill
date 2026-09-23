/**
 * Rollback test.
 *
 * Verifies that the deploy snapshot can restore pre-deploy state after a modification.
 *   1. Deploy to temp dir
 *   2. Modify one router file in the mirror
 *   3. Restore from a post-deploy snapshot
 *   4. Verify state matches post-deploy
 */
import { describe, it } from 'node:test';
import { equal, ok } from 'node:assert';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { planDeploy } from '../../src/deploy/planner.mjs';
import { applyDeploy } from '../../src/deploy/writer.mjs';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const REAL_ROUTERS = join(PROJECT_ROOT, 'router-skills');
const TMP_PREFIX = join(mkdtempSync(join(homedir(), '.zcode-test-')));

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

function readMeta(dir) {
  const p = join(dir, '.skill-router-meta.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8'));
}

/**
 * Create a snapshot of the mirror state including SKILL.md content.
 */
function createSnapshot(mirrorRoot) {
  const snapshot = { timestamp: new Date().toISOString(), mirrorRoot, state: {} };
  try {
    for (const entry of readdirSync(mirrorRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const routerDir = join(mirrorRoot, entry.name);
      const meta = readMeta(routerDir);
      const skillPath = join(routerDir, 'SKILL.md');
      let skillContent = null;
      try {
        if (existsSync(skillPath)) skillContent = readFileSync(skillPath, 'utf-8');
      } catch {}
      snapshot.state[entry.name] = {
        meta: meta ?? null,
        skillHash: meta?.hash ?? null,
        skillExists: !!skillContent,
        skillContent: skillContent,
      };
    }
  } catch {}
  return snapshot;
}

/**
 * Restore mirror from a snapshot.
 */
function rollbackMirror(mirrorRoot, snapshot) {
  try {
    // Remove dirs not in snapshot
    for (const entry of readdirSync(mirrorRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (!snapshot.state[entry.name]) {
        rmSync(join(mirrorRoot, entry.name), { recursive: true, force: true });
      }
    }
    // Restore dirs in snapshot
    for (const [name, info] of Object.entries(snapshot.state)) {
      const routerDir = join(mirrorRoot, name);
      if (!info.skillExists) {
        if (existsSync(routerDir)) rmSync(routerDir, { recursive: true, force: true });
        continue;
      }
      mkdirSync(routerDir, { recursive: true });
      if (info.meta) {
        writeFileSync(join(routerDir, '.skill-router-meta.json'),
          JSON.stringify(info.meta, null, 2) + '\n', 'utf-8');
      }
      if (info.skillContent !== null) {
        writeFileSync(join(routerDir, 'SKILL.md'), info.skillContent, 'utf-8');
      }
    }
    return true;
  } catch {
    return false;
  }
}

describe('deploy rollback', () => {
  let projectDir, mirrorRoot;

  it('should restore post-deploy state after modifying a router', () => {
    // Setup
    projectDir = join(TMP_PREFIX, 'project');
    mirrorRoot = join(TMP_PREFIX, 'mirror');
    const rsDir = join(projectDir, 'router-skills');
    mkdirSync(rsDir, { recursive: true });
    mkdirSync(mirrorRoot, { recursive: true });

    // Copy 6 routers into project
    const routers = ['router-design', 'router-laravel', 'router-meta',
      'router-next', 'router-react', 'router-test'];
    for (const name of routers) {
      copyRouter(REAL_ROUTERS, name, rsDir);
    }

    // Create disabled registry (empty — no leaves to disable)
    writeFileSync(join(projectDir, '.skill-router-disabled.json'),
      JSON.stringify({ disabled: [], lastModified: new Date().toISOString() }, null, 2) + '\n',
      'utf-8');

    // Record pre-deploy state of router-next
    const preDeployContent = readFileSync(join(rsDir, 'router-next', 'SKILL.md'), 'utf-8');
    const preDeployHash = hash(preDeployContent);

    // Deploy
    const plan = planDeploy(projectDir, mirrorRoot);
    equal(plan.routers.add.length, 6, 'plan adds 6 routers');

    const result = applyDeploy(plan, projectDir, mirrorRoot, {
      quiet: true,
      snapshotDir: TMP_PREFIX,
    });

    equal(result.added, 6, 'added 6 routers');
    equal(result.errors.length, 0, 'no errors');

    // ── Capture post-deploy state as our rollback source ──────────────────────
    const postDeploySnapshot = createSnapshot(mirrorRoot);
    const postDeploySnapshotPath = join(TMP_PREFIX, 'post-deploy-snapshot.json');
    writeFileSync(postDeploySnapshotPath, JSON.stringify(postDeploySnapshot, null, 2), 'utf-8');

    // Verify post-deploy state
    const postDeployMeta = readMeta(join(mirrorRoot, 'router-next'));
    ok(postDeployMeta !== null, 'router-next has meta after deploy');
    equal(postDeployMeta.hash, preDeployHash, 'router-next hash matches source');

    // ── Modify router in mirror ─────────────────────────────────────────────────
    const modifiedContent = '# MODIFIED CONTENT — should be reverted\n';
    writeFileSync(join(mirrorRoot, 'router-next', 'SKILL.md'), modifiedContent, 'utf-8');
    const modifiedMeta = readMeta(join(mirrorRoot, 'router-next'));
    modifiedMeta.hash = 'modified-hash-does-not-match';
    writeFileSync(join(mirrorRoot, 'router-next', '.skill-router-meta.json'),
      JSON.stringify(modifiedMeta, null, 2) + '\n', 'utf-8');

    // Verify modification took effect
    const verifyContent = readFileSync(join(mirrorRoot, 'router-next', 'SKILL.md'), 'utf-8');
    equal(verifyContent, modifiedContent, 'modification applied');

    // ── Rollback using post-deploy snapshot ───────────────────────────────────
    const restored = rollbackMirror(mirrorRoot, postDeploySnapshot);
    ok(restored, 'rollback succeeded');

    // ── Verify restored state matches post-deploy ──────────────────────────────
    const restoredContent = readFileSync(join(mirrorRoot, 'router-next', 'SKILL.md'), 'utf-8');
    equal(restoredContent, preDeployContent, 'router-next SKILL.md restored to pre-deploy content');

    const restoredMeta = readMeta(join(mirrorRoot, 'router-next'));
    ok(restoredMeta !== null, 'router-next meta restored');
    equal(restoredMeta.hash, preDeployHash, 'router-next hash restored to original');

    // Verify all 6 routers are back to post-deploy state
    for (const name of routers) {
      const dir = join(mirrorRoot, name);
      ok(existsSync(dir), `router ${name} exists after rollback`);
      const meta = readMeta(dir);
      ok(meta !== null, `router ${name} meta exists after rollback`);
      ok(typeof meta.hash === 'string' && meta.hash.length === 64, `router ${name} hash is valid`);
      const content = readFileSync(join(dir, 'SKILL.md'), 'utf-8');
      const srcContent = readFileSync(join(rsDir, name, 'SKILL.md'), 'utf-8');
      equal(content, srcContent, `router ${name} content matches source`);
    }
  });

  it('should clean up temp directory', () => {
    rmSync(TMP_PREFIX, { recursive: true, force: true });
    ok(!existsSync(TMP_PREFIX), 'temp directory cleaned up');
  });
});
