# Skill Sync — ZCode Mirror Synchronization

## Overview

The `sync` subcommand keeps the project's `data/skills/` directory in sync with
the ZCode skills mirror (`~/.zcode/skills` or a custom path). It is designed for
developers who maintain a local skill corpus and want to propagate changes to
their ZCode installation without manual file copying.

## How It Works

### Planning (`src/sync/planner.mjs`)

`planSync(projectSkillsDir, zcodeSkillsDir, options)` performs a read-only comparison:

1. Walks both directories recursively, collecting every `SKILL.md` file.
2. Computes a **SHA-256 content hash** of each file's raw bytes.
3. Reads `.skill-router-disabled.json` from the project root (if present) to identify disabled skills.
4. Classifies each skill into one of five categories:
   - **add** — present in project, absent from mirror
   - **update** — present in both, but hashes differ
   - **remove** — present in mirror, absent from project
   - **unchanged** — present in both with identical hash
   - **disabled** — present in both, but listed in the disabled registry (will be removed from mirror)
5. Returns a `SyncPlan` object:
   ```json
   {
     "add": [{ "name": "...", "path": "...", "hash": "..." }],
     "update": [{ "name": "...", "path": "...", "hash": "..." }],
     "remove": [{ "name": "...", "path": "...", "hash": "..." }],
     "unchanged": [{ "name": "...", "path": "...", "hash": "..." }],
     "disabled": [{ "name": "...", "path": "...", "hash": "..." }],
     "mirrorPath": "/absolute/path/to/zcode/skills"
   }
   ```

### Writing (`src/sync/writer.mjs`)

`applySync(plan, projectSkillsDir, options)` executes the plan:

| Action | What happens |
|--------|-------------|
| **add** | Copies `<path>/SKILL.md` from project into the mirror; writes `.skill-router-meta.json` |
| **update** | Overwrites mirror `SKILL.md` with project version; updates meta hash |
| **remove** | Deletes the mirror directory (never touches the project) |
| **disabled** | Calls `disableSkill()` — removes the managed mirror directory (or writes a shadow file) |
| **unchanged** | Skipped |

#### Safety guarantees

- **User-managed skills are protected.** If a mirror directory lacks a
  `.skill-router-meta.json` file, it is assumed to be user-created and is
  **never** modified or deleted — even for add/update/remove/disabled actions.
- **Path traversal blocked.** Source paths are verified to stay within the
  project root; symlink targets are verified to stay within the mirror root.
- **`--dry-run` mode.** Pass `--dry-run` to see what would happen without
  touching the filesystem.

### State tracking (`src/sync/state.mjs`)

After a successful sync, the plugin writes
`.skill-router-sync-state.json` in the project root:

```json
{
  "lastSyncAt": "2026-09-22T12:00:00.000Z",
  "mirrorPath": "/home/user/.zcode/skills",
  "skills": {
    "backend-eloquent": { "hash": "abc123...", "syncedAt": "2026-09-22T12:00:00.000Z" }
  }
}
```

This state is used for diagnostics and future incremental-sync features.

### Skill disabling (`src/sync/disabler.mjs`)

Skills can be explicitly disabled without removing them from the project.
Disabled skills are tracked in `.skill-router-disabled.json`:

```json
{
  "disabled": ["backend-eloquent", "frontend-react-hooks"],
  "lastModified": "2026-09-23T12:00:00.000Z"
}
```

Two mechanisms are supported:

| Mechanism | Behavior |
|-----------|----------|
| `mirror` (default) | Deletes the managed mirror directory entirely. ZCode stops discovering the skill because `SKILL.md` is gone. |
| `shadow` | Writes an empty `SKILL.md` with `disabled: true` frontmatter at the same path. The directory is preserved. |

See `docs/zcode-skill-visibility.md` for the full research and design rationale.

## CLI Usage

```bash
# Sync project skills to the default ZCode mirror (~/.zcode/skills)
node bin/skill-router.mjs sync

# Sync with a custom project skills directory
node bin/skill-router.mjs sync --skills-dir ./my-skills

# Sync to a custom ZCode mirror
node bin/skill-router.mjs sync --zcode-dir /custom/path/to/skills

# Preview changes without applying
node bin/skill-router.mjs sync --dry-run

# Force-overwrite skills that have diverged from the recorded hash
node bin/skill-router.mjs sync --force

# Suppress all console output (useful for scripting)
node bin/skill-router.mjs sync --quiet

# Disable one or more skills in the mirror
node bin/skill-router.mjs sync --disable backend-eloquent
node bin/skill-router.mjs sync --disable backend-eloquent --disable frontend-react-hooks

# Re-enable a previously disabled skill
node bin/skill-router.mjs sync --enable backend-eloquent

# Use shadow mechanism instead of deleting the mirror directory
node bin/skill-router.mjs sync --disable some-skill --disable-mechanism shadow
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SKILL_ROUTER_ZCODE_DIR` | `~/.zcode/skills` | Override the ZCode mirror root |

## Architecture

```
data/skills/ (project)          ~/.zcode/skills/ (mirror)
├── backend/                    ├── backend/
│   ├── eloquent/               │   ├── eloquent/
│   │   ├── SKILL.md   ──add──▶ │   │   ├── SKILL.md
│   │   └── (no meta yet)       │   │   └── .skill-router-meta.json
│   └── rest/         ──update─▶ │   ├── rest/
│       ├── SKILL.md            │   │   ├── SKILL.md  (updated)
│       └── .skill-router-meta  │   │   └── .skill-router-meta.json
└── frontend/           ──remove─▶├── frontend/  (deleted from mirror)
    └── react/                   └── (not touched in project)

Disabled skill (mirror mechanism):
  project: backend/eloquent/SKILL.md   EXISTS
  mirror:  backend/eloquent/           DELETED by disableSkill()
  → ZCode no longer discovers backend-eloquent
```

## Security

- Symlinks are resolved and verified against the source/mirror root before
  any file operation.
- Path components containing `..` are rejected.
- The mirror directory is never scanned for operations originating from it;
  only the project side is used as the source of truth.
- Only mirror directories bearing `.skill-router-meta.json` are modified
  by disable/enable operations.
