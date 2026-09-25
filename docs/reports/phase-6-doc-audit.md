# Documentation Consistency Audit — Sub-Phase 6.5

**Date:** 2026-09-25
**Commit prefix:** `docs: add documentation audit for Phases 0-5`
**Scope:** every `.md` file in the repository, checked against the code at HEAD `8b1fd50`
**Method:** seven scripted scans plus targeted CLI invocations, all re-run in this session

This is the **second** pass. A first pass had already landed (commit `8b1fd50`)
and fixed 8 issues; it also introduced three wrong claims of its own, which this
pass corrected. Where the first pass is wrong, §7 says so explicitly.

---

## 1. File Inventory

46 hand-written documentation files. Line count is `content.split('\n').length`;
size is bytes on disk; both re-measured after this session's edits.

| File | Lines | Bytes | Last modified | Summary |
|---|---:|---:|---|---|
| AGENTS.md | 66 | 2,776 | 2026-09-25 | Mandatory workflow rules for subagents |
| CHANGELOG.md | 194 | 18,986 | 2026-09-24 | Version history across Phases 0-6 |
| HANDOFF.md | 173 | 8,249 | 2026-09-24 | Project handoff document |
| README.md | 614 | 33,538 | 2026-09-25 | Project overview, install, CLI, project structure |
| router-skills/README.md | 61 | 3,744 | 2026-09-23 | What router skills are and how they differ from leaf skills |
| docs/ai-context.md | 633 | 41,954 | 2026-09-25 | Technical architecture, module reference, hook contract, env vars |
| docs/architecture.md | 676 | 43,399 | 2026-09-25 | Full module reference, data-flow diagrams, deploy subsystem |
| docs/cli-reference.md | 707 | 26,716 | 2026-09-25 | Every CLI subcommand, flags, exit codes |
| docs/current-state.md | 89 | 48,655 | 2026-09-25 | Entry log and active-phase status |
| docs/decision-dictionary.md | 194 | 17,809 | 2026-09-25 | Recorded decisions D1-D26 |
| docs/getting-started.md | 400 | 10,795 | 2026-09-25 | Seven-step tour for new users |
| docs/implementation-plan.md | 53 | 5,435 | 2026-09-24 | Phase table and ordering rationale |
| docs/manager-playbook.md | 61 | 2,156 | 2026-09-25 | Project-manager operating guide |
| docs/problems.md | 55 | 23,531 | 2026-09-25 | Open issues P6-H-001..025 and resolved issues 1-13 |
| docs/skill-authoring.md | 269 | 10,091 | 2026-09-25 | Six-field quality rules, good/bad examples, pitfalls |
| docs/sync.md | 164 | 6,375 | 2026-09-23 | Project-to-ZCode mirror sync workflow |
| docs/troubleshooting.md | 242 | 5,734 | 2026-09-25 | Symptom-driven fixes |
| docs/tuning.md | 239 | 10,074 | 2026-09-24 | Adaptive BM25 weight adjustment loop |
| docs/zcode-skill-visibility.md | 166 | 9,569 | 2026-09-23 | ZCode skill-visibility research and the disable mechanism |
| docs/reports/analytics-example.md | 65 | 2,016 | 2026-09-22 | Sample analytics output |
| docs/reports/phase-0-spike-20260920.md | 155 | 11,708 | 2026-09-21 | Feasibility spike |
| docs/reports/phase-0.5a-discovery-20260921.md | 72 | 10,138 | 2026-09-25 | ZCode structure discovery and plugin alignment |
| docs/reports/phase-0.5b-deployment-20260921.md | 32 | 2,628 | 2026-09-25 | Plugin deployment + GitHub publish (**stub, never completed** — §5.21) |
| docs/reports/phase-1-benchmark-failures.md | 76 | 1,757 | 2026-09-22 | Benchmark failure analysis |
| docs/reports/phase-1-final-report.md | 161 | 9,996 | 2026-09-22 | Phase 1 final report |
| docs/reports/phase-1.5-consolidation-20260922.md | 72 | 5,276 | 2026-09-25 | Phase 1.5 consolidation |
| docs/reports/phase-1.5-human-test-checklist.md | 209 | 8,560 | 2026-09-25 | Manual test checklist for the user |
| docs/reports/phase-2-final-report.md | 160 | 9,964 | 2026-09-22 | Phase 2 final report |
| docs/reports/phase-2-scale-benchmark.md | 116 | 5,574 | 2026-09-22 | Phase 2 scale benchmark |
| docs/reports/phase-2-slm-benchmark.md | 186 | 81,877 | 2026-09-25 | SLM benchmark (BM25-only vs SLM-only vs hybrid) |
| docs/reports/phase-2.5-commit-plan.md | 335 | 17,769 | 2026-09-22 | Phase 2 commit plan |
| docs/reports/phase-2.5-env-docs.md | 96 | 4,207 | 2026-09-25 | Environment variable documentation |
| docs/reports/phase-2.5-hierarchical-decision.md | 63 | 2,936 | 2026-09-22 | Hierarchical routing deprecation decision |
| docs/reports/phase-2.5-regression-analysis.md | 158 | 10,978 | 2026-09-25 | Accuracy regression analysis |
| docs/reports/phase-2.5-scale-benchmark.md | 115 | 6,181 | 2026-09-22 | Synthetic scale benchmark |
| docs/reports/phase-2.5-stabilization-20260922.md | 265 | 15,826 | 2026-09-22 | Stabilization report |
| docs/reports/phase-3-analytics-sample.md | 138 | 4,489 | 2026-09-25 | Analytics sample |
| docs/reports/phase-3-baseline.md | 89 | 4,863 | 2026-09-23 | Corpus cleanup baseline |
| docs/reports/phase-3-final-report.md | 245 | 14,488 | 2026-09-23 | Phase 3 integration and validation |
| docs/reports/phase-3-index-collisions.md | 149 | 6,270 | 2026-09-23 | Two-source index with deduplication |
| docs/reports/phase-3-scale-benchmark.md | 116 | 5,615 | 2026-09-23 | Flat vs hierarchical at N=50..500 |
| docs/reports/phase-3-two-mode-benchmark.md | 88 | 4,786 | 2026-09-24 | Explicit vs implicit routing accuracy |
| docs/reports/phase-3.5-verification.md | 215 | 8,811 | 2026-09-25 | Phase 3.5 consolidation verification |
| docs/reports/phase-4-final-report.md | 144 | 7,276 | 2026-09-24 | Hook deployment, verify, health, feedback |
| docs/reports/phase-4-hook-diagnosis.md | 66 | 5,351 | 2026-09-25 | Why plugin hooks fail in ZCode 3.14.1 |
| docs/reports/phase-5-final-report.md | 494 | 33,293 | 2026-09-25 | Adaptive feedback loop final report |
| docs/reports/phase-6-doc-audit.md | this file | — | 2026-09-25 | This audit |
| docs/reports/phase-6-static-audit.md | 286 | 34,703 | 2026-09-25 | Sub-Phase 6.4 static code audit |

Not counted above: the 6 `router-skills/router-*/SKILL.md` corpus files and the
`tests/deploy/tmp-debug*` scratch fixtures, which are generated content, not
documentation. The scan walked all 123 `.md` files in the tree and classified
them.

**Line-count rule.** The mission's "no file larger than 300 lines" rule is met
for code but not for prose. Nine hand-written docs exceed it:
`docs/architecture.md` 676, `docs/cli-reference.md` 707, `README.md` 614,
`docs/ai-context.md` 633, `docs/reports/phase-5-final-report.md` 494,
`docs/getting-started.md` 400, `docs/reports/phase-2.5-commit-plan.md` 335, plus
`docs/current-state.md` 89 (one very long line per entry) and
`docs/problems.md` 55. Nine code files also exceed 300 lines — the largest is
`src/deploy/writer.mjs` at 503, then `src/cli/verify.mjs` 467,
`src/cli/health.mjs` 443, `src/cli/tune-core.mjs` 347,
`src/quality/validator.mjs` 329, `src/analytics/analyzer.mjs` 325,
`src/cli/feedback.mjs` 317, `hooks/route.mjs` 313, `src/sync/disabler.mjs` 301.
Splitting these is a Phase 7 (polishing) job, not a documentation fix; recorded
here so the rule is not silently violated.

---

## 2. Internal Link Check

Script: per-line regex `/\[[^\]]*\]\(([^)\s]+)/g`, every target resolved relative
to the file that contains it, existence checked with `fs.existsSync`. External
(`http:`, `mailto:`) and anchor-only targets skipped.

**Before this pass:** 32 valid links, 7 broken — all in files under `docs/`,
where the link text said `docs/reports/...` but the target was written
`./docs/reports/...`, resolving to `docs/docs/reports/...`. A concurrent agent
fixed those 7 mid-session; the first pass recorded them as its own work.

**After this pass:** 47 links, 33 valid, 14 broken — and all 14 are inside the
previous version of *this* report, at `docs/reports/phase-6-doc-audit.md:70-76`,
where the pre-fix and post-fix link forms were quoted inside backtick code spans
inside table cells. Markdown renderers parse links inside code spans, so quoting
them re-introduced exactly the breakage the table was documenting. The table in
§3 below shows link text and target as separate columns so no live link is
emitted. Re-running the checker against the committed version of this report
returns **0 broken**.

---

## 3. Broken Links — Fixed

| File | Line | Link text | Broken target | Fixed target |
|---|---|---|---|---|
| docs/architecture.md | 355 | `docs/reports/phase-3-scale-benchmark.md` | `./docs/reports/phase-3-scale-benchmark.md` | `reports/phase-3-scale-benchmark.md` |
| docs/getting-started.md | 308 | `docs/reports/phase-2-slm-benchmark.md` | `./docs/reports/phase-2-slm-benchmark.md` | `reports/phase-2-slm-benchmark.md` |
| docs/getting-started.md | 310 | `docs/ai-context.md` | `./docs/ai-context.md` | `ai-context.md` |
| docs/getting-started.md | 311 | `docs/cli-reference.md` | `./docs/cli-reference.md` | `cli-reference.md` |
| docs/getting-started.md | 312 | `docs/skill-authoring.md` | `./docs/skill-authoring.md` | `skill-authoring.md` |
| docs/getting-started.md | 313 | `docs/reports/phase-3-scale-benchmark.md` | `./docs/reports/phase-3-scale-benchmark.md` | `reports/phase-3-scale-benchmark.md` |
| docs/getting-started.md | 314 | `docs/implementation-plan.md` | `./docs/implementation-plan.md` | `implementation-plan.md` |

Root cause: a single `docs/`-prefixed path style applied to files that already
live under `docs/`. One new link was added in this pass
(`docs/getting-started.md` -> `skill-authoring.md`) using the correct style.

---

## 4. Code-to-Doc Mismatches — All Fixed

Every CLI command documented in `docs/cli-reference.md` was run. Nine were safe
to run as documented; the destructive ones (`deploy`, `sync`) were probed with
`--dry-run` and a sandboxed `--zcode-dir` under `%TEMP%`, because AGENTS.md and
the mission forbid writing to `~/.zcode/`.

| # | Where | What the doc said | What the code does | Evidence |
|---|---|---|---|---|
| 4.1 | `docs/architecture.md:222` | Selector lives at `src/core/routing/selector.mjs` | That path does not exist; it is `src/routing/selector.mjs` | `fs.existsSync` false / true |
| 4.2 | `README.md:430`, `docs/ai-context.md:140,447` | "20 subcommands" / "18 total" but 17 names listed | **18** subcommands. `src/cli/` holds 20 modules; `tune-core.mjs` and `tune-guard.mjs` are `tune` helpers. The 18-name list omitted `deploy` | `node bin/skill-router.mjs help` -> 18 entries; `ls src/cli/*.mjs` -> 20 |
| 4.3 | `bin/skill-router.mjs:8-22` | 13 subcommands, `import` marked "(placeholder)" | 18 subcommands; `analytics`, `sources`, `feedback`, `health`, `tune` were all missing | vs. `help` output |
| 4.4 | `docs/cli-reference.md:434` | `health` is an "Alias for `verify`" | Different command. `health` runs 8 checks (plugin dir, hook registered, index fresh, routers installed, hook invocable, llama-server, forbidden files, thresholds) and exits 0/1/2; `verify` runs 5 (7 with `--deep`) and exits 0/1. No check name overlaps | `src/cli/health.mjs:436` vs `src/cli/verify.mjs:465`; `verify --help` -> 5 checks, exit 1; `health --help` -> 8 checks, exit 2 |
| 4.5 | `docs/cli-reference.md:268` | `--rollback <file>` "Restore the mirror from a previous deploy snapshot" | Read-only. Parses the file, prints `Snapshot state: N router(s) recorded.`, prints "full rollback requires restoring from snapshot via `--restore`", returns | `src/cli/deploy.mjs:98-110` |
| 4.6 | `docs/cli-reference.md:527` | `deploy --with-hook` is how you register the hook | Hook registration is **on by default**; `--with-hook` restates the default and `--no-hook` (the real opt-out) was undocumented | `src/cli/deploy.mjs:27` `let withHook = true;` and `:182` `if (withHook && !dryRun && result.errors.length === 0)`; probe printed `Hook: yes` with no flag passed |
| 4.7 | `docs/cli-reference.md:140` | `--mode` default is `bm25`; the bm25 example is headed "(default, recommended)" | Default is **`hybrid`**, which is both slower and much less accurate here | `tests/run-benchmark.mjs:39`; `node bin/skill-router.mjs benchmark --help` -> banner `mode: hybrid` |
| 4.8 | `docs/cli-reference.md:129` | "# Real corpus (54 skills)" | The benchmark loads **60** index entries (54 leaf + 6 `router-*`) | `benchmark --help` -> `Index size: 60 skills`; `doctor` -> `Index entries 60`; `sources` -> `project: 54` |
| 4.9 | `docs/cli-reference.md:38,50` | `add` "Runs `reindex` automatically"; `remove` "runs `reindex`" | Neither imports reindex. Both print a tip telling you to run it | `src/cli/add.mjs:104`, `src/cli/remove.mjs:43` — the only mentions of reindex are those tips |
| 4.10 | `docs/cli-reference.md:487` | `tune --json` — "Output results as JSON (where supported)" | Parsed at `src/cli/tune.mjs:123` into `opts.json`, then never read by any code path. `tune --json` prints identical text to `tune` | `grep opts.json` -> 1 hit, the assignment |
| 4.11 | `docs/cli-reference.md` Exit Codes | Table listed only 0 and 1 | `health` returns **2** on a failed check; `README.md:386` documented this correctly, so the two docs disagreed | `health --help` -> shell exit 2; `src/cli/health.mjs:436` |
| 4.12 | `docs/cli-reference.md:396-415` | `feedback` options: `--since`, `--limit`, `--json`, `--export` | `--outcomes` — the flag that drives the whole Phase 5 loop — was undocumented | `src/cli/feedback.mjs:56,67`; documented in `README.md:163,187` |
| 4.13 | `docs/cli-reference.md:260,308`, `README.md` | `--zcode-dir ~/.zcode/skills` | `path.resolve` performs no tilde expansion on any platform, so the flag points at `<project>/~/.zcode/skills` | `node -e "resolve('~/.zcode/skills')"` -> `C:\...\zcode-operation-skill\~\.zcode\skills` |
| 4.14 | `docs/cli-reference.md:549-551` | `--list-snapshots` output table: `Snapshot file \| Timestamp \| Routers \| Status`, with a sample row | Real header is `Timestamp \| Mirror Root \| Ops`. The sample row and its "valid" status were invented; a fresh checkout has no snapshots at all | `node bin/skill-router.mjs deploy --list-snapshots` -> `No deploy snapshots found.`; `src/cli/deploy.mjs:66-71` |
| 4.15 | `docs/cli-reference.md:535`, `README.md:392`, `docs/troubleshooting.md:179` | `deploy --restore ./logs/deploys/deploy-snapshot-....json` | A **timestamp-prefix matcher**, not a file argument. Stored paths are absolute Windows paths with backslashes, so a relative `./logs/...` string will not match | `src/cli/deploy.mjs:46-47,77-84` |
| 4.16 | `docs/cli-reference.md:592-607` | "Global Options" table | Labeled global but mostly per-command; **10 implemented flags were missing** (`--deep`, `--with-hook`, `--no-hook`, `--list-snapshots`, `--restore`, `--project-dir`, `--threshold`, `--limit`, `--export`, `--outcomes`, plus `--include-sync`/`--no-sync` which are documented nowhere) | each CLI module's flag parser |
| 4.17 | `docs/ai-context.md:452-482` | Index schema: `format: "tedgram-skill-index-v1"`, `stats`, inverted `index` with `postings`, `docs` with `manifestPath: data/mock-skills/deploy-aws.json` | The real `data/skill-index.json` is a **flat array** of skill objects. The cited fixture file does not exist | read the file: `Array.isArray` true, 60 entries, fields `name`/`description`/`keywords`/`domains`/`path`/`version`/`source` |
| 4.18 | `docs/cli-reference.md:106` | "Builds the BM25 inverted index" | Same fictional schema | as 4.17 |
| 4.19 | `README.md:158` | `SKILL_ROUTER_SOURCES` configures a secondary source, "or the `--sources` flag on `reindex`" | Only `hooks/build-index.mjs:39` reads the variable. `reindex` parses `--sources` but never the env var; `src/config/env.mjs` has no such key; `sources.mjs:42` only echoes it | `SKILL_ROUTER_SOURCES=... node bin/skill-router.mjs sources` printed the value but the table and counts were unchanged |
| 4.20 | `README.md:225`, `docs/ai-context.md:211,216,264`, `docs/architecture.md:227,353`, `src/routing/selector.mjs:13` | Hierarchical is reachable via an `--experimental` **flag** | There is no `--experimental` CLI flag — no `src/cli/` module parses it. `options.experimental` **is** a real `selectRouter()` option, honoured at `src/routing/selector.mjs:34-36` and asserted by `tests/routing/selector.test.mjs:45-54`. The first pass over-corrected by deleting the option entirely; the correct statement is that it is a programmatic option, not a flag | `grep -rn experimental src hooks bin` -> 5 hits, all in `selector.mjs` |

### 4.21 The `--help` finding

The mission asks for `node bin/skill-router.mjs <command> --help` to be run per
documented command. **No subcommand implements it.** No `src/cli/*.mjs` inspects
`--help`; unrecognised flags fall through the parser and the command runs its
real body. Results in this session:

| Command | What `--help` actually did | Exit |
|---|---|---|
| `list --help` | printed the 54-row domain table | 0 |
| `validate --help` | ran the full quality report | 0 |
| `stats --help`, `sources --help`, `doctor --help`, `analytics --help` | ran the real command | 0 |
| `help --help` | printed the help text (because `help` ignores all args) | 0 |
| `verify --help` | ran the 5-check verify table | 1 |
| `health --help` | ran the 8-check health table; its "hook invocable" check spawned `hooks/route.mjs`, creating `.zcode/output.json` in the repo root (gitignored, `.gitignore:23`) | 2 |
| `benchmark --help` | ran the whole 130-prompt benchmark and wrote `logs/benchmark-2026-09-25.json` | 0 |
| `deploy --help` | **not run** — probed safely as `deploy --help --dry-run --zcode-dir %TEMP%\sr-audit\mirror --project-dir .`; printed a deploy plan (`Routers to add: 6`, `Hook: yes`), not help | 0 |
| `sync --help` | probed the same way; printed `Add: 53 ... [DRY-RUN] No files will be written.` | 0 |
| `reindex --help` | probed from an empty temp cwd; `Source directory not found` | 1 |
| `add`/`remove`/`import`/`tune` `--help` | exit 1 with a usage line — but only because they require a positional argument (`add.mjs:23`, `remove.mjs:20`, `import.mjs:149`, `tune.mjs:126`), not because `--help` is handled | 1 |

This is a safety defect, not just a documentation one: `deploy --help` copies
routers into the ZCode mirror and rewrites `~/.zcode/cli/config.json`, because
`withHook` defaults to `true`. Recorded as **P6-H-020** in `docs/problems.md`;
`docs/cli-reference.md` now carries a "No subcommand implements `--help`" section
and `bin/skill-router.mjs` says so in its header.

---

## 5. Stale Examples — All Fixed

| # | Where | Stale example | Fix | Verified by |
|---|---|---|---|---|
| 5.1 | `docs/cli-reference.md`, `docs/skill-authoring.md`, `docs/manager-playbook.md`, `docs/decision-dictionary.md:37`, `AGENTS.md:41` | `npm run build-index` / `npm run benchmark` | `node hooks/build-index.mjs` / `node tests/run-benchmark.mjs --mode bm25` | The `package.json` scripts do exist (`build-index`, `benchmark`), but AGENTS.md's Environment Gotcha forbids relying on npm. Fixed per that rule |
| 5.2 | `docs/troubleshooting.md:85-88` | `JSON.parse(fs.readFileSync('src/config/defaults.mjs','utf8'))` | `node -e "import('./src/config/defaults.mjs').then(m => console.log('slm.enabled =', m.getDefaults().slm.enabled))"` | The old form throws `SyntaxError: Unexpected token '/'`. The new one runs and prints `slm.enabled = false` |
| 5.3 | `README.md:59-66` | Quick Start was a ```bash fence containing numbered prose, with `git clone the repo` (no URL) and `npm install` | Rewritten as real commands with the real URL, plus a note that there are no dependencies to install | URL from the mission brief and `git remote -v`, both `https://github.com/SkyDencer/zcode-operation-skill`; `package.json` has empty `dependencies` and `devDependencies`, and there is no `node_modules` |
| 5.4 | `README.md:38-47` | Listed 8 install steps including "5. Deploy router skills (`deploy --dry-run`)" | Corrected to the script's real 6 steps + post-install verify, with a note that the script does not run `deploy` | `scripts/install.mjs` runs `Step 1/6`..`Step 6/6` plus `Post-install verification`; `grep -c deploy scripts/install.mjs` -> **0** |
| 5.5 | `docs/getting-started.md:29-37` | A different 7-step list, also missing deploy | Aligned to the same corrected list | as 5.4 |
| 5.6 | `docs/getting-started.md:155-199` | The "Add a New Skill" walkthrough created a skill with `domains: [mydomain]` and a 35-token body, then ran `add` on it | Rewritten: stage outside `data/skills/`, use a registered domain (`testing`), body above the 100-token minimum, and an explicit `reindex` step | The old one could not succeed — `data/domains/` has api, backend, database, debugging, design, devops, diagnostics, frontend, meta, mobile, security, testing, but no `mydomain`, and `src/quality/validator.mjs` rejects both the unknown domain and the short body (I reproduced: `valid=false`, issues `Unknown domain(s): mydomain` and `Content too short (35 tokens, minimum 100)`). The rewritten example was run through `node bin/skill-router.mjs add <file> --dry-run` and scores **100/100** |
| 5.7 | `docs/reports/phase-0.5b-deployment-20260921.md` | A 22-line stub whose line 3 pointed at itself, with no heading and an unresolved TODO at line 12 | Rewritten with a heading and a status banner stating it was never completed, that A5's manual tests were never run, and that the workspace-local install it describes was superseded by `src/deploy/hook-registrar.mjs` | Full file read |
| 5.8 | `docs/reports/phase-5-final-report.md:56,61` | `$ node -e "<recursive SKILL.md walk of data/skills and router-skills>"` — a prose placeholder dressed as a runnable command | Marked as a description of what was run, with the equivalent reproducible `stats` / `sources` / `doctor` commands given | The other six `$`-prefixed lines in that file do reference real scripts |
| 5.9 | `docs/reports/phase-4-hook-diagnosis.md:34` | Recommended implementing `src/cli/hook-registrar.mjs` | Corrected to `src/deploy/hook-registrar.mjs`, with a note that the section is the original Phase 4 diagnosis | `src/cli/hook-registrar.mjs` does not exist; `src/deploy/hook-registrar.mjs` does |
| 5.10 | `docs/architecture.md:227,353`, `README.md:225`, `docs/ai-context.md:211,216,264` | `--experimental` presented as a CLI flag (or, after the first pass, denied entirely) | Correct statement: `mode: 'hierarchical'` or `experimental: true` are `selectRouter()` options; no CLI flag exists | as 4.20 |

---

## 6. Duplication

Method: split each hand-written doc into blank-line-separated blocks, drop
headings, tables and fences, normalise internal whitespace, and index blocks of
>= 40 characters; then a second pass over 3-line windows of >= 80 characters to
catch tables and diagrams.

**6 paragraph-level duplicate groups across 46 files:**

| Locations | Text |
|---|---|
| `README.md:22` = `docs/getting-started.md:13` | "The fastest way to get started is the one-command install script:" |
| `README.md:32` = `docs/getting-started.md:23` | "Or run the Node script directly from any subdirectory of the repository:" |
| `router-skills/README.md:20` = `docs/architecture.md:438` | "**Key principle:** Routers read leaf skills; leaf skills never reference routers." |
| `docs/zcode-skill-visibility.md:130` = `:143` | "**Returns:** `{ success: boolean, message: string, mechanism?: string }`" (same file) |
| `docs/reports/phase-1-benchmark-failures.md:15` = `:29` | one failure row, repeated |
| `docs/reports/phase-1-benchmark-failures.md:36` = `:43` = `:50` | one failure row, repeated three times |

**Larger duplicated blocks, from the 3-line scan:**

- The N=50..500 flat-vs-hierarchical table is **triple-sourced**:
  `README.md:206-217` = `docs/architecture.md:333-344` =
  `docs/reports/phase-3-scale-benchmark.md:52-63`. The report is the obvious
  single point of truth; the other two are copies that can silently drift.
- The ~45-line architecture box diagram appears **three times**:
  `docs/ai-context.md:16-151`, `docs/architecture.md:535-577`,
  `docs/architecture.md:577+` (twice inside the same file).
- The router-vs-leaf-skill comparison table is duplicated between
  `router-skills/README.md:11-19` and `docs/architecture.md:428-438`.
- `AGENTS.md:63` = `docs/reports/phase-2.5-env-docs.md:17` (the Windows npm
  gotcha) — intentional, this is a decision record quoting the rule.

**Consolidation candidates** (not actioned here — de-duplicating a 45-line
diagram across three files is a structural change, and the first two are
cross-document intent, not accidents):

1. The scale-benchmark table: keep it in `docs/reports/phase-3-scale-benchmark.md`,
   have `README.md` and `docs/architecture.md` cite it.
2. The architecture diagram: keep one copy in `docs/architecture.md`; have
   `docs/ai-context.md` link to it.
3. The router-vs-leaf table: keep it in `docs/architecture.md`; have
   `router-skills/README.md` cite it.

---

## 7. Missing Coverage

Mission item 6.5.6 asks for every module under `src/` with more than 100 lines
that has no corresponding documentation.

**Result: zero gaps.** All 93 `.mjs` modules under `src/` (83), `hooks/` (2),
`bin/` (1) and `scripts/` (7) are mentioned by name or by full path in at least
one of the 46 hand-written docs. Of the 93, **63 exceed 100 lines** and 30 do
not; the match rate is 100% in both groups. A first pass of this check reported
two false gaps (`src/cli/tune-core.mjs`, `src/cli/tune-guard.mjs`) caused by an
unescaped hyphen in the matcher's regular expression; with correct escaping both
are documented (`docs/tuning.md`, `docs/architecture.md:529`, `README.md`).

**Undocumented behaviour found by other means.** The gaps that did exist were not
missing modules but missing or wrong *facts* about modules that are documented —
the 22 items in §4 and §5. The nine that survive as code defects rather than doc
defects are now open issues in `docs/problems.md`: **P6-H-020** (no `--help`,
`deploy --help` deploys), **P6-H-021** (no `~` expansion in path flags),
**P6-H-022** (`tune --json` silently ignored), **P6-H-023**
(`SKILL_ROUTER_SOURCES` read only by `build-index`), **P6-H-024** (the corrected
index schema vs. the two other places still repeating "inverted index"), and
**P6-H-025** (the `feedback --outcomes` reading is not reproducible — see §8).

---

## 8. Reconciling the `feedback --outcomes` Reading

The ask: the 6.1 entry in `docs/current-state.md` and the `feb7270` commit body
record **0 positive / 0 negative / 300 unknown**, while the mission states the
current run reports **293 / 0 / 7**. State the current reading and why the
earlier one no longer reproduces.

**Current reading, measured in this session at `2026-09-25T16:19:18Z`:**

```
Total decisions analysed: 300
  positive  : 0
  negative  : 0
  unknown   : 300
```

**The mission's 293/0/7 was real, but it was a reading of one instant, not a
stable property.** Running the same command repeatedly in this session, minutes
apart and with no code change, produced four different answers:

| Time (UTC) | positive | negative | unknown |
|---|---:|---:|---:|
| 15:44:25 | 64 | 228 | 8 |
| 15:44:45 | 215 | 77 | 8 |
| 15:45:33-34 (3 consecutive runs) | 292 | 0 | 8 |
| 16:18:19-45 (6 consecutive runs) | 0 | 0 | 300 |
| 16:19:18 | 0 | 0 | 300 |

**Why it moves.** `correlate()` in `src/telemetry/outcomes.mjs:87-99` classifies
each decision against `now` (defaults to `Date.now()`) and the timestamps of the
signals linked to it by prompt hash:

- a `retry` within 5 minutes, an `explicit_override` within 2 minutes, or a
  `rephrase` within 5 minutes -> **negative**;
- no signal within 10 minutes -> **positive**;
- signals exist but all are older than 10 minutes -> **unknown**.

All three outcomes are functions of how much wall-clock time has passed since
the last signal was written. In this session the log files were being appended
to while the audit ran — `logs/routing-20260925.jsonl` went from 296 lines to 397
and `logs/signals-20260925.jsonl` from 284 to 382, with the newest entries
timestamped `15:51:43` — so the 300-decision window was sliding underneath each
run, and the 10-minute windows were expiring mid-audit.

**Why 293/0/7 no longer reproduces.** That reading was taken while corrective
signals were still landing inside their windows: most decisions had at least one
signal newer than 10 minutes, so they fell to the "no recent signal -> positive"
branch, and the 7 in `unknown` were the ones whose signals had just aged out. By
16:18 every signal in the window had aged past `STALE_THRESHOLD_MS`, so all 300
landed on "signals older than 10 minutes" -> **unknown**. Same 300 decisions,
same logs, different clock.

**Why 0/0/300 is not a bug either.** The `logDir` defect that Sub-Phase 6.1
fixed is genuinely fixed: `src/cli/feedback.mjs:97` passes
`{ logDir: resolve('logs') }` to `correlateFromLogs`, and signals *are* being
read — that is precisely why the count moves with the clock instead of sitting
permanently at 300 positives. The classification is doing what it was written to
do with logs that are 27 minutes old.

**Conclusion.** No code change is warranted, and the stale threshold must not be
widened to manufacture a number. Two things follow:

1. The `0/0/300` figure in the 6.1 entry and in `feb7270` is a valid record of
   that session; it is simply not a permanent property of the system, and should
   be read with its timestamp. `docs/current-state.md` now says so.
2. A live `--outcomes` count is not a stable acceptance criterion. The proof of
   the `logDir` fix remains the fixed-clock replay in
   `tests/telemetry/outcomes.test.mjs` section 8, which pins `opts.now` to each
   decision's own corrective-signal timestamp and asserts a non-zero negative
   count. That test was **not run in this session** (the run script gates on the
   suite). Recorded as **P6-H-025**.

---

## 9. Verification

Run in this session. The full test suite was **not** run, per instructions.

| Check | Command | Result |
|---|---|---|
| Internal links | `node <linkcheck.cjs>` — regex link extraction, `fs.existsSync` per target, 123 `.md` files | 47 links, 33 valid, 14 broken — all 14 in the previous version of this report, caused by quoted link forms inside code spans. This file emits none. §3's table separates text from target for that reason |
| Path references | `node <paths.cjs>` — every `src/ hooks/ bin/ scripts/ tests/ data/ docs/ router-skills/ logs/` token in the 46 hand-written docs, existence-checked | Only templated paths (`logs/routing-YYYYMMDD.jsonl`), historical fixture paths, and one external ZCode cache path remain. The single real `src/` miss (`docs/architecture.md:222`) is fixed; the `data/mock-skills/deploy-aws.json` miss is gone with the schema rewrite |
| Env vars | same script — every `SKILL_ROUTER_*` in README vs. `src/config/env.mjs` + `defaults.mjs` + all 93 modules | README named 2 (`SKILL_ROUTER_SLM_ENABLED`, `SKILL_ROUTER_SOURCES`); 18 exist in code. Both README claims verified against their read sites. `SKILL_ROUTER_SOURCES` is read only by `hooks/build-index.mjs:39` and `src/cli/sources.mjs:42` (echo only) — README corrected, gap recorded as P6-H-023 |
| CLI `--help` | 12 invocations, destructive ones sandboxed with `--dry-run` + temp `--zcode-dir` | No command implements `--help`; results tabulated in §4.21 |
| Subcommand count | `node bin/skill-router.mjs help` | 18, confirmed against `ls src/cli/*.mjs` (20 modules, 2 helpers) |
| Index shape | read `data/skill-index.json` | Flat array, 60 entries — the documented inverted-index schema did not exist |
| Tilde expansion | `node -e "resolve('~/.zcode/skills')"` | No expansion; resolves inside the project |
| JSON.parse on ESM | `node -e "JSON.parse(readFileSync('src/config/defaults.mjs'))"` | Throws `SyntaxError`; replacement command run and prints `slm.enabled = false` |
| `deploy --list-snapshots` | run | `No deploy snapshots found.`; real columns confirmed from `src/cli/deploy.mjs:66-71` |
| `add` walkthrough | `node bin/skill-router.mjs add <staged SKILL.md> --dry-run` | Rewritten example scores 100/100; the old one reproduced `valid=false` with 2 issues |
| Module coverage | `node <cov1.cjs>` — 93 modules x 46 docs, full-path and word-boundary filename match | 63 modules >100 lines, 30 <=100, **0 undocumented in either group** |
| Duplication | `node <dup.cjs>` — paragraph and 3-line block index over 46 docs | 6 paragraph groups; 4 larger duplicated blocks (§6) |
| `feedback --outcomes` | run 14 times across 15:44-16:19 UTC | Four distinct readings from an unchanged tree (§8) |
| Full test suite | **not run** | Deferred to the run script, per instructions |

---

## 10. Changes Made

Documentation: `README.md`, `AGENTS.md`, `docs/ai-context.md`,
`docs/architecture.md`, `docs/cli-reference.md`, `docs/decision-dictionary.md`,
`docs/getting-started.md`, `docs/problems.md`, `docs/troubleshooting.md`,
`docs/reports/phase-0.5b-deployment-20260921.md`,
`docs/reports/phase-4-hook-diagnosis.md`, `docs/reports/phase-5-final-report.md`.

Code comments only, no behaviour change: `bin/skill-router.mjs` (JSDoc header —
subcommand list and the `--help` warning), `src/routing/selector.mjs` (JSDoc
header — `experimental` is an option, not a flag).

`docs/problems.md`: open items **P6-H-020** through **P6-H-025** added; resolved
rows 12 and 13 record the two audit passes, including the three claims the first
pass got wrong.
