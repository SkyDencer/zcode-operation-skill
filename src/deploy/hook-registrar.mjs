/**
 * Hook Registrar - registers / unregisters the Skill Router hook in ZCode's
 * CLI config file (~/.zcode/cli/config.json).
 *
 * ZCode 3.14.1 does NOT load hooks from plugins/[REDACTED_SK_KEY]/hooks/hooks.json.
 * Only User-scope hooks in cli/config.json are executed.
 * This module manages that registration idempotently.
 *
 * The ${ZCODE_PLUGIN_ROOT} placeholder is preserved as a literal string -
 * ZCode substitutes it at runtime.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

// ── Constants ──────────────────────────────────────────────────────────────────

const CONFIG_SUBPATH = join(homedir(), '.zcode', 'cli', 'config.json');
const WORKSPACE_CONFIG_SUBPATH = join(homedir(), '.zcode', 'workspace', 'default', '.zcode', 'config.json');

const HOOK_COMMAND = 'node';
const HOOK_ARGS = ['node', '${ZCODE_PLUGIN_ROOT}/hooks/route.mjs'];
const HOOK_TIMEOUT_MS = 3500;
const HOOK_TYPE = 'process';
const HOOK_EVENT = 'UserPromptSubmit';

const BACKUP_DIR = 'logs/backups';

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Try to read a JSON config file. Returns null on any failure.
 */
function readConfigSafe(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Write a JSON config with 2-space indentation.
 * Silently fails on error; returns false on failure.
 */
function writeConfigSafe(path, data) {
  try {
    const dir = resolve(join(path, '..'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error(`[hook-registrar] write error: ${err.message}`);
    return false;
  }
}

/**
 * Create a timestamped backup path inside logs/backups/.
 */
function backupPath(configPath) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
  const ext = configPath.endsWith('.json') ? '' : '.json';
  const base = join(BACKUP_DIR, `zcode-settings-${ts}${ext}`);
  return resolve(base);
}

/**
 * Write a backup copy of the config before modifying it.
 */
function createBackup(configPath) {
  try {
    const src = readConfigSafe(configPath);
    if (src === null) return;
    const bp = backupPath(configPath);
    const dir = resolve(join(bp, '..'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(bp, JSON.stringify(src, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[hook-registrar] backup error: ${err.message}`);
  }
}

/**
 * Check whether the hook args match our signature.
 */
function matchesHook(args) {
  if (!Array.isArray(args)) return false;
  return args.length === 2 && args[0] === HOOK_ARGS[0] && args[1] === HOOK_ARGS[1];
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Register the Skill Router hook in ZCode's CLI config.
 * Idempotent: running twice produces zero changes.
 * Preserves any existing hooks.
 *
 * @param {string} zcodeConfigPath - absolute path to cli/config.json
 * @param {object} [opts]
 * @param {string} [opts.pluginRoot] - absolute path to plugin root (defaults to CWD/../)
 * @returns {{ changed: boolean, path: string, backupPath: string | null }}
 */
export function registerHook(zcodeConfigPath, opts = {}) {
  const configPath = resolve(zcodeConfigPath);
  let config = readConfigSafe(configPath);

  if (config === null) {
    // Config doesn't exist yet - start fresh
    config = {};
  }

  // Ensure hooks structure exists
  if (!config.hooks) config.hooks = { enabled: true, events: {} };
  if (!config.hooks.events) config.hooks.events = {};
  if (!Array.isArray(config.hooks.events[HOOK_EVENT])) {
    config.hooks.events[HOOK_EVENT] = [];
  }

  // Check if our hook is already present
  const eventHooks = config.hooks.events[HOOK_EVENT];
  for (const group of eventHooks) {
    if (Array.isArray(group.hooks)) {
      for (const hook of group.hooks) {
        if (matchesHook(hook.args)) {
          // Already registered - nothing to do
          return { changed: false, path: configPath, backupPath: null };
        }
      }
    }
  }

  // Append our hook
  createBackup(configPath);
  eventHooks.push({
    hooks: [
      {
        type: HOOK_TYPE,
        command: HOOK_COMMAND,
        args: [...HOOK_ARGS],
        timeoutMs: HOOK_TIMEOUT_MS,
        enabled: true,
      },
    ],
  });

  const ok = writeConfigSafe(configPath, config);
  return { changed: ok, path: configPath, backupPath: ok ? backupPath(configPath) : null };
}

/**
 * Unregister the Skill Router hook from ZCode's CLI config.
 * Removes only our hook entry; preserves all other hooks.
 *
 * @param {string} zcodeConfigPath
 * @returns {{ changed: boolean, path: string }}
 */
export function unregisterHook(zcodeConfigPath) {
  const configPath = resolve(zcodeConfigPath);
  const config = readConfigSafe(configPath);
  if (config === null) return { changed: false, path: configPath };

  const eventHooks = config.hooks?.events?.[HOOK_EVENT];
  if (!Array.isArray(eventHooks)) return { changed: false, path: configPath };

  let removed = false;
  for (const group of eventHooks) {
    if (!Array.isArray(group.hooks)) continue;
    const before = group.hooks.length;
    group.hooks = group.hooks.filter((h) => !matchesHook(h.args));
    if (group.hooks.length === 0) {
      // Remove empty groups
      const idx = eventHooks.indexOf(group);
      if (idx !== -1) eventHooks.splice(idx, 1);
    }
    if (group.hooks.length < before) removed = true;
  }

  if (!removed) return { changed: false, path: configPath };

  createBackup(configPath);
  const ok = writeConfigSafe(configPath, config);
  return { changed: ok, path: configPath };
}

/**
 * Check if the hook is already registered in the given config.
 *
 * @param {string} zcodeConfigPath
 * @returns {boolean}
 */
export function isHookRegistered(zcodeConfigPath) {
  const configPath = resolve(zcodeConfigPath);
  const config = readConfigSafe(configPath);
  if (config === null) return false;

  const eventHooks = config.hooks?.events?.[HOOK_EVENT];
  if (!Array.isArray(eventHooks)) return false;

  for (const group of eventHooks) {
    if (!Array.isArray(group.hooks)) continue;
    for (const hook of group.hooks) {
      if (matchesHook(hook.args)) return true;
    }
  }
  return false;
}

/**
 * Detect the ZCode CLI config path.
 * Tries known locations in order.
 *
 * @param {string} [zcodeRoot] - base ZCode directory
 * @returns {string | null}
 */
export function detectHookConfigPath(zcodeRoot) {
  const candidates = [];
  if (zcodeRoot) {
    candidates.push(join(zcodeRoot, 'cli', 'config.json'));
  }
  candidates.push(CONFIG_SUBPATH);
  candidates.push(WORKSPACE_CONFIG_SUBPATH);

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return resolve(candidate);
    } catch {
      // skip
    }
  }
  return null;
}
