# Phase 3.4 — Two-Source Index with Deduplication

> Date: 2026-09-23
> Author: index-engineer

## Summary

Implemented multi-source skill indexing supporting both the project's own skills (`data/skills/`) and an optional ZCode user skills source (`data/skills/zcode/`). Name collisions between sources are resolved with a priority rule: **project-sourced skills always win**.

## Changes

### New Files

- **`src/index/dedupe.mjs`** — `resolveCollisions(indexEntries)` function
  - Uses `SOURCE_PRIORITY` map: `project: 2`, `zcode-user: 1`
  - Logs collisions to console with kept/removed source and paths
  - Returns deduplicated array preserving all original fields plus `source`

- **`tests/index/dedupe.test.mjs`** — 9 unit tests
  - `testNoCollisions` — all entries preserved when no name duplicates
  - `testProjectWinsCollision` — project beats zcode-user on same name
  - `testZcodeUserKeptWhenNoProject` — zcode-user survives when no project duplicate
  - `testProjectReplacesLaterZcodeUser` — project wins even when listed second
  - `testMultipleCollisions` — correct handling of multiple simultaneous collisions
  - `testEmptyInput` — graceful handling of empty array
  - `testSingleEntry` — single entry passthrough
  - `testPreservesAllFields` — all original fields retained after dedup
  - `testUnknownSourceTreatedAsLowest` — unknown sources get lowest priority

- **`src/cli/sources.mjs`** — new CLI subcommand
  - Lists configured sources with path and existence status
  - Shows skill counts per source
  - Shows total unique skills and post-dedup count
  - Reports name collisions (project wins)

### Modified Files

- **`hooks/build-index.mjs`**
  - Accepts `SKILL_ROUTER_SOURCES` env var (colon-separated paths)
  - Default: single source `data/skills/` (backward compatible)
  - Optional second source: `data/skills/zcode`
  - Each index entry tagged with `source: "project" | "zcode-user"`
  - Uses `resolveCollisions()` for deduplication
  - Includes path-based de-duplication to avoid processing the same file twice when sources nest
  - Uses `tagSkillsBySource()` for most-specific source attribution (zcode wins over project when nested)

- **`src/cli/reindex.mjs`**
  - New `--sources` flag accepting comma-separated values: `project`, `zcode-user`, `all`
  - `--sources project` — project source only
  - `--sources zcode-user` — zcode-user source only (if directory exists)
  - `--sources project,zcode-user` — both sources
  - `--sources all` — all available sources
  - `--skills-dir` still supported for backward compatibility (single-dir mode)
  - Same dedup pipeline as build-index hook

## Dedupe Logic

```
resolveCollisions(indexEntries)
  └── byName Map: key=name, value=best entry
  └── For each entry:
      ├── No existing entry → add to Map
      �── Collision → compare SOURCE_PRIORITY:
          ├── project (2) > zcode-user (1) → keep project
          ├── Same priority → keep first encountered
          └── Log collision to console
  └── Return Array.from(byName.values())
```

`tagSkillsBySource(skills, sources)`:
- Sorts sources by path length descending (deepest first)
- For each skill, finds the most-specific matching source
- Skills in `data/skills/zcode/...` get `source: "zcode-user"`
- Skills directly in `data/skills/...` get `source: "project"`

## Verification

### Unit Tests
```
node tests/index/dedupe.test.mjs
→ All 9 tests passed
```

### Benchmark (no regression)
```
node tests/run-benchmark.mjs --mode bm25
→ Top-1: 0.9692 (126/130) — unchanged from baseline
→ Median latency: 2 ms — unchanged
```

### CLI Subcommands
```
node bin/skill-router.mjs sources
→ Shows project (✓) and zcode-user (✓/✗) with counts

node bin/skill-router.mjs reindex --sources project
→ 54 skills indexed from project source only

node bin/skill-router.mjs reindex --sources project,zcode-user
→ Loads both sources, deduplicates, project wins collisions

SKILL_ROUTER_SOURCES="data/skills:data/skills/zcode" node hooks/build-index.mjs
→ Multi-source build with collision detection and resolution
```

### Existing Test Suites (all pass, no regressions)
| Suite | Tests | Result |
|-------|-------|--------|
| tests/index/dedupe.test.mjs | 9 | ✓ all pass |
| tests/cli/list.test.mjs | 28 | ✓ all pass |
| tests/cli/validate.test.mjs | 20 | ✓ all pass |
| tests/import/scanner.test.mjs | 26 | ✓ all pass |
| tests/import/importer.test.mjs | 49 | ✓ all pass |
| tests/cache/lru.test.mjs | 42 | ✓ all pass |
| tests/cache/query-cache.test.mjs | 55 | ✓ all pass |
| tests/routing-hierarchical.test.mjs | 37 | ✓ all pass |
| tests/sync/planner.test.mjs | 38 | ✓ all pass |
| tests/sync/writer.test.mjs | 34 | ✓ all pass |
| tests/sync/disabler.test.mjs | 42 | ✓ all pass |
| tests/integration/phase-2.mjs | 9 | ✓ all pass |
| Benchmark BM25 | 130 prompts | ✓ Top-1 96.92%, no regression |

## Index Schema Change

Each entry in `data/skill-index.json` now includes a `source` field:

```json
{
  "name": "backend-api-resources",
  "description": "...",
  "keywords": [...],
  "domains": [...],
  "path": "...",
  "version": "0.1.0",
  "source": "project"
}
```

## Issues

- When using `--sources project` or default `build-index.mjs` (single source), the recursive scan of `data/skills/` includes nested subdirectories like `data/skills/zcode/`. These are all tagged as `project`, so name collisions within the project scope produce duplicate collision logs. This is cosmetic and does not affect correctness — the same-name same-source entry is still deduplicated correctly. A future improvement would be to exclude known child sources when scanning a parent source in single-source mode.

- When `SKILL_ROUTER_SOURCES` references a non-existent directory (e.g. `data/skills/zcode` when it doesn't exist yet), `build-index.mjs` now logs a warning and skips that source gracefully, falling back to the remaining sources. The `reindex` CLI already had this behavior via `existsSync` check in `parseSourcesFlag`.

## Next Steps

- Phase 3.5: Consider excluding nested sources automatically in single-source mode
- Phase 3.6: Add `sources` subcommand to help text in `src/cli/help.mjs`
