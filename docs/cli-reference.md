# CLI Reference — Skill Router

The Skill Router ships a full-featured management CLI at `bin/skill-router.mjs`. Every subcommand is a separate ESM module under `src/cli/`.

```bash
node bin/skill-router.mjs <subcommand> [options]
```

## Subcommands

### `list`

Display all skills grouped by domain, with quality scores and issue counts.

```bash
node bin/skill-router.mjs list
node bin/skill-router.mjs list --skills-dir ./data/skills
```

**Output:** A table grouped by domain showing skill name, quality score (0-100), and number of issues.

| Column | Description |
|---|---|
| Skill | Skill name (with check or cross prefix) |
| Quality | Score out of 100 |
| Issues | Number of validation issues |

---

### `add`

Add a single new skill from a SKILL.md file.

```bash
node bin/skill-router.mjs add ./path/to/my-skill/SKILL.md
```

Validates the skill against the 6-field quality rules, checks for name collisions, and writes it to `data/skills/`. Runs `reindex` automatically afterward to rebuild the index.

---

### `remove`

Remove a skill by its frontmatter name.

```bash
node bin/skill-router.mjs remove backend-laravel-eloquent
```

Deletes the corresponding SKILL.md file from `data/skills/` and runs `reindex` to update the index.

---

### `validate`

Run the quality validator on all SKILL.md files in the skills directory. Reports which skills pass or fail each of the 6 validation rules.

```bash
node bin/skill-router.mjs validate
node bin/skill-router.mjs validate --skills-dir ./data/skills
node bin/skill-router.mjs validate --json
```

**Validation rules:**
1. Name is present and non-empty
2. Name starts with one of its declared domains followed by `-`
3. Description length: 40-400 characters
4. Keywords count: 3-15
5. All domains exist in `data/domains/`
6. Content token count: 100-800 (after frontmatter)

**Options:**
- `--skills-dir <dir>` -- override the default skills directory
- `--json` -- output results as JSON instead of a markdown table

---

### `reindex`

Rebuild the BM25 skill index and recompute embeddings from all SKILL.md files across configured sources.

```bash
# Reindex from project source only (default)
node bin/skill-router.mjs reindex

# Reindex from all configured sources
node bin/skill-router.mjs reindex --sources all

# Reindex from project only explicitly
node bin/skill-router.mjs reindex --sources project

# Reindex from zcode-user source (if it exists)
node bin/skill-router.mjs reindex --sources zcode-user

# Override skills directory and use all sources
node bin/skill-router.mjs reindex --skills-dir ./my-skills --sources all
```

This command:
1. Loads skills from each configured source directory
2. Parses frontmatter from each file
3. Deduplicates by path (removes duplicates from overlapping source scans)
4. Tags each skill with its most-specific source (`project` or `zcode-user`)
5. Resolves name collisions (project wins over zcode-user)
6. Builds the BM25 inverted index -> `data/skill-index.json`
7. Computes FNV-1a n-gram embeddings -> `data/skill-embeddings.json`
8. Auto-populates domain metadata in `data/domains/`

---

### `benchmark`

Run the benchmark suite and report Top-1 accuracy, Recall@3, latency, and cache performance.

```bash
# BM25 mode (default, recommended)
node bin/skill-router.mjs benchmark

# Hybrid mode (BM25 + embeddings via RRF)
node bin/skill-router.mjs benchmark --mode hybrid

# BM25 with synonym expansion
node bin/skill-router.mjs benchmark --mode bm25 --expand on

# BM25 with opt-in reranker
node bin/skill-router.mjs benchmark --mode bm25 --rerank

# Real corpus (54 skills)
node bin/skill-router.mjs benchmark --corpus real

# Synthetic corpus benchmarks (generated on first run)
node bin/skill-router.mjs benchmark --corpus synthetic-100
node bin/skill-router.mjs benchmark --corpus synthetic-200
node bin/skill-router.mjs benchmark --corpus synthetic-300
node bin/skill-router.mjs benchmark --corpus synthetic-500
```

**Options:**
- `--mode <bm25|hybrid>` -- retrieval mode (default: bm25)
- `--rerank [on|off]` -- enable opt-in reranker (default: on)
- `--expand [on|off]` -- enable synonym expansion (default: off)
- `--corpus <real|synthetic-N>` -- which skill corpus to use (default: real)

---

### `stats`

Show corpus statistics: total skill count, domain distribution, keyword frequencies.

```bash
node bin/skill-router.mjs stats
```

**Output:**
- Total number of skills
- Valid skills count
- Average quality score
- Total unique keywords
- Average description length
- Total content tokens
- Skills per domain
- Top-10 most common keywords

---

### `import`

Bulk-import SKILL.md files from an external directory into `data/skills/`.

```bash
# Import from a directory (validates each skill before copying)
node bin/skill-router.mjs import /path/to/external-skills

# Override target directory
node bin/skill-router.mjs import /path/to/skills --skills-dir ./my-skills

# Force overwrite existing skills
node bin/skill-router.mjs import /path/to/skills --force

# JSON output
node bin/skill-router.mjs import /path/to/skills --json
```

**Behavior:**
- Recursively scans the source directory for SKILL.md files
- Validates each candidate against the 6-field quality rules
- Detects name collisions: skips by default, overwrites with `--force`
- Writes validated skills to `data/skills/<domain>/<slug>/SKILL.md`
- Path traversal and symlink attacks are blocked

**Output:** A report showing imported, rejected, and skipped skills.

---

### `sync`

Sync project skills to the ZCode mirror at `~/.zcode/skills/`. Compares SHA-256 hashes to detect drift. Handles adds, updates, removes, unchanged, and disabled skills.

```bash
# Sync all changes
node bin/skill-router.mjs sync

# Preview without writing
node bin/skill-router.mjs sync --dry-run

# Force overwrite even if hash diverged
node bin/skill-router.mjs sync --force

# Quiet mode (no console output)
node bin/skill-router.mjs sync --quiet

# Custom mirror directory
node bin/skill-router.mjs sync --zcode-dir /path/to/zcode/skills

# Disable a skill in the mirror
node bin/skill-router.mjs sync --disable backend-laravel-eloquent

# Re-enable a previously disabled skill
node bin/skill-router.mjs sync --enable backend-laravel-eloquent

# Use shadow disable mechanism instead of mirror removal
node bin/skill-router.mjs sync --disable backend-laravel-eloquent --disable-mechanism shadow

# Combine multiple operations
node bin/skill-router.mjs sync --disable skill-a --enable skill-b --dry-run
```

**Behavior:**
- Reads the disabled registry from `.skill-router-disabled.json`
- Writes `.skill-router-meta.json` alongside each synced skill
- Persists sync state to `.skill-router-sync-state.json`
- Never modifies mirror directories without a meta file (user-managed skills are safe)
- Disabled skills are classified separately and processed after add/update/remove

**Disable mechanisms:**
- `mirror` (default): deletes the managed mirror directory entirely
- `shadow`: writes a disabled SKILL.md with `disabled: true` frontmatter; real directory preserved

---

### `deploy`

Deploy router skills from `router-skills/` to the ZCode mirror. Compares source hashes against the mirror, adds or updates routers, and applies leaf disables from the registry. Snapshots state before any writes; supports rollback on failure.

```bash
# Preview changes without applying
node bin/skill-router.mjs deploy --dry-run

# Deploy routers and apply leaf disables
node bin/skill-router.mjs deploy

# Deploy and run post-deploy verification
node bin/skill-router.mjs deploy --verify

# Roll back from a snapshot file
node bin/skill-router.mjs deploy --rollback ./path/to/deploy-backup-2026-09-23T10:00:00.json

# Custom directories
node bin/skill-router.mjs deploy --zcode-dir ~/.zcode/skills --project-dir /path/to/project
```

**Flags:**
- `--dry-run` — Plan and display what would change without writing anything.
- `--rollback <file>` — Restore the mirror from a previous deploy snapshot.
- `--verify` — Run post-deploy health checks after applying changes.
- `--quiet` — Suppress intermediate console output.
- `--zcode-dir <dir>` — Override the ZCode mirror directory.
- `--project-dir <dir>` — Override the project root directory.

**Behavior:**
1. Scans `router-skills/` for router directories, computes SHA-256 hashes.
2. Scans the ZCode mirror for existing managed routers (those with `.skill-router-meta.json`).
3. Classifies each router as `add`, `update`, or `unchanged`.
4. Reads `.skill-router-disabled.json` to determine which leaf skills to disable.
5. Creates a snapshot of the current mirror state before any writes.
6. Copies/overwrites router SKILL.md files and writes fresh meta files.
7. Disables leaves via the shadow mechanism (preserves real directories).
8. On error, attempts automatic rollback from the snapshot.
9. With `--verify`, runs health checks on routers and leaves.

---

### `sources`

List current sources and skill counts per source. Shows name collisions when the same skill name appears in multiple sources.

```bash
node bin/skill-router.mjs sources
```

**Output:**
- Source paths and existence status
- Skill count per source
- Total unique skills after path-level deduplication
- After-name-deduplication count
- Collision details (project wins over zcode-user)

---

### `verify`

Health checks for sync state and index integrity. Exits 0 when all checks pass, 1 otherwise.

```bash
node bin/skill-router.mjs verify
node bin/skill-router.mjs verify --skills-dir ./data/skills
node bin/skill-router.mjs verify --zcode-dir ~/.zcode/skills
```

**Checks performed:**

| # | Check | Description |
|---|---|---|
| 1 | Mirror sync status | Whether the ZCode mirror is in sync with the project skills (no adds/updates/removes pending) |
| 2 | Orphan mirror dirs | Skills present in the mirror but absent from the project |
| 3 | Meta files | Every router-managed mirror skill has a `.skill-router-meta.json` |
| 4 | Index up to date | Each entry in `data/skill-index.json` matches its SKILL.md content hash |
| 5 | Thresholds file | `data/thresholds.json` exists and contains valid numeric thresholds |

**Output:** A colored pass/fail table. Green PASS, red FAIL, yellow WARN.

---

### `doctor`

Diagnostic report for the Skill Router installation. **READ-ONLY** -- never modifies any files.

```bash
node bin/skill-router.mjs doctor
```

**Sections reported:**

| Section | Contents |
|---|---|
| Environment | Node version, platform, OS, process cwd |
| ZCode Integration | Detected ZCode skills directory, existence, writability |
| Corpus | Skills directory path, SKILL.md count, index entries, index file size |
| Thresholds | High/medium thresholds, benchmark Top-1, fallback rate, optimization timestamp |
| Sync State | Last sync timestamp, mirror path, tracked skill count |
| Benchmark Baseline | Top-1 accuracy, fallback rate, grid evaluations, optimization time |
| Environment Overrides | All `SKILL_ROUTER_*` environment variables currently set |
| Config Defaults | BM25 parameters, embedding dims, RRF k, timeout, budget limits |

---

### `analytics`

Show usage analytics computed from routing logs.

```bash
# Show all analytics
node bin/skill-router.mjs analytics

# Last 7 days
node bin/skill-router.mjs analytics --since 7

# JSON output
node bin/skill-router.mjs analytics --json
```

**Metrics reported:**
- Total retrieval requests and index builds
- Overall fallback rate and median latency
- Per-day retrieval histogram
- Per-day fallback rate trend
- Per-day median latency trend
- Top-10 most recommended skills
- Top-10 most frequent prompt hashes (SHA-256; raw prompts never shown)

**Privacy note:** Raw prompts are never displayed. Only their SHA-256 hashes appear in the report.

---

### `help`

Display usage information and available subcommands.

```bash
node bin/skill-router.mjs help
```

---

### `feedback`

Show routing feedback summary computed from decision logs. Reports decisions by mode, tier, router, top selected skills, and latency percentiles.

```bash
# Show feedback summary (text, last 300 decisions)
node bin/skill-router.mjs feedback

# Last 7 days only
node bin/skill-router.mjs feedback --since 2026-09-17

# Limit to N most recent decisions
node bin/skill-router.mjs feedback --limit 50

# JSON output for scripting
node bin/skill-router.mjs feedback --json

# Export decisions to CSV
node bin/skill-router.mjs feedback --export ./decisions.csv
```

**Output fields:**
- `totalCount`: number of decisions in the window
- `byMode`: explicit vs implicit split
- `byTier`: bm25 / slm / hybrid / none counts
- `byRouter`: top-6 routers including `(none)` for implicit
- `topSkills`: most frequently recommended skills with count
- `p50Latency`, `p95Latency`, `maxLatency`: latency distribution
- `fallbackRate`: percentage of zero-result retrieves

---

### `health`

Alias for `verify`. Runs health checks on sync state, index integrity, and thresholds.

```bash
node bin/skill-router.mjs health
```

---

### `tune`

Adaptive BM25 weight tuning. Collects routing decisions and user feedback signals to propose field-weight adjustments, then applies them with guardrails. Full documentation is in [docs/tuning.md](./tuning.md).

```bash
# Show current weights, baseline, and attribution count
node bin/skill-router.mjs tune --status

# Compute proposed weights from benchmark attribution data (read-only)
node bin/skill-router.mjs tune --analyze

# Apply proposed weights with pre/post benchmark and auto-rollback on regression
node bin/skill-router.mjs tune --apply

# Preview what --apply would do without writing anything
node bin/skill-router.mjs tune --apply --dry-run

# Restore previous weights from the latest snapshot
node bin/skill-router.mjs tune --rollback

# Run analyze + apply in one step (with guardrails)
node bin/skill-router.mjs tune --auto

# Preview auto mode without applying
node bin/skill-router.mjs tune --auto --dry-run

# Print tuning history from logs/tuning/decisions.jsonl
node bin/skill-router.mjs tune --report
```

**Options:**
- `--dry-run` — Preview changes without applying them (works with `--apply` and `--auto`)
- `--threshold N` — Minimum attributions required before proposing a change (default: 20)
- `--json` — Output results as JSON (where supported)

**Subcommand behaviour:**

| Subcommand | What it does |
|---|---|
| `--status` | Shows current weights from `data/weights.json` (or defaults), baseline Top-1 from `data/baseline.json`, last applied timestamp, and attribution count |
| `--analyze` | Re-runs the 130-prompt benchmark, attributes each outcome to a dominant BM25 field, computes proposed weight change, prints analysis (does NOT write files) |
| `--apply` | Same analysis as `--analyze`, then: (1) snapshot current weights to `logs/weights/`, (2) run pre-benchmark, (3) write proposed weights to `data/weights.json`, (4) run post-benchmark, (5) auto-rollback if Top-1 drops > 1pp, (6) log decision to `logs/tuning/decisions.jsonl` |
| `--rollback` | Reads the most recent snapshot from `logs/weights/weights-*.json` and restores those weights to `data/weights.json` |
| `--auto` | Runs `--analyze` followed by `--apply` in sequence |
| `--report` | Prints accepted/reverted/error counts and the last 5 tuning attempts from the decisions log |

**Guardrails:**
- `MAX_DELTA = 0.5`: no field can move more than 0.5 from the baseline weights in `data/baseline.json`
- `ACCURACY_TOLERANCE = 1.0pp`: `--apply` auto-rolls back if Top-1 drops by more than 1 percentage point
- Weight clamping: every field stays in `[0.5, 5.0]`
- Sum preservation: weights are normalized so their total stays constant

---

### `verify --deep`

Extended health check that includes schema validation of all log entries and checks for orphan deploy snapshots.

```bash
node bin/skill-router.mjs verify --deep
```

**Additional checks beyond `verify`:**

| # | Check | Description |
|---|---|---|
| 6 | Hook registered | `hooks.events.UserPromptSubmit` in ZCode CLI config contains our hook entry |
| 7 | Hook invocable | Spawns `node hooks/route.mjs` with test stdin and verifies valid JSON output |

---

### `deploy --with-hook`

Deploy router skills and also register the `UserPromptSubmit` hook in ZCode's CLI config so the hook fires on every authoring event. Combines `deploy` with automatic hook configuration.

```bash
# Deploy routers and register hook
node bin/skill-router.mjs deploy --with-hook

# Dry-run both operations
node bin/skill-router.mjs deploy --with-hook --dry-run
```

---

### `deploy --list-snapshots`

List all deploy snapshots stored in `logs/deploys/` with timestamps and router counts. Useful for choosing a snapshot to restore from.

```bash
node bin/skill-router.mjs deploy --list-snapshots
```

**Output:**

| Snapshot file | Timestamp | Routers | Status |
|---|---|---|---|
| `deploy-snapshot-2026-09-23T10-00-00.json` | 2026-09-23 10:00 | 6 | valid |

---

### `deploy --restore <file>`

Restore the ZCode mirror from a previous deploy snapshot. Performs the same verification as a normal deploy. Safe: only touches directories with `.skill-router-meta.json`.

```bash
# Restore from a specific snapshot
node bin/skill-router.mjs deploy --restore ./logs/deploys/deploy-snapshot-2026-09-23T10-00-00.json

# List snapshots first to find the right one
node bin/skill-router.mjs deploy --list-snapshots
```

---

## Global Options

| Option | Description |
|---|---|
| `--skills-dir <dir>` | Override the default skills directory (`data/skills`) |
| `--zcode-dir <dir>` | Override the ZCode mirror directory (`~/.zcode/skills`) |
| `--dry-run` | Preview changes without applying them |
| `--json` | Output results as JSON (where supported) |
| `--force` | Force overwrite existing skills (import, sync) |
| `--quiet` | Suppress console output (sync) |
| `--sources <list>` | Source list for reindex (`project`, `zcode-user`, `all`, comma-separated) |
| `--disable <name>` | Disable a skill in the mirror (sync) |
| `--enable <name>` | Enable a previously disabled skill (sync) |
| `--disable-mechanism <mirror|shadow>` | Choose disable strategy (sync, default: mirror) |
| `--since <n>` | Look back N days for analytics (analytics) |
| `--rollback <file>` | Roll back deploy from snapshot (deploy) |

## Skills Directory Structure

Skills are organized hierarchically under `data/skills/`:

```
data/skills/
├── backend/
│   ├── laravel/
│   │   ├── eloquent/SKILL.md
│   │   ├── migrations/SKILL.md
│   │   └── validation/SKILL.md
│   └── api/
│       ├── rest-conventions/SKILL.md
│       └── rate-limiting/SKILL.md
├── frontend/
│   ├── react/
│   │   ├── hooks-basics/SKILL.md
│   │   └── context/SKILL.md
│   └── nextjs/
│       ├── app-router/SKILL.md
│       └── data-fetching/SKILL.md
└── design/
    ├── typography/SKILL.md
    └── color-theory/SKILL.md
```

Each skill directory contains a single `SKILL.md` file with YAML-like frontmatter:

```markdown
---
name: backend-laravel-eloquent
description: "Write efficient Eloquent ORM queries for Laravel applications, including relationships, scopes, and query scoping."
keywords:
  - eloquent
  - orm
  - laravel
  - relationships
  - query builder
domains:
  - backend
  - laravel
version: 1.0.0
---

# Backend Laravel Eloquent

... skill content (at least 100 tokens) ...
```

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | One or more skills failed validation (validate, import) |
| 1 | Unknown subcommand or missing required arguments |
| 1 | Source directory not found |
| 1 | Verify failed (one or more health checks did not pass) |
