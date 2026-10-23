# Phase 7.13 — Security and Hardening Fixes (post-v1.0.0 stabilization)

**Project:** Skill Router (ZCode plugin)
**Date:** 2026-10-22 / 2026-10-23
**Scope:** The Phase 7 pre-tag security blockers named in
`docs/reports/phase-7.11-final-audit.md`, plus the P6-H hardening findings
they cover. This report documents each fix, its rationale, and its tests.
It complements `docs/reports/phase-7-final-summary.md` (sub-phases 7.1-7.12);
the sub-phase numbering here is 7.13 because it postdates the 7.12 release
commit `4e517bf` and the pushed `v1.0.0` tag at `386eb22`.

---

## 1. Commits at a glance

| Commit | Finding | One-line summary |
|--------|---------|------------------|
| `40d368a` | P6-H-003 (privacy) | Raw prompts are no longer persisted — `logRecord()` hashes `query`/`prompt` to SHA-256 at the logger gate |
| `3fd96cb` | 7.11 audit: Security | Hook-supplied `cwd` sanitized; a `..`-bearing or malformed value is rejected, blocking path traversal in `.zcode/output.json` writes |
| `51a2ac1` | 7.11 audit (pre-tag item 4) | `release-check` forwards env to `execFileSync` so the scale-bench wrapper actually receives `PROMPTS_PATH`; archives `logs/.archive-pre-v1/` in `.gitignore` |
| `e26ad6f` | — | Commits the pending Phase 7 working-tree updates (revised final summary, audit reconciliations, refreshed fixtures) so the release tree matches the shipped reports |
| `2391b94` | P6-H-001 | `topK` selection policy: injection capped (default 5, `SKILL_ROUTER_TOPK` clamped 1-20); hybrid path gains the per-skill relevance floor |
| `b6d887e` | P6-H-002 | Context budget is a hard limit: over-budget skills are dropped whole; nothing fits -> reject all, fail open with empty context |
| `f76c6d0` | P6-H-014 | Rollback validates its snapshot before deleting anything; empty/unreadable/drifted snapshots are refused, `--force-rollback` is the explicit override |
| `b03de20` | P6-H-015 | Sync planner classifies read errors: ENOENT = missing, EACCES/EPERM = uncertain (skipped, excluded from removals), other = fatal; >50% unreadable halts the plan |
| `386eb22` + `11ef6b8` | P6-H-016 | The remaining silent `catch { return }` readdir sites fail with named errors instead of poisoning downstream classification |
| `fed254e` | P6-H-020 | `--help`/`-h` on all 19 subcommands, checked before any parsing or side effect |
| `cb3da77` | P6-H-026 | Reranker removed from the default path: off by default, opt-in via `SKILL_ROUTER_RERANKER`, documented as not recommended |
| `6d6f4a8` | P6-H-027 | Personal paths redacted from tracked files; `release-check` leak guard so a reintroduction fails the release gate |

All commits are on `main` ahead of `origin/main` at the time of this report
except `40d368a`-`386eb22`, which were already pushed.

---

## 2. Privacy: raw prompts never reach disk (`40d368a`, P6-H-003)

**The defect.** The structured JSONL logger wrote raw prompt text
(`query`/`prompt` fields) to `logs/YYYY-MM-DD.jsonl` on every
retrieve/route/cache/budget/error event, contradicting the documented
contract "raw prompts are never stored or displayed"
(`docs/ai-context.md`) and the logger's own JSDoc.

**The fix.** `src/core/telemetry/logger.mjs` `logRecord()` now passes every
record through `sanitizeRecord()`, which replaces `query` -> `queryHash` and
`prompt` -> `promptHash` (SHA-256 hex, non-reversible) and deletes the raw
fields before anything reaches disk. The gate sits on the single write path,
so no raw prompt is ever persisted. Consumers were repointed:
`src/analytics/analyzer.mjs` groups by `queryHash` (hashing a legacy raw
`query` for older logs) and its two BM25 re-resolution paths skip
prompt-less entries instead of re-running BM25 on an empty string;
`tests/hooks/perf.test.mjs` and `tests/hooks/implicit-abstention.test.mjs`
match records by `queryHash`. `feedback.mjs` and `session-tracker.mjs`
already hashed prompts and are unchanged.

**Tests.** `tests/telemetry/logger-privacy.test.mjs` (new, 14 assertions):
writes marker-tagged records through every write API and asserts the on-disk
line carries the expected SHA-256 hashes, has no raw field, and that the raw
secret strings are absent from the whole file. Verified: logger-privacy 14/14,
analyzer 71/71, implicit-abstention 25/25, perf 15/15.

## 3. Path traversal in `.zcode/output.json` (`3fd96cb`)

**The defect.** The route hook wrote `.zcode/output.json` to
`join(cwd, '.zcode', 'output.json')` where `cwd` came straight from the
(untrusted) hook stdin payload. A `cwd` containing `..` segments could
escape the workspace and write the file anywhere on disk.

**The fix.** `hooks/route.mjs` adds `sanitizeCwd(rawCwd)`: non-string, empty
values and any value containing a `..` segment are rejected and fall back to
`process.cwd()` (the workspace root, where the hook is legitimate to write
`.zcode/`); clean relative or absolute paths are accepted and resolved. The
`..` check runs on the raw value **before** `resolve()`, because
`resolve('../../x')` still lands somewhere relative to the workspace.

**Tests.** `tests/hooks/perf.test.mjs` (100 spawns) and
`tests/hooks/implicit-abstention.test.mjs` pass with the sanitizer in
place; clean absolute-path `cwd`s are unaffected; the fail-open contract
(exit 0 on any error) is preserved.

## 4. Release-check env forwarding (`51a2ac1`)

**The defect.** The scale-benchmark check in `scripts/release-check.mjs`
spawns an inline ESM wrapper that reads the prompts path from
`process.env.PROMPTS_PATH`, but the `run()` helper built its `execFileSync`
options with only `encoding`/`maxBuffer`/`timeout`/`cwd` and silently dropped
`opts.env`, so `PROMPTS_PATH` never reached the wrapper and the runner fell
back to `DEFAULT_PROMPTS`.

**The fix.** `run()` now forwards env as `{...process.env, ...opts.env}`
(merged, not replaced — replacing would wipe `PATH`). `.gitignore` also
gains `logs/.archive-pre-v1/` so the locally archived telemetry dumps cannot
be staged into a release commit by a `git add -A`.

## 5. Pending working-tree updates (`e26ad6f`)

The Phase 7 workflow (7.4-7.11) left several tracked files modified in the
working tree. This commit lands them so the release tree matches the
shipped reports: the revised `docs/reports/phase-7-final-summary.md`, the
audit reconciliations of the Phase 2/3 benchmark reports, the refreshed
`tests/integration/phase-2-results.json`, and the regenerated scale
prompt/expected sets.

## 6. P6-H hardening fixes

### P6-H-001 — topK selection policy (`2391b94`)

`rankSkills` returns every skill and nothing capped how many were injected,
so a prompt matching many skills could blow the context budget.
`routing.topK` (default 5, `SKILL_ROUTER_TOPK` clamped 1-20 with a stderr
warning) caps injection uniformly after the decision. The hybrid branch
also gained the per-skill relevance floor (it previously padded the
shortlist with below-floor fused rows). Telemetry records the effective
`topK` and `injectedCount`. `tests/hooks/topk.test.mjs` (13 assertions,
real hook spawns). Frozen baseline unchanged: Top-1 0.6462 (84/130).

### P6-H-002 — hard context budget (`b6d887e`)

The over-budget path truncated each skill to an equal quota floored at
`minPerSkill`, and `perSkill * count` was never checked against the total —
injected context could exceed the hard budget and split skills mid-paragraph.
The budget manager now drops whole skills: over budget, skills are kept
greedily in score order; if even the top-scoring skill alone exceeds the
budget, everything is rejected (`selected = []`, `rejected = true`) and the
hook fails open with an empty context. The now-dead truncator module and its
test were removed. `tests/hooks/budget-strict.test.mjs` runs the three
hook-level cases through the real hook.

### P6-H-014 — snapshot-validated rollback (`f76c6d0`)

The rollback delete loop removed every mirror directory not named in the
snapshot, so a corrupt, empty, or stale snapshot became a mass delete of
the operator's live skill mirror. `validateForRollback()` (new
`src/deploy/rollback.mjs`; `writer.mjs` was already over the 400-line cap,
so the gate lives in a self-contained module to avoid an import cycle)
refuses a rollback when the snapshot is missing, not valid JSON,
empty-against-a-live-mirror, or drifted from the files it tracks;
`rollbackMirror`/`restoreFromSnapshot` run the gate first and return a
structured refusal (reasons, 0 deletions). `--force-rollback` bypasses the
gate with a printed warning.
`tests/deploy/rollback-validation.test.mjs` covers valid-proceeds and
missing/drifted/empty-refused cases.

### P6-H-015 — sync permission classification (`b03de20`)

A permission error reading a project SKILL.md was silently treated as "the
skill is absent", so the writer could delete a mirror skill the user still
owns. `planSync` now classifies read errors by `err.code`: ENOENT stays
"missing"; EACCES/EPERM mark the skill uncertain, record it in
`plan.skipped`, and exclude it from mirror-side `remove`; any other code is
fatal and rejects the plan. If more than 50% of the project's skills are
unreadable the whole plan is thrown. The filesystem reader is injectable
(default `fs/promises`) as a test seam.
`tests/sync/permission.test.mjs`: EACCES skipped and excluded from
removals, >50% halts, ENOENT still removed, EIO fatal.

### P6-H-016 — explicit readdir failures (`386eb22`, completed `11ef6b8`)

`386eb22` fixed the analytics/telemetry/deploy-planner/import-scanner
sites and added `tests/core/readdir.test.mjs`; `11ef6b8` completed the pass
over the remaining silent `catch { return }` sites: the sync planner
(`src/sync/planner.mjs` — an unreadable project directory now rejects the
plan instead of planning mirror deletions on an empty index; the >50%
halt of P6-H-015 is what catches it), the four `data/domains` readers
(`src/cli/add.mjs`, `src/core/routing/domain-registry.mjs`,
`src/import/importer.mjs`, `src/quality/validator.mjs` — ENOENT stays
tolerated because the directory is optional, anything else is a named
error), the corpus walk and manifest reader
(`src/corpus/scan.mjs`, `src/corpus/manifest.mjs`), the deploy writer's
`snapshotMirror` (`src/deploy/writer.mjs`), and `src/cli/tune-core.mjs`
`latestSnapshot`. The grep gate (`catch ... return [];` with no
classification) returns nothing. `tests/core/readdir.test.mjs` section 7
adds root-scan cases through the injectable `reader` seam: ENOENT both
roots -> empty plan; EACCES on the project root -> "sync plan rejected";
EACCES on the mirror root -> "cannot read skill directory"; EACCES on a
project subtree -> rejected. 18/18.

### P6-H-020 — `--help` on every subcommand (`fed254e`)

No subcommand inspected `--help`, so unrecognised flags fell through and the
real command ran — `deploy --help` copied routers into the ZCode mirror and
rewrote the hook config. New shared `src/cli/help-text.mjs` (usage text for
all 19 subcommands); each `main()` checks `--help`/`-h` **first** and
returns 0 before any parsing or side effect; `bin/skill-router.mjs` prints
the top-level subcommand list. `tests/cli/help.test.mjs` (83 assertions)
spawns every subcommand in a temp `SKILL_ROUTER_ZCODE_DIR` sandbox and
asserts exit 0, usage text, and unchanged directory state (the deploy case
included: mirror dir stays empty, no new logs or snapshots).

### P6-H-026 — reranker opt-in (`cb3da77`)

The fitted reranker weights have a held-out R² of -4.58 (worse than
predicting the mean on unseen prompts), yet the default routing path
ran the stage. The hook now gates it on `config.reranker.enabled`
(`src/config/defaults.mjs`: `enabled: false, experimental: true`),
overridable via `SKILL_ROUTER_RERANKER=enabled`; when enabled the hook
emits an `experimental_mode` warning plus a telemetry record
(`src/core/embeddings/experimental.mjs` `emitRerankerExperimental`). The
tuning planner (`src/core/routing/planner.mjs`) keeps its own default —
it is an explicit tool, not the routing path. `docs/reranker.md` records
the negative result and how to enable the stage; it is not recommended.
`tests/routing/reranker-optin.test.mjs` (16 assertions): config-layer
env merge, real-hook spawn with the flag on (warning + telemetry, source
guard asserts the hook passes `rerank: rerankerEnabled`), default off.

### P6-H-027 — personal paths in tracked files (`6d6f4a8`)

Host-specific paths under `<user-home>` were reintroduced into tracked
files (12 occurrences in `data/corpus-sources.json` and seven doc files).
All are redacted to `<user-home>` / `<repo-root>` placeholders;
`tmp/check-links.{js,mjs}` use `process.cwd()`. `scripts/release-check.mjs`
gains a leak guard (check 5, `--leak-guard` fast path): it scans every
tracked file for `[cC]:[\\/]Users[\\/]` and fails the release check on a
hit, so a reintroduced path cannot ship again.

---

## 7. Verification

- Frozen BM25 baseline after every commit: Top-1 **0.6462 (84/130)** —
  unchanged (release-check accepts 0.62-0.70).
- `release-check` full run: 5/5 checks PASS (suite, health, benchmark,
  scale bench, leak guard).
- All new test files pass: `logger-privacy` 14/14, `topk` 13/13,
  `budget-strict` (3 hook-level cases), `rollback-validation`,
  `sync/permission`, `readdir` 18/18, `help` 83 assertions,
  `reranker-optin` 16/16.
- Fail-open guarantee preserved: `hooks/route.mjs` exits 0 on every error
  path, including the new `sanitizeCwd` rejection and the reranker warning
  emitter (which never throws).

## 8. Still open (documented, not fixed here)

P6-H-004 through P6-H-025 minus the rows fixed above — including
`P6-H-005` (Windows snapshot paths), `P6-H-007`/`P6-H-011`/`P6-H-017`
(config-source consolidation), `P6-H-010` (symlink containment),
`P6-H-021`/`P6-H-022` (CLI flag gaps) and the medium items — tracked in
`docs/problems.md`. The B1 relevance-floor gap (normalised-maximum
gate) is the dominant remaining retrieval-quality issue.
