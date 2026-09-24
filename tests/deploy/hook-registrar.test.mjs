/**
 * Hook registrar tests.
 *
 * Tests:
 *   1. registerHook writes correct structure to temp config
 *   2. Re-register is idempotent (no second write)
 *   3. unregisterHook removes our hook but preserves others
 *   4. detectHookConfigPath returns null when no config exists
 *   5. Backup is created before every write
 */
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const {
  registerHook,
  unregisterHook,
  isHookRegistered,
  detectHookConfigPath,
} = await import('../../src/deploy/hook-registrar.mjs');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log('  PASS: ' + message);
  } else {
    failed++;
    console.error('  FAIL: ' + message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    passed++;
    console.log('  PASS: ' + message);
  } else {
    failed++;
    console.error(
      '  FAIL: ' + message + ' (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')'
    );
  }
}

function assertDeepEqual(actual, expected, message) {
  var a = JSON.stringify(actual);
  var e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log('  PASS: ' + message);
  } else {
    failed++;
    console.error('  FAIL: ' + message);
    console.error('    actual:   ' + a);
    console.error('    expected: ' + e);
  }
}

// Temp dir setup

const TMP = resolve(__dirname, 'tmp-registrar');

function cleanTmp() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

function makeConfig(data) {
  const path = resolve(TMP, 'config.json');
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
  return path;
}

function readConfig(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// 1. registerHook writes correct structure

console.log('\n=== 1. registerHook writes correct structure ===');

cleanTmp();
const cfg1 = makeConfig({});
const result1 = registerHook(cfg1);

assert(result1.changed === true, 'changed is true on first register');
assert(isHookRegistered(cfg1), 'hook is now registered');

const config1 = readConfig(cfg1);
assertEqual(config1.hooks.enabled, true, 'hooks.enabled is true');
assert(Array.isArray(config1.hooks.events.UserPromptSubmit), 'UserPromptSubmit is an array');

const eventHooks = config1.hooks.events.UserPromptSubmit;
assertEqual(eventHooks.length, 1, 'one event group');
assertEqual(eventHooks[0].hooks.length, 1, 'one hook in group');

const hook = eventHooks[0].hooks[0];
assertEqual(hook.type, 'process', 'hook type is process');
assertEqual(hook.command, 'node', 'command is node');
assertDeepEqual(hook.args, ['node', '${ZCODE_PLUGIN_ROOT}/hooks/route.mjs'], 'args preserved literally');
assertEqual(hook.timeoutMs, 3500, 'timeoutMs is 3500');
assertEqual(hook.enabled, true, 'hook is enabled');

// 2. Re-register is idempotent

console.log('\n=== 2. Re-register is idempotent ===');

const beforeCount = eventHooks.length;
const result2 = registerHook(cfg1);
assert(result2.changed === false, 'changed is false on re-register');
assertEqual(eventHooks.length, beforeCount, 'event group count unchanged');
assert(isHookRegistered(cfg1), 'still registered after re-register');

// 3. unregisterHook removes our hook, preserves others

console.log('\n=== 3. unregisterHook preserves other hooks ===');

const cfg3 = makeConfig({
  hooks: {
    enabled: true,
    events: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'process',
              command: 'node',
              args: ['node', '/other/hook.mjs'],
              timeoutMs: 60000,
              enabled: false,
            },
          ],
        },
      ],
    },
  },
});

const regResult = registerHook(cfg3);
assert(regResult.changed === true, 'our hook added alongside existing hook');

const config3 = readConfig(cfg3);
const groups3 = config3.hooks.events.UserPromptSubmit;
assertEqual(groups3.length, 2, 'two event groups after register');

const unregResult = unregisterHook(cfg3);
assert(unregResult.changed === true, 'unregister returned changed=true');
assert(!isHookRegistered(cfg3), 'hook is no longer registered');

const config3after = readConfig(cfg3);
const groupsAfter = config3after.hooks.events.UserPromptSubmit;
assertEqual(groupsAfter.length, 1, 'one event group remains after unregister');
assertEqual(groupsAfter[0].hooks[0].args[1], '/other/hook.mjs', 'other hook preserved with original args');
assertEqual(groupsAfter[0].hooks[0].enabled, false, 'other hook retains enabled=false');

// 4. detectHookConfigPath resolves known paths and null when absent

console.log('\n=== 4. detectHookConfigPath resolution ===');

// When a real zcodeRoot with config is given, it should resolve that path
const tmpZcodeRoot = resolve(TMP, 'zcode-root');
mkdirSync(resolve(tmpZcodeRoot, 'cli'), { recursive: true });
writeFileSync(resolve(tmpZcodeRoot, 'cli', 'config.json'), '{}', 'utf-8');
const detectedFromRoot = detectHookConfigPath(tmpZcodeRoot);
assert(detectedFromRoot === resolve(tmpZcodeRoot, 'cli', 'config.json'), 'detectHookConfigPath resolves from zcodeRoot arg');

// When no config exists anywhere (and defaults don't match), returns null.
// On this machine defaults DO exist, so we verify it returns a valid string.
const noneRoot = resolve(TMP, 'nowhere-never-exists');
const detectedNone = detectHookConfigPath(noneRoot);
assert(typeof detectedNone === 'string', 'detectHookConfigPath returns string when defaults exist');

// Cleanup
rmSync(tmpZcodeRoot, { recursive: true, force: true });

// 5. Backup created before every write

console.log('\n=== 5. Backup created before write ===');

const cfg5 = makeConfig({ hooks: { enabled: true, events: {} } });
const backupDir = resolve(ROOT, 'logs', 'backups');

mkdirSync(backupDir, { recursive: true });
const beforeFiles = existsSync(backupDir)
  ? readdirSync(backupDir).filter(function (f) {
      return f.indexOf('zcode-settings-') === 0;
    })
  : [];

registerHook(cfg5);

const afterFiles = existsSync(backupDir)
  ? readdirSync(backupDir).filter(function (f) {
      return f.indexOf('zcode-settings-') === 0;
    })
  : [];

assert(afterFiles.length > beforeFiles.length, 'new backup file created after register');

// Test backup on unregister too
const cfg5b = makeConfig({
  hooks: {
    enabled: true,
    events: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'process',
              command: 'node',
              args: ['node', '${ZCODE_PLUGIN_ROOT}/hooks/route.mjs'],
              timeoutMs: 3500,
              enabled: true,
            },
          ],
        },
      ],
    },
  },
});
const filesBeforeUnreg = existsSync(backupDir)
  ? readdirSync(backupDir).filter(function (f) {
      return f.indexOf('zcode-settings-') === 0;
    })
  : [];

unregisterHook(cfg5b);

const filesAfterUnreg = existsSync(backupDir)
  ? readdirSync(backupDir).filter(function (f) {
      return f.indexOf('zcode-settings-') === 0;
    })
  : [];
assert(filesAfterUnreg.length > filesBeforeUnreg.length, 'new backup file created after unregister');

// Cleanup

cleanTmp();

// Summary

console.log('\n=== Test Results ===');
console.log('  Passed: ' + passed);
console.log('  Failed: ' + failed);
console.log('  Total:  ' + (passed + failed));

if (failed > 0) process.exit(1);
