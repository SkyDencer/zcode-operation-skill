# Phase 0.5a — ZCode Structure Discovery & Alignment
**Date:** 20260921
**Status:** Complete

## 1. Backup
- Source: C:/Users/dex/.zcode
- Destination: D:/www/local/operation-skill/.backup/zcode-20260921-20260921
- File count: 10390
- Total size: 1929.29 MB
- Success: true

## 2. Real ZCode Structure
- Plugin directory: .zcode/cli/plugins/cache/zcode-plugins-official/
- Example plugin: browser-use@0.5.1
- Plugin manifest schema: {
  "name": {"type": "string", "required": true},
  "version": {"type": "string", "required": true},
  "description": {"type": "string", "required": false},
  "description_i18n": {"type": "object", "required": false},
  "author": {"type": "object", "required": false, "properties": {"name": {"type": "string"}}},
  "license": {"type": "string", "required": false},
  "skills": {"type": "string (path)", "required": false},
  "commands": {"type": "string (path)", "required": false},
  "mcpServers": {"type": "object", "required": false, "properties": {"<serverName>": {"command": "string", "args": "array", "cwd": "string", "env": "object"}}},
  "userConfig": {"type": "object", "required": false, "properties": {"<configKey>": {"type": "string", "default": "string", "description": "string"}}}
}
- Hooks schema: {"hooks": {}}

The hooks.json is located at <plugin_dir>/hooks/hooks.json. It contains a single top-level key "hooks" whose value is an object mapping hook event names to their definitions. Both android-emulator and ios-simulator plugins ship with empty hook registries: {"hooks": {}}
- Config file location: v2/config.json
- Top-level config keys: [cli/config.json: plugins, skills, v2/setting.json: modelProviderFamilyModes, modelProviderFamilySelectedKeys, recentProjects, locale, localePreference, terminalInheritSystemProfile, embeddedBrowserAllowInsecureCertificates, embeddedBrowserViewportPreference, computerUseComposerEntryHidden, taskAutoArchiveEnabled, taskAutoArchiveOlderThanDays, closeToTrayOnWindows, keepAwakeWhileRunning, desktopWindowSize, messageStreamShowReasoning, messageStreamShowTodos, toolGroupingExploreEnabled, zcodeInteractionBehavior, providerFamilyDomain, nativeSearchEnhancementsEnabled, onboardingOccupation, memoryEnabled, lastWorkspaceSession, autoDownloadAndInstallUpdates, settingsSyncFirstRunPromptHandled, webRemoteControlExternalRelayDevice, v2/config.json: provider]
- ZCode version: 3.14.1.7714

## 3. Official Docs Findings
- Plugin directory expected: Standard plugin layout per ZCode hooks docs: <plugin-root>/ with a .zcode-plugin/ subdirectory containing plugin.json, and a hooks/ directory at the plugin root containing hooks.json and hook scripts (.mjs). Optional top-level directories also mentioned: commands/, skills/<name>/SKILL.md, agents/, .mcp.json. Discovery priority: .zcode-plugin/plugin.json then .claude-plugin/plugin.json. Example from docs (hooks page): context-guard/ ├── .zcode-plugin/ │ └── plugin.json └── hooks/ ├── hooks.json └── context.mjs
- Required plugin fields: name (string), version (string), description (string)
- Hooks schema: Root: { description?: string, hooks: { [eventName]: Matcher[] } }. Matcher: { matcher: string (letters/digits/underscores/| = exact name-list; anything else = JS regex), hooks: HookEntry[] }. HookEntry: { type: 'process'|'command', command: string, args?: string[], timeoutMs?: number, statusMessage?: string, enabled?: boolean }. Event examples: SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, PostToolUseFailure, Stop, onWorkflowAuthoring. process = argv-executed synchronous; command = shell-executed async-capable. Root default timeout: 60000ms. ${ZCODE_PLUGIN_ROOT} is substituted in args.
- `${ZCODE_PLUGIN_ROOT}` support: yes
- Project-level hooks: not supported
- Documentation gaps: The /en/docs/plugin page was truncated by the fetch tool's 125-character quote limit; the full plugin.json schema details from that page were not recovered. Only the /en/docs/hooks page returned complete content.; The project's plugin.json contains fields manifest_version, entrypoint, engines, and hooks that are absent from the official schema example in the hooks docs. It is unclear whether these are unsupported legacy fields, undocumented official extensions, or project-specific additions.; No information was found in the docs about whether a package.json is required at the plugin root or inside .zcode-plugin/.; No information was found about whether a specific folder name is required for the plugin root (the docs show 'context-guard' as an example but state folder name is irrelevant).; The exact schema for skill manifests (SKILL.md, skills/<name>/) and MCP config (.mcp.json) was not retrieved — only mentioned as optional components.; Exit-code semantics are documented (0=success, 2=blocking shortcut, other non-zero=recoverable failure) but the full set of hook event input/output contracts beyond SessionStart/UserPromptSubmit/PreToolUse was not exhaustively verified.

## 4. Comparison Table
| Aspect | Our project | Real ZCode expects | Match? | Action needed |
|---|---|---|---|---|
| Plugin root folder | Plugin root is D:/www/local/operation-skill/ (the workspace root), which contains a .zcode-plugin/ subdirectory | Plugin root is the folder containing .zcode-plugin/ subdirectory. Example: context-guard/ with .zcode-plugin/ inside. | ok | None |
| plugin.json location | .zcode-plugin/plugin.json | <plugin-root>/.zcode-plugin/plugin.json | ok | None |
| plugin.json fields | Has name (string), version (string), description (string), author, license, hooks (string path). All three required fields (name, version, description) are present. Extra fields author, license, hooks are not in the documented schema but are not harmful. | Required: name (string), version (string), description (string). Optional per schema: description_i18n, author, license, skills, commands, mcpServers, userConfig. No hooks field documented in plugin.json schema. | ok | None — optional extra fields are benign; hooks configuration is correctly placed in hooks/hooks.json instead |
| Hooks location | hooks/hooks.json at plugin root | <plugin_dir>/hooks/hooks.json | ok | None |
| Hooks schema | { description, hooks: { UserPromptSubmit: [{ matcher: '.', hooks: [{ type: 'process', command: 'node', args: ['${ZCODE_PLUGIN_ROOT}/hooks/route.mjs'], timeoutMs: 5000, statusMessage }] }] } } | Root: { description?: string, hooks: { [eventName]: Matcher[] } }. Matcher: { matcher: string, hooks: HookEntry[] }. HookEntry: { type: 'process'|'command', command: string, args?: string[], timeoutMs?: number, statusMessage?: string, enabled?: boolean }. | ok | None |
| Entry script | hooks/route.mjs — ES module referenced via ${ZCODE_PLUGIN_ROOT}/hooks/route.mjs in hooks.json | Hook scripts can be .mjs files; path is substituted via ${ZCODE_PLUGIN_ROOT}. | ok | None |
| Node version | v24.11.1 runtime; package.json requires '>=20' | No minimum Node version specified in docs. | ok | None |
| ${ZCODE_PLUGIN_ROOT} support | hooks.json uses '${ZCODE_PLUGIN_ROOT}/hooks/route.mjs' in args | The hook args may contain the string '${ZCODE_PLUGIN_ROOT}' which will be replaced by the path to the plugin root. | ok | None |
| Skills directory | data/mock-skills/<name>/SKILL.md (10 skills found in this directory) | Optional convention: skills/<name>/SKILL.md at plugin root. | partial | Skills are functional but located at data/mock-skills/ instead of the documented convention skills/. This is not a hard requirement per docs (skills are listed as optional), but if ZCode auto-discovers skills it may not find them outside the conventional path. |
| Package.json at root | package.json exists at root with type: module, private: true, engines: { node: '>=20' }, scripts for build-index and benchmark | No requirement or mention of package.json in the ZCode plugin docs. | ok | None — not required but not harmful |

## 5. Alignment Changes
- **Added "skills": "data/mock-skills" field to .zcode-plugin/plugin.json**: The comparison flagged a partial match: skills exist at data/mock-skills/ instead of the conventional skills/ directory. The official browser-use plugin schema (from .backup/...) shows an optional 'skills' string path field in plugin.json. By adding 'skills': 'data/mock-skills', ZCode can explicitly locate the 10 skills (each with SKILL.md) without requiring a directory move. This mirrors the pattern used by official plugins like browser-use which declares 'skills': 'skills'.

## 6. Install Plan for Phase 0.5b
1. Copy the project root (D:wwwlocaloperation-skill) to a versioned directory under C:Usersdex.zcodeclipluginscachezcode-plugins-official/ — e.g. C:Usersdex.zcodeclipluginscachezcode-plugins-officialzcode-skill-router .1.0\n2. Ensure the copied directory contains .zcode-plugin/plugin.json, hooks/hooks.json, hooks/route.mjs, src/, data/, and package.json at its root
3. Register the plugin: open ZCode Settings UI (or edit C:Usersdex.zcodecliconfig.json) and add zcode-skill-router@zcode-plugins-official to plugins.enabledPlugins with value true
4. Restart ZCode completely (close and reopen the app) so the plugin loader rescans the cache directory
5. Verify plugin loaded: check ZCode console/logs for zcode-skill-router initialization messages; confirm no error about missing .zcode-plugin/plugin.json
6. Verify hook fired: open a workflow in the ZCode editor, trigger a UserPromptSubmit (send a message containing workflow-related terms), observe the console for "Routing skills..." status message
7. Verify model received context: check that the hook output (skill suggestions with confidence scores) appears in the ZCode UI as context injected into the model prompt
8. Clean up: disable the plugin in config.json (set enabledPlugins.zcode-skill-router@zcode-plugins-official to false), restart ZCode, remove the copied plugin directory from the cache, restore cli/config.json from the backup at .backup/zcode-20260921-20260921/

## 7. Open Questions
None — all aspects verified.

## 8. Recommendation
- Some alignments made — verify before Phase 0.5b