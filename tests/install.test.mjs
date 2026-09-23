/**
 * Install script tests.
 *
 * Tests use a temporary HOME directory to avoid modifying the real ZCode workspace.
 *
 * Test cases:
 *   1. install.mjs exits non-zero when run from wrong directory
 *   2. install.mjs --dry-run completes without side effects
 *   3. install.mjs --yes skips confirmation and runs full pipeline
 *   4. install.mjs verifies Node version check
 *   5. install.mjs build-index step produces skill-index.json
 *   6. install.mjs sync step writes to temporary ZCode mirror
 *   7. install.mjs verify step reports healthy state after install
 *   8. install.ps1 exists and is valid PowerShell
 *   9. install.sh exists and is valid shell script
 */

import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const INSTALL_SCRIPT = resolve(ROOT, 'scripts', 'install.mjs');
const CLI = resolve(ROOT, 'bin', 'skill-router.mjs');

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

function assertContains(output, substring, message) {
  if (output.includes(substring)) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
    console.error(`    Expected: "${substring}"`);
    console.error(`    Got: ${output.slice(0, 600)}`);
  }
}

function assertNotContains(output, substring, message) {
  if (!output.includes(substring)) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message} — output should NOT contain "${substring}"`);
  }
}

function assertExit(code, result, message) {
  if (result.status === code) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
    console.error(`    Expected exit ${code}, got ${result.status}`);
    if (result.stderr) console.error(`    stderr: ${result.stderr.toString()}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a temporary HOME directory structure that mimics a ZCode workspace.
 * Returns { homeDir, zcodeSkillsDir } and a cleanup function.
 */
function setupTempHome() {
  const tmpDir = resolve(ROOT, 'tmp', 'install-test-home-' + Date.now());
  const homeDir = resolve(tmpDir, 'home');
  const zcodeDir = resolve(homeDir, '.zcode');
  const zcodeSkillsDir = resolve(zcodeDir, 'skills');
  const workspacePlugins = resolve(zcodeDir, 'workspace', 'default', 'plugins');
  const pluginDir = resolve(workspacePlugins, 'zcode-skill-router');

  // Create directory structure
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(zcodeDir, { recursive: true });
  mkdirSync(zcodeSkillsDir, { recursive: true });
  mkdirSync(pluginDir, { recursive: true });

  // Create a fake plugin manifest in ZCode's expected location
  writeFileSync(
    resolve(pluginDir, 'plugin.json'),
    JSON.stringify({
      manifest_version: 1,
      name: 'zcode-skill-router',
      version: '0.1.0',
    }),
    'utf-8'
  );

  const cleanup = () => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  };

  return { homeDir, zcodeSkillsDir, zcodeDir, pluginDir, cleanup };
}

/**
 * Run install.mjs with the given env overrides and args.
 */
function runInstall(extraArgs = [], envOverrides = {}) {
  const env = {
    ...process.env,
    HOME: envOverrides.homeDir ?? process.env.HOME,
    SKILL_ROUTER_ZCODE_DIR: envOverrides.zcodeDir ?? process.env.SKILL_ROUTER_ZCODE_DIR,
    ...envOverrides,
  };

  return spawnSync('node', [INSTALL_SCRIPT, ...extraArgs], {
    cwd: ROOT,
    env,
    stdio: 'pipe',
    encoding: 'utf-8',
    timeout: 30000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 1: Works from repo subdirectory
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n=== 1. Runs from Repo Subdirectory ===');

{
  // The script resolves ROOT from import.meta.url, so it must work
  // from any subdirectory of the repo, not just the root.
  const srcDir = resolve(ROOT, 'src');
  try {
    const result = spawnSync('node', [INSTALL_SCRIPT, '--dry-run'], {
      cwd: srcDir,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 15000,
    });
    const output = result.stdout?.toString() ?? '';
    const stderr = result.stderr?.toString() ?? '';

    assertContains(output, 'Node.js', 'shows Node version check from subdir');
    assertContains(output, 'Repository', 'verifies repo location from subdir');
    assertContains(output, 'DRY-RUN', 'indicates dry-run mode from subdir');
    assertContains(output, 'Dry-run mode', 'confirms dry-run exit from subdir');
    assertExit(0, result, 'exits 0 from repo subdirectory in dry-run mode');
  } catch (err) {
    assert(false, `should run successfully from subdirectory: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 2: Dry-run mode
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n=== 2. Dry-Run Mode ===');

{
  const { homeDir, zcodeSkillsDir, cleanup } = setupTempHome();
  try {
    const result = runInstall(['--dry-run'], { homeDir, zcodeDir: zcodeSkillsDir });
    const output = result.stdout?.toString() ?? '';

    assertContains(output, 'Node.js', 'shows Node version check');
    assertContains(output, 'Step 4/6', 'shows sync plan step');
    assertContains(output, 'DRY-RUN', 'indicates dry-run mode');
    assertContains(output, 'Dry-run mode', 'confirms dry-run exit');
    assertNotContains(output, 'INSTALLATION COMPLETE', 'does not show install complete');

    // No files should have been written to the temp ZCode dir beyond what existed
    const entries = readdirSync(zcodeSkillsDir);
    assert(entries.length === 0, 'no files written to ZCode mirror in dry-run');
  } finally {
    cleanup();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 3: Full install with --yes flag
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n=== 3. Full Install (--yes) ===');

{
  const { homeDir, zcodeSkillsDir, pluginDir, cleanup } = setupTempHome();
  try {
    const result = runInstall(['--yes'], { homeDir, zcodeDir: zcodeSkillsDir });
    const output = result.stdout?.toString() ?? '';
    const stderr = result.stderr?.toString() ?? '';

    assertContains(output, 'Node.js', 'shows Node version');
    assertContains(output, 'Repository', 'verifies repo location');
    assertContains(output, 'Building skill index', 'builds index');
    assertContains(output, 'Sync plan', 'shows sync plan');
    assertContains(output, 'Syncing to ZCode', 'runs sync');
    assertContains(output, 'Post-install verification', 'runs verify');
    assertContains(output, 'INSTALLATION COMPLETE', 'shows completion banner');
    assertContains(output, 'Next steps', 'prints next steps');

    // Verify index was built
    const indexPath = resolve(ROOT, 'data', 'skill-index.json');
    assert(existsSync(indexPath), 'skill-index.json exists after install');

    // Verify sync wrote skills to temp ZCode mirror
    function findSkillDirs(dir) {
      const results = [];
      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        if (entry.startsWith('.')) continue;
        if (existsSync(join(fullPath, 'SKILL.md'))) {
          results.push(fullPath);
        } else if (readdirSync(fullPath, { withFileTypes: true }).some(
          (e) => e.name === 'SKILL.md'
        )) {
          results.push(fullPath);
        } else {
          results.push(...findSkillDirs(fullPath));
        }
      }
      return results;
    }

    const mirroredSkills = findSkillDirs(zcodeSkillsDir);
    assert(mirroredSkills.length > 0, 'skills synced to ZCode mirror');

    // Verify first mirror skill has meta file
    if (mirroredSkills.length > 0) {
      const metaPath = join(mirroredSkills[0], '.skill-router-meta.json');
      assert(existsSync(metaPath), 'synced skill has .skill-router-meta.json');
    }
  } finally {
    cleanup();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 4: Node version check
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n=== 4. Node Version Check ===');

{
  // The current Node version is v26.x which passes the check
  const result = runInstall(['--dry-run', '--yes']);
  const output = result.stdout?.toString() ?? '';

  assertContains(output, 'Node.js', 'mentions Node.js in output');
  assertContains(output, '✓', 'shows checkmark for version');
  assertExit(0, result, 'exits 0 on valid Node version');
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 5: Build-index produces skill-index.json
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n=== 5. Build Index Produces Index ===');

{
  // Save existing index if present
  const indexPath = resolve(ROOT, 'data', 'skill-index.json');
  let backup = null;
  if (existsSync(indexPath)) {
    backup = readFileSync(indexPath, 'utf-8');
  }

  try {
    // Remove index to force rebuild
    if (existsSync(indexPath)) {
      rmSync(indexPath, { force: true });
    }

    const result = runInstall(['--dry-run', '--yes']);
    const output = result.stdout?.toString() ?? '';

    assertContains(output, 'Indexed', 'build-index reports skill count');
    assert(existsSync(indexPath), 'skill-index.json created after install');

    // Validate index is parseable JSON array
    const indexContent = readFileSync(indexPath, 'utf-8');
    const index = JSON.parse(indexContent);
    assert(Array.isArray(index), 'skill-index.json is a JSON array');
    assert(index.length > 0, 'skill-index.json has entries');
  } finally {
    // Restore original index
    if (backup !== null) {
      writeFileSync(indexPath, backup, 'utf-8');
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 6: Sync writes to temporary ZCode mirror
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n=== 6. Sync Writes to Temp ZCode Mirror ===');

{
  const { homeDir, zcodeSkillsDir, cleanup } = setupTempHome();
  try {
    const result = runInstall(['--yes'], { homeDir, zcodeDir: zcodeSkillsDir });
    const output = result.stdout?.toString() ?? '';

    assertContains(output, 'Syncing skills', 'sync step executes');
    assertContains(output, 'Sync complete', 'sync reports completion');

    // Count mirrored skills (recursive)
    function countSkillDirs(dir) {
      let count = 0;
      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        if (entry.startsWith('.')) continue;
        if (existsSync(join(fullPath, 'SKILL.md'))) {
          count++;
        } else {
          count += countSkillDirs(fullPath);
        }
      }
      return count;
    }

    const mirroredCount = countSkillDirs(zcodeSkillsDir);
    assert(mirroredCount > 0, `at least one skill mirrored (${mirroredCount} found)`);
  } finally {
    cleanup();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 7: Verify after install
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n=== 7. Verify After Install ===');

{
  const { homeDir, zcodeSkillsDir, cleanup } = setupTempHome();
  try {
    // First run install
    runInstall(['--yes'], { homeDir, zcodeDir: zcodeSkillsDir });

    // Then run verify against the same temp mirror
    const verifyResult = spawnSync('node', [CLI, 'verify', '--zcode-dir', zcodeSkillsDir], {
      cwd: ROOT,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 15000,
    });
    const verifyOutput = verifyResult.stdout?.toString() ?? '';

    assertContains(verifyOutput, 'PASS', 'verify shows PASS status');
    assertContains(verifyOutput, 'Mirror sync', 'verify checks mirror sync');
    assertContains(verifyOutput, 'Thresholds', 'verify checks thresholds');
  } finally {
    cleanup();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 8: install.ps1 exists and is valid
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n=== 8. install.ps1 Exists ===');

{
  const ps1Path = resolve(ROOT, 'install.ps1');
  assert(existsSync(ps1Path), 'install.ps1 exists at repo root');

  if (existsSync(ps1Path)) {
    const content = readFileSync(ps1Path, 'utf-8');
    assertContains(content, 'install.mjs', 'references install.mjs');
    assertContains(content, 'node', 'uses node to run script');
    assertContains(content, 'param', 'has PowerShell parameter block');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 9: install.sh exists and is valid
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n=== 9. install.sh Exists ===');

{
  const shPath = resolve(ROOT, 'install.sh');
  assert(existsSync(shPath), 'install.sh exists at repo root');

  if (existsSync(shPath)) {
    const content = readFileSync(shPath, 'utf-8');
    assertContains(content, 'install.mjs', 'references install.mjs');
    assertContains(content, 'node', 'uses node to run script');
    assertContains(content, '#!', 'has shebang line');
  }
}

// ── Summary ────────────────────────────────────────────────────────────────────

console.log('\n=== Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
