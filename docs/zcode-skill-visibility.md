# ZCode Skill Visibility — Research & Mechanism

> **Status:** Best-guess implementation, guarded by `--experimental-disable` semantics.
> ZCode has no documented per-skill disable API.

## Research Findings

### What was examined

| Location | What we found |
|----------|--------------|
| `~/.zcode/cli/config.json` | Plugin enable/disable state (`plugins.enabledPlugins`), **no per-skill fields** |
| `~/.zcode/v2/setting.json` | UI preferences, model settings — **no skill state** |
| `~/.zcode/skills/` | 53 skills across 5 top-level directories (`backend`, `design`, `frontend`, `meta`, `testing`). Each has `SKILL.md` + `.skill-router-meta.json`. **No `.zcode-skill-state.json` or `disabled: true` frontmatter observed.** |
| `~/.zcode/cli/plugins/cache/zcode-plugins-official/zcode-guide/*/skills/zcode-configuration-guide/SKILL.md` | Authoritative ZCode configuration guide. States: *"identity is the file path; on load the **first same-named skill wins** (user scope has priority)"*. **No mention of a disable mechanism.** |
| `~/.zcode/cli/plugins/cache/zcode-plugins-official/browser-use/*/docs/visibility.md` | Browser pane visibility guidance only — unrelated to skills |

### Conclusion

**ZCode has no built-in per-skill disable mechanism.** Skills are discovered by filesystem presence in configured scan paths. If a `SKILL.md` exists at a discovered path, the skill is loaded. There is no `disabled: true` flag, no state file per skill, and no global skill-preferences registry.

The closest analogous mechanism is **shadowing**: a same-named skill at a higher-precedence path (e.g. user `~/.zcode/skills/`) replaces one at a lower-precedence path (e.g. workspace `.zcode/skills/`). But there is no way to say "this specific skill is disabled" while keeping the file present.

## Implemented Mechanism

Since no native disable API exists, this plugin implements a **best-guess mechanism**:

### Core idea

Disable a skill by **removing its mirror directory** from the ZCode skills mirror (`~/.zcode/skills/` or equivalent). Since ZCode discovers skills by scanning for `SKILL.md` files, removing the directory makes the skill invisible.

Re-enable by **re-copying** the skill from the project source into the mirror.

### Two mechanisms

| Mechanism | How it works | When to use |
|-----------|-------------|-------------|
| `mirror` (default) | Deletes the managed mirror directory entirely (`rmSync` recursive). ZCode stops discovering the skill. | Production use. Cleanest; no leftover files. |
| `shadow` | Writes an empty `SKILL.md` with `disabled: true` frontmatter at the same path. The directory is preserved. | Environments where full deletion is undesirable; the shadow files outlive the sync. |

Both mechanisms are **safe**: they only touch directories that bear a `.skill-router-meta.json` file (managed by the skill-router). User-created / hand-edited skills are never modified or deleted.

### Disabled-skills registry

Project-level state is persisted in `.skill-router-disabled.json` at the project root:

```json
{
  "disabled": ["backend-eloquent", "frontend-react-hooks"],
  "lastModified": "2026-09-23T12:00:00.000Z"
}
```

This registry is read by the planner before building the sync plan. Any skill listed here is classified as `disabled` in the plan — it is excluded from `add`/`update`/`unchanged` and placed in the `disabled` array instead. The writer then calls `disableSkill()` for each disabled entry.

### CLI usage

```bash
# Disable one or more skills
node bin/skill-router.mjs sync --disable backend-eloquent --disable frontend-react-hooks

# Re-enable a previously disabled skill
node bin/skill-router.mjs sync --enable backend-eloquent

# Preview what would happen
node bin/skill-router.mjs sync --dry-run --disable some-skill

# Use shadow mechanism instead of deleting the directory
node bin/skill-router.mjs sync --disable some-skill --disable-mechanism shadow
```

### Architecture

```
User runs: node bin/skill-router.mjs sync --disable backend-eloquent
                            │
                            ▼
         ┌─────────────────────────────────────────┐
         │  src/cli/sync.mjs                        │
         │  1. Parse --disable / --enable flags     │
         │  2. Read .skill-router-disabled.json     │
         │  3. Update registry (add/remove names)   │
         │  4. Write updated registry              │
         │  5. Call planSync(projectDir, mirror,   │
         │                       { projectRoot })   │
         └──────────────────┬──────────────────────┘
                            │
                            ▼
         ┌─────────────────────────────────────────┐
         │  src/sync/planner.mjs                    │
         │  1. Build project index (SHA-256)       │
         │  2. Build mirror index (SHA-256)        │
         │  3. Read disabled registry               │
         │  4. Classify: add/update/remove/         │
         │     unchanged/disabled                   │
         │  5. Return SyncPlan                      │
         └──────────────────┬──────────────────────┘
                            │
                            ▼
         ┌─────────────────────────────────────────┐
         │  src/sync/writer.mjs                     │
         │  1. Apply add/update/remove normally     │
         │  2. For each disabled entry:             │
         │     → disableSkill(mirrorPath, entry)    │
         │  3. Persist state via mergeSyncResult    │
         └──────────────────┬──────────────────────┘
                            │
                            ▼
         ┌─────────────────────────────────────────┐
         │  src/sync/disabler.mjs                   │
         │  1. Read .skill-router-meta.json        │
         │  2. If managed → rmSync(dir) [mirror]    │
         │     or write shadow SKILL.md [shadow]    │
         │  3. Return { success, message }          │
         └─────────────────────────────────────────┘
```

## API Reference

### `disableSkill(mirrorPath, entry, mechanism?) → DisableResult`

Remove a managed skill from the ZCode mirror.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mirrorPath` | `string` | Absolute path to the ZCode skills mirror root |
| `entry` | `SkillEntry` | `{ name, path, hash }` — the skill to disable |
| `mechanism` | `'mirror' \| 'shadow'` | Default: `'mirror'` |

**Returns:** `{ success: boolean, message: string, mechanism?: string }`

### `enableSkill(mirrorPath, entry, projectSkillsDir, mechanism?) → DisableResult`

Re-copy a disabled skill from the project into the mirror.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mirrorPath` | `string` | Absolute path to the ZCode skills mirror root |
| `entry` | `SkillEntry` | `{ name, path, hash }` — the skill to enable |
| `projectSkillsDir` | `string` | Absolute path to the project skills root |
| `mechanism` | `'mirror' \| 'shadow'` | Default: `'mirror'` |

**Returns:** `{ success: boolean, message: string, mechanism?: string }`

### `readDisabledRegistry(projectRoot?) → { disabled: string[], lastModified: string\|null }`

Read the disabled-skills registry from the project root.

### `writeDisabledRegistry(disabled, projectRoot?) → void`

Write the disabled-skills registry. Called by the CLI when `--disable`/`--enable` flags are used.

## Security

- Only mirror directories with `.skill-router-meta.json` are modified.
- The project directory is **never** touched by disable/enable operations.
- Path traversal is guarded at every level (same safeguards as the normal sync writer).
- The disabled registry lives in the project root alongside `.gitignore` — it can be committed for team-wide disable lists, or ignored for personal overrides.

## Limitations & Uncertainties

1. **No native ZCode API.** This is a filesystem-based workaround. If ZCode adds a native disable API in a future release, the mechanism should be migrated to use it.
2. **Shadow mechanism side-effects.** Shadow-mode leaves an empty `SKILL.md` + modified `.skill-router-meta.json` in the mirror directory. The directory itself remains (just with a no-op skill). A future full-sync might need to clean up orphaned shadow directories.
3. **Multi-workspace.** If the same project is opened in multiple ZCode workspaces, each has its own `~/.zcode/skills/`. The disabled registry is project-scoped but the mirror is user-scoped. Disabling in one workspace affects all workspaces using the same mirror path.
4. **Plugin-provided skills.** Skills installed from plugins live in the plugin cache and are not managed by the skill-router. Disabling them via this mechanism would not affect plugin-provided skills (they would re-appear on plugin reinstall).
