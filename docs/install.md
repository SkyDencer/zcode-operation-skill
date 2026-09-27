# Install — Skill Router

How to install, verify, and uninstall the ZCode Skill Router plugin.

## Prerequisites

| Requirement | Minimum version | Why |
|-------------|----------------|-----|
| Node.js | **>= 20** | The project uses ESM features (`import.meta.url`, `Array.prototype.at`) that require Node 20+ (`package.json` `engines.node: ">=20"`) |
| ZCode | **>= 3.14.1** | The hook contract (`UserPromptSubmit`) is stable at this version |
| Git | any recent version | Needed only for cloning the repository; not required after install |

No other dependencies are required for the default path. The optional ONNX semantic provider (`SKILL_ROUTER_EMBEDDING_PROVIDER=onnx`) requires `@huggingface/transformers` (591 MB install), but the shipped default uses only the zero-dependency FNV-1a provider and never loads it. See [docs/embeddings.md](./embeddings.md) and [docs/configure.md](./configure.md).

## Installation

### Step 1: Clone the repository

```bash
git clone https://github.com/SkyDencer/zcode-operation-skill.git
cd zcode-operation-skill
```

### Step 2: Run the install script

The project ships three install entry points — pick the one appropriate for your platform. All three wrap the same Node script (`scripts/install.mjs`) and do the same six steps (see below).

**Windows (PowerShell):**

```powershell
.\install.ps1 --yes
```

**Unix / macOS / WSL:**

```bash
./install.sh --yes
```

**Any platform (Node directly):**

```bash
node scripts/install.mjs --yes
```

### What the install script does

`scripts/install.mjs` runs six steps in order:

1. **Verify Node.js >= 20.** Reads `process.versions.node`; exits 1 with a message if the major version is below 20.
2. **Verify repository location.** Checks that `package.json`, `hooks/build-index.mjs`, and `bin/skill-router.mjs` all exist at the expected paths. Exits 1 if any are missing — the script must be run from the repository root.
3. **Build the skill index.** Runs `node hooks/build-index.mjs`. This scans `data/skills/` recursively, parses frontmatter from every `SKILL.md`, builds the BM25 index (`data/skill-index.json`), and writes the parsed-index cache (`data/skill-index.prebuilt.json`) when present.
4. **Dry-run sync.** Runs `node bin/skill-router.mjs sync --dry-run` and prints the plan (what would be added, updated, or removed from the ZCode mirror). Does not write anything.
5. **Ask for confirmation.** Unless `--yes` was passed, prompts `Proceed? [y/N]` on the terminal. Non-interactive mode (piped stdin) skips the prompt silently.
6. **Sync to ZCode mirror.** Runs `node bin/skill-router.mjs sync`, copying project skills into `~/.zcode/skills/` (or the path given by `SKILL_ROUTER_ZCODE_DIR`). Then runs `verify` and prints the result.

To preview without making changes, append `--dry-run`:

```bash
node scripts/install.mjs --dry-run
```

### Step 3: Deploy router skills and register the hook

The install script syncs leaf skills but does **not** deploy the router dispatcher skills or register the hook. Do that next:

```bash
# Preview what would be deployed
node bin/skill-router.mjs deploy --dry-run

# Deploy routers and register the hook (idempotent)
node bin/skill-router.mjs deploy
```

The deploy command copies `router-skills/router-*/SKILL.md` into the ZCode mirror, writes `.skill-router-meta.json` in each managed directory, and registers the `UserPromptSubmit` hook in `~/.zcode/cli/config.json`. A snapshot is saved to `logs/deploys/` before any writes, so you can roll back on failure.

To skip hook registration (e.g. when testing locally):

```bash
node bin/skill-router.mjs deploy --no-hook
```

### Step 4: Restart ZCode and verify

Restart ZCode so it picks up the new plugin and hook registration. Then verify the installation:

```bash
# Health check — 8 checks, all should pass
node bin/skill-router.mjs health

# Verify sync state — compares project vs mirror
node bin/skill-router.mjs verify

# Run the benchmark to confirm retrieval works
node bin/skill-router.mjs benchmark --mode bm25
```

A healthy installation reports **8 passed (8 total)** from `health`. `verify` may report mirror drift (4 stale entries) if the ZCode mirror was modified externally — this is a pre-existing condition from the imported corpus, not an install failure. The benchmark prints Top-1 accuracy and latency numbers. If any check fails, run the diagnostic report:

```bash
node bin/skill-router.mjs doctor
```

## Uninstall

There is no dedicated uninstall command. To remove the router cleanly:

```bash
# 1. Remove the hook registration from ZCode's CLI config.
#    The hook-registrar module exposes unregisterHook() but the CLI does not
#    yet expose a --unregister flag. Remove it manually:
node -e "
import { detectHookConfigPath, unregisterHook } from './src/deploy/hook-registrar.mjs';
const configPath = detectHookConfigPath();
if (configPath) { unregisterHook(configPath); console.log('Hook unregistered from', configPath); }
else { console.log('No hook config found'); }
"

# 2. Remove router-managed skills from the mirror (mirror directories with
#    .skill-router-meta.json). The sync CLI removes by plan — run sync
#    after clearing data/skills/ so the diff deletes everything:
#    (or delete the mirror directories manually)
node bin/skill-router.mjs sync

# 3. Delete the project directory (if you cloned it)
rm -rf zcode-operation-skill
```

Step 1 reverts `~/.zcode/cli/config.json` to its pre-deploy state (the backup is in `logs/backups/`). Step 2 removes any mirror directories bearing `.skill-router-meta.json` that were created by this project. The project's own `data/skills/` directory is left untouched — delete it manually if desired.

## Troubleshooting installation

If the install script exits with an error, check these first:

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `Node.js >= 20 is required` | Old Node installation | Upgrade Node; see [https://nodejs.org](https://nodejs.org) |
| `package.json not found` | Ran from wrong directory | `cd` into the repository root first |
| `hooks/build-index.mjs not found` | Incomplete clone | Re-clone the repository |
| `bin/skill-router.mjs not found` | Incomplete clone | Re-clone the repository |
| `Sync failed` after `--yes` | ZCode mirror not writable | Check permissions on `~/.zcode/skills/` |
| `health` shows warnings | Optional features unavailable (SLM, ONNX) | These are optional — ignore unless you explicitly enabled them |

Full diagnostics:

```bash
node bin/skill-router.mjs doctor
```
