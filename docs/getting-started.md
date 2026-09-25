# Getting Started — Skill Router

This guide gets you from zero to running in under 5 minutes.

## Prerequisites

- Node.js >= 20
- ZCode >= 3.14.1
- Git (for cloning the repository)

## Step 1: Install

The fastest way to get started is the one-command install script:

```bash
# Windows (PowerShell)
.\install.ps1 --yes

# Unix / macOS / WSL
./install.sh --yes
```

Or run the Node script directly from any subdirectory of the repository:

```bash
node scripts/install.mjs --yes
```

The install script will:

1. Verify Node.js >= 20
2. Confirm it is running from the repository root
3. Build the skill index from `data/skills/` (`node hooks/build-index.mjs`)
4. Preview the sync plan (`sync --dry-run`)
5. Ask for confirmation (skipped with `--yes`)
6. Sync skills to your ZCode mirror at `~/.zcode/skills/`
7. Run a health check (`verify`)
8. Print next steps

The script does not deploy the router skills. Run `node bin/skill-router.mjs deploy` afterwards to install the routers and register the hook.

To preview without making changes:

```bash
node scripts/install.mjs --dry-run
```

## Step 2: Verify Installation

After installation, run the health check:

```bash
node bin/skill-router.mjs verify
```

You should see 5 green PASS checks:

```
Mirror sync status                         | PASS  mirror is in sync -- 54 skill(s) match
Orphan mirror directories                  | PASS  no orphan directories found
Meta files in mirror                       | PASS  all 54 managed mirror dirs have meta files
Index up to date                           | PASS  index is up to date -- 54 skill(s) match
Thresholds file                            | PASS  valid -- high=0.85, medium=0.60
------------------------------------------------------------
  5 passed  (5 total)
```

If any check fails, run the diagnostic report for details:

```bash
node bin/skill-router.mjs doctor
```

## Step 3: Explore the Corpus

List all skills grouped by domain:

```bash
node bin/skill-router.mjs list
```

View corpus statistics:

```bash
node bin/skill-router.mjs stats
```

Validate all skills against quality rules:

```bash
node bin/skill-router.mjs validate
```

## Step 4: Run the Benchmark

Verify retrieval accuracy on the built-in test suite:

```bash
node bin/skill-router.mjs benchmark --mode bm25
```

Expected output:

```
Top-1 Accuracy:    96.92%  (126/130)
Recall@3:          89.23%  (116/130)
Median Latency:    2 ms
P95 Latency:       3 ms
No-Skill Rate:     8.46%   (11/130)
```

## Step 5: Sync to ZCode

The install script already synced skills to your ZCode mirror. To sync again after making changes:

```bash
# Preview what would change
node bin/skill-router.mjs sync --dry-run

# Apply changes
node bin/skill-router.mjs sync

# Force overwrite existing skills
node bin/skill-router.mjs sync --force
```

To disable a skill in the mirror (without deleting it from the project):

```bash
# Disable a skill
node bin/skill-router.mjs sync --disable backend-laravel-eloquent

# Re-enable it
node bin/skill-router.mjs sync --enable backend-laravel-eloquent

# Check disabled skills
node bin/skill-router.mjs sources
```

## Step 5: Deploy Router Skills

Router skills are dispatcher skills in `router-skills/` that route explicit `$`-mentions to the correct domain. Deploy them to the ZCode mirror:

```bash
# Preview what would be deployed
node bin/skill-router.mjs deploy --dry-run

# Deploy routers and apply leaf disables
node bin/skill-router.mjs deploy

# Deploy and verify health
node bin/skill-router.mjs deploy --verify
```

## Step 6: Add a New Skill

Write the SKILL.md somewhere outside `data/skills/` and let `add` validate it and
copy it in. Two rules make the difference between a skill that is accepted and one
that is rejected:

- The `domains:` list must name a directory that already exists under
  `data/domains/`. Run `ls data/domains/` to see the registered set; there is no
  `mydomain`.
- The body must be at least 100 tokens. The validator counts the content after
  the frontmatter, so a one-line "your skill content here" placeholder fails.

```bash
# Stage the skill outside the corpus. The domain "testing" is registered.
mkdir -p /tmp/my-skill

cat > /tmp/my-skill/SKILL.md << 'EOF'
---
name: testing-my-skill
description: "Validates that an HTTP client handles retries, timeouts and error responses correctly in integration tests."
keywords:
  - http
  - retries
  - timeouts
  - integration-test
domains:
  - testing
version: 1.0.0
---

# Testing My Skill

Use this skill when you need to write integration tests for an HTTP client.

## Usage

Stub the transport layer, assert on the number of attempts, and assert on the
final error shape. Always assert the timeout budget explicitly, because a test
that only asserts the happy path will pass against a client that never times
out at all. Keep each test focused on a single failure mode so that a red test
names the broken behaviour without needing a debugger.

## Examples

```js
it('retries twice before surfacing the error', async () => {
  const client = new HttpClient({ retries: 2, timeoutMs: 50 });
  await expect(client.get('/flaky')).rejects.toThrow('timeout');
  expect(transport.calls).toBe(3);
});
```
EOF
```

Add it, then reindex:

```bash
# Validate and copy into data/skills/testing/my-skill/
node bin/skill-router.mjs add /tmp/my-skill/SKILL.md

# `add` does NOT reindex for you -- it prints this tip. Run it yourself.
node bin/skill-router.mjs reindex

# Verify
node bin/skill-router.mjs verify
```

See [docs/skill-authoring.md](skill-authoring.md) for the full six-field quality
rules and the pitfall list.

## Step 7: Inspect the Index

View the built BM25 index:

```bash
cat data/skill-index.json | head -50
```

The index is a JSON file with inverted term mappings for fast lexical search. It is regenerated by `reindex` or `build-index`.

## Step 8: Understand the Logs

The router logs all retrieval events to JSONL files:

```bash
# List log files
ls logs/

# View today's logs
cat logs/$(date +%Y-%m-%d).jsonl
```

Analytics summarize these logs:

```bash
# Show usage analytics
node bin/skill-router.mjs analytics

# Last 7 days
node bin/skill-router.mjs analytics --since 7
```

Raw prompts are never logged -- only SHA-256 hashes appear in analytics.

## Key Concepts

### Confidence Bands

BM25 scores are mapped to four confidence bands using thresholds from `data/thresholds.json`:

| Band | Threshold | Behavior |
|------|-----------|----------|
| high | >= 0.85 | Strongly relevant -- shown prominently |
| medium | >= 0.60 | Likely relevant -- included in shortlist |
| low | >= 0.35 | Weakly relevant -- shown only if few results |
| dismiss | < 0.35 | Ignored -- not surfaced |

Thresholds are optimized by the adaptive tuner (`src/tuning/optimizer.mjs`) and can be overridden with `SKILL_ROUTER_HIGH_THRESHOLD` and `SKILL_ROUTER_MEDIUM_THRESHOLD` environment variables.

### Sync vs Mirror

- **Project skills** (`data/skills/`) are the source of truth. Edit these directly.
- **Mirror** (`~/.zcode/skills/`) is a copy managed by the router. Use `sync` to keep them in step.
- **Only mirror directories with `.skill-router-meta.json` are modified** by sync. Your own skills in the mirror are never touched.

### Sources

Skills can come from multiple sources. The default is the project `data/skills/`. A secondary `zcode-user` source can be configured for skills added directly to the mirror. When the same skill name appears in both sources, the project version wins.

View sources:

```bash
node bin/skill-router.mjs sources
```

Reindex with multiple sources:

```bash
node bin/skill-router.mjs reindex --sources all
```

## Two-Mode Routing

The router supports two modes based on whether the prompt contains a `$`-mention:

**Explicit mode** — The prompt contains a `$`-prefixed alias like `$next`, `$laravel`, `$react`, `$design`, `$test`, or `$meta`. The router resolves the alias to a router skill, strips the mention, and scopes BM25 retrieval to that domain only.

```
$next set up ISR for a blog post        → routes to router-next, scores frontend skills
$laravel write a migration              → routes to router-laravel, scores backend skills
$react hooks for state                  → routes to router-react, scores frontend skills
```

**Implicit mode** — No `$` mention. Pure BM25 runs over the leaf-skill corpus (router skills are excluded from lexical ranking).

```
"optimize eager loading in Laravel"     → BM25 ranks backend skills lexically
"React hooks best practices"            → BM25 ranks frontend skills lexically
"how to write tests for API endpoints"  → BM25 ranks testing skills lexically
```

Alias resolution is case-insensitive and follows this priority:
1. Full router name (`$router-next` → `router-next`)
2. Short alias via `src/config/aliases.mjs` (`$next` → `router-next`)
3. Unknown aliases are silently ignored (falls through to implicit mode)

## SLM Experimentation

SLM routing is disabled by default. To experiment with SLM:

```bash
SKILL_ROUTER_SLM_ENABLED=true node hooks/route.mjs
```

Or run the SLM benchmark:

```bash
node tests/slm-benchmark/runner.mjs --mode hybrid --slm
```

See [docs/reports/phase-2-slm-benchmark.md](reports/phase-2-slm-benchmark.md) for benchmark results.

- Read [docs/ai-context.md](ai-context.md) for the full technical architecture.
- Read [docs/cli-reference.md](cli-reference.md) for every CLI subcommand.
- Read [docs/skill-authoring.md](skill-authoring.md) for guidelines on writing high-quality SKILL.md files.
- Check [docs/reports/phase-3-scale-benchmark.md](reports/phase-3-scale-benchmark.md) for scale benchmark details.
- See [docs/implementation-plan.md](implementation-plan.md) for the project roadmap.

## Troubleshooting

### `verify` fails

Run `doctor` to see a full diagnostic:

```bash
node bin/skill-router.mjs doctor
```

### Skills not appearing in ZCode

Run sync with dry-run to see what would change:

```bash
node bin/skill-router.mjs sync --dry-run
```

Then apply:

```bash
node bin/skill-router.mjs sync
```

### Low retrieval accuracy

Check that skills have proper domain prefixes in their names (e.g., `backend-eloquent` not just `eloquent`):

```bash
node bin/skill-router.mjs validate
```

Fix any issues and reindex:

```bash
node bin/skill-router.mjs reindex
```

### Outdated index

Rebuild the index:

```bash
node bin/skill-router.mjs reindex
```

### Cache not helping

The query cache has a 5-minute TTL. Single-run benchmarks will show low hit rates because prompts are not repeated. In production, repeated prompts within 5 minutes will hit the cache.

To measure cache effectiveness in a session:

```bash
node bin/skill-router.mjs benchmark --mode bm25
```

The benchmark reports cache hits, misses, and hit rate.
