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

Validates the skill against the 6-field quality rules, checks for name collisions, and writes it to `data/skills/`. It does **not** run `reindex` — it prints a tip telling you to. Run `node bin/skill-router.mjs reindex` yourself or the index stays stale.

---

### `remove`

Remove a skill by its frontmatter name.

```bash
node bin/skill-router.mjs remove backend-laravel-eloquent
```

Deletes the corresponding SKILL.md file from `data/skills/`. Like `add`, it does **not** run `reindex` — it only prints a tip. Run `node bin/skill-router.mjs reindex` yourself.

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
# Reindex from the project source (default): data/skills/ + router-skills/
node bin/skill-router.mjs reindex

# Reindex from all configured sources
node bin/skill-router.mjs reindex --sources all

# Reindex from project only explicitly (data/skills/ + router-skills/)
node bin/skill-router.mjs reindex --sources project

# Reindex from zcode-user source (if it exists)
node bin/skill-router.mjs reindex --sources zcode-user

# Override skills directory and use all sources
node bin/skill-router.mjs reindex --skills-dir ./my-skills --sources all
```

This command:
0. Resolves the same default project corpus as `hooks/build-index.mjs`: `data/skills/` (54 leaf skills) plus `router-skills/` (6 `router-*` dispatchers). Both index builders share `projectSources()` in `src/index/sources.mjs`, so the generated index never depends on which entry point ran last. Pass `--skills-dir` to index a single directory instead.
1. Loads skills from each configured source directory
2. Parses frontmatter from each file
3. Deduplicates by path (removes duplicates from overlapping source scans)
4. Tags each skill with its most-specific source (`project` or `zcode-user`)
5. Resolves name collisions (project wins over zcode-user)
6. Writes the flat array of skill objects -> `data/skill-index.json` (no inverted index; BM25 scores at query time)
7. Computes FNV-1a n-gram embeddings -> `data/skill-embeddings.json`
8. Auto-populates domain metadata in `data/domains/`

---

### `benchmark`

Run the benchmark suite and report Top-1 accuracy, Recall@3, latency, and cache performance.

```bash
# BM25 mode (the mode the frozen baseline in data/baseline.json was measured with)
node bin/skill-router.mjs benchmark --mode bm25

# Hybrid mode (BM25 + embeddings via RRF) -- this is the DEFAULT if you omit --mode
node bin/skill-router.mjs benchmark

# BM25 with synonym expansion
node bin/skill-router.mjs benchmark --mode bm25 --expand on

# BM25 with opt-in reranker
node bin/skill-router.mjs benchmark --mode bm25 --rerank

# Real corpus (60 index entries: 54 leaf skills + 6 router-* dispatchers)
node bin/skill-router.mjs benchmark --corpus real

# Synthetic corpus benchmarks (generated on first run)
node bin/skill-router.mjs benchmark --corpus synthetic-100
node bin/skill-router.mjs benchmark --corpus synthetic-200
node bin/skill-router.mjs benchmark --corpus synthetic-300
node bin/skill-router.mjs benchmark --corpus synthetic-500
```

**Options:**
- `--mode <bm25|hybrid>` -- retrieval mode. The default is **`hybrid`**, not `bm25` (`tests/run-benchmark.mjs:39`); hybrid scores far lower on this corpus, so pass `--mode bm25` explicitly to reproduce the baseline
- `--rerank [on|off]` -- enable opt-in reranker (default: on)
- `--expand [on|off]` -- enable synonym expansion (default: off)
- `--corpus <real|synthetic-N>` -- which skill corpus to use (default: real)

**Warning:** `benchmark` writes `logs/benchmark-YYYY-MM-DD.json` on every run, and
it ignores `--help` (see [No subcommand implements `--help`](#no-subcommand-implements---help)).

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

# Inspect a snapshot file (reads and prints metadata; changes nothing)
node bin/skill-router.mjs deploy --rollback ./logs/deploys/deploy-snapshot-2026-09-23T10-00-00.json

# Actually restore the mirror from a snapshot (--restore takes a TIMESTAMP PREFIX)
node bin/skill-router.mjs deploy --restore 2026-09-23T10-00-00

# Custom directories. Do NOT use ~ -- Node's path.resolve() does not expand it,
# so `~/.zcode/skills` resolves to <project>/~/.zcode/skills. Pass an absolute path.
node bin/skill-router.mjs deploy --zcode-dir C:/Users/you/.zcode/skills --project-dir /path/to/project
```

**Flags:**
- `--dry-run` — Plan and display what would change without writing anything.
- `--rollback <file>` — **Read-only.** Parses the snapshot file and prints how many routers it recorded, then exits. It does not restore anything; the output itself says "full rollback requires restoring from snapshot via `--restore`".
- `--restore <timestamp>` — Actually restore the mirror. Matches on a **timestamp prefix** (or a substring of the snapshot path), not a file path. A `./logs/deploys/...` argument will not match, because the stored paths are absolute Windows paths with backslashes.
- `--with-hook` / `--no-hook` — Hook registration is **on by default** for every non-dry-run deploy with no errors. `--with-hook` is a no-op restatement of the default; `--no-hook` is the opt-out.
- `--list-snapshots` — List snapshots in `logs/deploys/` and exit.
- `--verify` — Run post-deploy health checks after applying changes.
- `--quiet` — Suppress intermediate console output.
- `--zcode-dir <dir>` — Override the ZCode mirror directory (absolute path; no `~` expansion).
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
node bin/skill-router.mjs verify --zcode-dir C:/Users/you/.zcode/skills  # absolute; no ~ expansion
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

# Correlate decisions with feedback signals -> positive / negative / unknown,
# plus per-field BM25 attribution and a proposed weight update
node bin/skill-router.mjs feedback --outcomes
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

**Not an alias for `verify`** — it is a separate command with its own checks and its
own exit-code scheme. `verify` runs 5 checks (7 with `--deep`) and exits 0 or 1.
`health` runs 8 checks and exits **0 / 1 / 2** (0 = all pass, 1 = warnings only,
2 = at least one failure).

`health` checks: plugin directory up to date, hook registered, index is fresh,
routers installed, hook invocable, `llama-server` reachable, no forbidden files,
thresholds file. `verify` checks: mirror sync status, orphan mirror dirs, meta
files, index up to date, thresholds file (plus hook-registered under `--deep`).
No check name overlaps.

Note: the "hook invocable" check spawns `node hooks/route.mjs`, which writes
`.zcode/output.json` in the current working directory.

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
- `--json` — Accepted but **not implemented**. `src/cli/tune.mjs:123` sets `opts.json = true` and no code path reads it, so `tune --json` prints the same human-readable text as `tune`

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

### `deploy --with-hook` / `--no-hook`

A plain `deploy` **already registers the `UserPromptSubmit` hook** in ZCode's CLI
config. `src/cli/deploy.mjs:27` initialises `withHook = true`, and the
registration block at `src/cli/deploy.mjs:182` runs whenever `withHook && !dryRun
&& result.errors.length === 0`. So:

| Invocation | Hook registered? |
|---|---|
| `deploy` | **Yes** (default) |
| `deploy --with-hook` | Yes — the flag is a no-op restatement of the default |
| `deploy --no-hook` | **No** — this is the real opt-out |
| `deploy --dry-run` | No — dry-run never registers |

```bash
# Deploy routers and register the hook (identical to a bare `deploy`)
node bin/skill-router.mjs deploy --with-hook

# Deploy routers but leave ~/.zcode/cli/config.json untouched
node bin/skill-router.mjs deploy --no-hook

# Dry-run both operations
node bin/skill-router.mjs deploy --dry-run
```

---

### `deploy --list-snapshots`

List all deploy snapshots stored in `logs/deploys/`. Useful for choosing a snapshot to restore from.

```bash
node bin/skill-router.mjs deploy --list-snapshots
```

**Output:** three columns — `Timestamp | Mirror Root | Ops`. When the directory is
empty (the state in a fresh checkout) it prints `No deploy snapshots found.`

```
Deploy snapshots (2):

  Timestamp                              | Mirror Root                              | Ops
  --------------------------------------------------------------------------------
  2026-09-23T10-00-00.000Z               | C:\Users\you\.zcode\skills               | 6
```

---

### `deploy --restore <timestamp>`

Restore the ZCode mirror from a previous deploy snapshot. Safe: only touches directories with `.skill-router-meta.json`.

**The argument is a timestamp prefix, not a file path.** `src/cli/deploy.mjs:77`
matches `s.timestamp.startsWith(arg) || s.path.includes(arg)`, and `s.path` is an
absolute Windows path with backslashes — so a `./logs/deploys/...` string will not
match and you get `Snapshot not found for: ...`.

```bash
# Restore using the timestamp shown by --list-snapshots
node bin/skill-router.mjs deploy --restore 2026-09-23T10-00-00

# List snapshots first to find the right timestamp
node bin/skill-router.mjs deploy --list-snapshots
```

---

## Global Options

This table is a *reference index across commands*, not a set of flags every
subcommand accepts. Each row names the command(s) that honour it.

| Option | Commands | Description |
|---|---|---|
| `--skills-dir <dir>` | list, validate, reindex, verify, import | Override the default skills directory (`data/skills`) |
| `--zcode-dir <dir>` | sync, deploy, verify, doctor | Override the ZCode mirror directory. Absolute path only — no `~` expansion |
| `--dry-run` | add, remove, sync, deploy, tune, import | Preview changes without applying them |
| `--json` | validate, verify, doctor, analytics, feedback | Output results as JSON. Note: `tune` accepts `--json` but never reads it |
| `--force` | import, sync | Force overwrite existing skills |
| `--quiet` | sync, deploy | Suppress console output |
| `--sources <list>` | reindex | Source list (`project`, `zcode-user`, `all`, comma-separated) |
| `--limit <n>` | feedback | Number of most recent decisions to read (default 300) |
| `--export <path>` | feedback | Write the decision table to CSV |
| `--outcomes` | feedback | Correlate decisions with signals into positive/negative/unknown |
| `--since <n\|date>` | analytics, feedback | Analytics: N days back. Feedback: `YYYY-MM-DD` |
| `--include-sync` / `--no-sync` | analytics | Include or exclude `sync` events. Documented nowhere else |
| `--deep` | verify | Run the 2 extra checks (hook registered, hook invocable) |
| `--with-hook` / `--no-hook` | deploy | Hook registration; ON by default, `--no-hook` opts out |
| `--list-snapshots` | deploy | List snapshots in `logs/deploys/` and exit |
| `--restore <timestamp>` | deploy | Restore the mirror from a snapshot. Timestamp prefix, not a file path |
| `--rollback <file>` | deploy | **Read-only**; prints snapshot metadata, restores nothing |
| `--project-dir <dir>` | deploy | Override the project root |
| `--verify` | deploy | Run post-deploy health checks |
| `--disable <name>` | sync | Disable a skill in the mirror |
| `--enable <name>` | sync | Enable a previously disabled skill |
| `--disable-mechanism <mirror\|shadow>` | sync | Disable strategy (default: mirror) |
| `--threshold <n>` | tune | Minimum attributions before proposing a change (default 20) |

## No subcommand implements `--help`

`node bin/skill-router.mjs <command> --help` does **not** print help. No
`src/cli/*.mjs` module inspects `--help`; unrecognised flags fall through and the
command runs its real body. Verified in this session:

| Command | What `--help` actually did |
|---|---|
| `list --help` | Printed the 54-row domain table, exit 0 |
| `validate --help` | Ran the full quality report, exit 0 |
| `stats --help`, `sources --help`, `doctor --help`, `analytics --help` | Ran the real command, exit 0 |
| `help --help` | Printed the help text (because `help` ignores all args) |
| `verify --help` | Ran the 5-check verify table, exit 1 |
| `health --help` | Ran the 8-check health table, exit 2, and spawned the hook (wrote `.zcode/output.json`) |
| `benchmark --help` | Ran the whole 130-prompt benchmark and wrote `logs/benchmark-2026-09-25.json` |
| `deploy --help` | **Deploys.** `--help` is ignored, `withHook` defaults to true. Probed safely with `--dry-run --zcode-dir <temp>` |

Use `node bin/skill-router.mjs help` for the command list, and the `docs/` files
referenced above for per-command options.

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
| 1 | `verify` failed (one or more checks did not pass) |
| 1 | `health` completed with warnings only |
| 2 | `health` unhealthy — one or more checks failed |

`health` is the only command that returns 2 (`src/cli/health.mjs:436`); `verify`
returns 0 or 1 only. A CI gate that treats any non-zero as a generic failure will
mis-handle `health`.
