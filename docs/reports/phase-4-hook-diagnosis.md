# Phase 4 — Hook Diagnosis Report

**Date:** 2026-09-24
**Agent:** diagnostician
**Scope:** Plugin hook discovery, config scope, schema validity, registration gap

---

## 1. Root Cause

Plugin hooks in ZCode 3.14.1 are **not failing at the schema or discovery level** — they are failing at the **plugin enablement level**. The hook contract (`hooks/hooks.json` at the standard location, `${ZCODE_PLUGIN_ROOT}` variable expansion, `matcher: "."` regex) is correctly implemented and auto-discovered per docs. However, the `zcode-skill-router` plugin does **not appear in the `enabledPlugins` map** in `~/.zcode/cli/config.json` (read at `C:\Users\PC-1\.zcode\cli\config.json:1-32`). Since plugin hooks "follow the plugin's enable state" (per hooks docs, Configuration Sources table), a plugin that is absent from or disabled in `enabledPlugins` will not have its hooks executed, regardless of how correct `hooks/hooks.json` is. A secondary issue: workspace-scoped hooks in `<workspace>/.zcode/config.json` are **silently ignored** for security (`config_project_hooks_ignored`), so placing hook config there never works.

## 2. Config Path

**User-scope hooks:** `~/.zcode/cli/config.json` (verified: `C:\Users\PC-1\.zcode\cli\config.json` exists, `hooks.enabled: true`, line 12)
**Workspace hooks (not executed):** `<workspace>/.zcode/config.json` (verified: `C:\Users\PC-1\.zcode\workspace\default\.zcode\config.json` contains empty `events: {}`, line 2-4 — ignored per docs)

## 3. Schema Comparison

| Field | Our `hooks/hooks.json` | Working format (docs) | Status |
|---|---|---|---|
| `description` | ✅ "Skill Router hook …" | ✅ optional | OK |
| `hooks.UserPromptSubmit[]` | ✅ array of matcher-groups | ✅ required shape | OK |
| `matcher` | `"."` (JS regex, any-char) | `*` or regex allowed; UserPromptSubmit ignores matcher per docs | OK (harmless) |
| `type` | `"process"` | `"process"` | OK |
| `command` | `"node"` | `"node"` | OK |
| `args[0]` | `"${ZCODE_PLUGIN_ROOT}/hooks/route.mjs"` | `${ZCODE_PLUGIN_ROOT}` supported | OK |
| `timeoutMs` | `3500` (under 60000 root default) | `timeoutMs` overrides root | OK |
| `statusMessage` | `"Routing skills..."` | optional string | OK (installed copy stale: `"Routing skill..."`) |
| `plugin.json hooks` field | **Absent** (auto-discover) | Optional; absent = standard location | OK |

**Verdict:** Schema is valid. No structural diff from working format. The only drift is the stale installed copy's `statusMessage` (singular vs plural).

## 4. Recommended Fix — `src/cli/hook-registrar.mjs`

Implement a CLI subcommand that programmatically ensures the plugin's hook is registered in user config:

1. **Resolve config path** — read `~/.zcode/cli/config.json` via `os.homedir()`.
2. **Check plugin enablement** — verify `hooks.enabled === true` and that `zcode-skill-router` appears in `enabledPlugins` with value `true`. If absent or false, add/enable it.
3. **Validate hook entry** — confirm `hooks.events.UserPromptSubmit` contains a hook group whose `hooks[0].args[0]` resolves `${ZCODE_PLUGIN_ROOT}/hooks/route.mjs`. If missing, inject it using the schema from §3.
4. **Write back atomically** — read → mutate → rewrite with formatted JSON; wrap in try/catch (fail-silent, exit 0 on error per `hooks/route.mjs:282-285` pattern).
5. **Report** — print `[hook-registrar] registered` or `[hook-registrar] already up-to-date` to stdout.
6. **Integration** — wire into `bin/skill-router.mjs` as a new subcommand; add to `src/cli/help.mjs`.

This mirrors the existing deploy subsystem pattern (`src/deploy/writer.mjs:125` apply + `src/cli/verify.mjs:312` health-check).

## 5. Evidence — Files Inspected

| File | Key Finding |
|---|---|
| `C:\Users\PC-1\.zcode\cli\config.json` (read) | `hooks.enabled: true`; `zcode-skill-router` **absent** from `enabledPlugins`; one disabled test-hook entry at line 17 |
| `C:\Users\PC-1\.zcode\workspace\default\.zcode\config.json` (read) | Empty `events: {}` — workspace hooks ignored per docs |
| `hooks/hooks.json` (read, project) | Valid schema; `matcher: "."`, `timeoutMs: 3500`, `statusMessage: "Routing skills..."` |
| `C:\Users\PC-1\.zcode\workspace\default\plugins\zcode-skill-router\hooks\hooks.json` (read) | Identical to project except `statusMessage: "Routing skill..."` (stale, singular) |
| `.zcode-plugin/plugin.json` (read, both project and installed) | Byte-identical; no `hooks` field (auto-discovery confirmed) |
| `find ... hooks.json` (ran via PowerShell) | 5 `hooks.json` files found: 2 empty official, 2 empty server, 1 active (zcode-skill-router) |
| `find ... plugin.json -exec grep '"hooks"'` (ran via PowerShell) | **0 plugins** declare `hooks` field in manifest — all rely on auto-discovery |
| `hooks/route.mjs` (read) | Fail-open pattern: exits 0 on all errors; writes `<cwd>/.zcode/output.json` at line 269-276 |
| `src/cli/verify.mjs` (read) | 5 health checks; `--zcode-dir` flag; exits 0/1 — reference pattern for registrar |
| `src/deploy/writer.mjs` (read) | Snapshot-before-write + rollback pattern (`:142-147, :197-200`) — reference for atomic config write |
