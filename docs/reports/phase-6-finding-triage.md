# Phase 6 Finding Triage — What Blocks a Release

<!--
  Purpose: answer the question `docs/reports/phase-6-final-report.md` §8.1
  raises but does not answer — of the 27 open findings in `docs/problems.md`,
  which must be closed before this plugin ships, and which can ship with a
  caveat.
  Sources: `docs/problems.md` (the finding text and severity), the final
  report's §8 and §9, and the checks recorded in the per-sub-phase entries of
  `docs/current-state.md`.
  Not a re-audit: only the findings marked "checked in this pass" below were
  re-read against the shipping tree. Every other row is a prioritisation of the
  finding's own text, and its line references may be stale.
  Author: Sub-Phase 6.12 revision pass, 2026-09-26.
-->

## Scope and honesty note

`docs/problems.md` carries 27 open rows, `P6-H-001`–`P6-H-027`, contiguous, all
status `Open`: 21 High, 6 Medium (the Medium rows are counted inside the same
ID range). Nothing here changes a status in `docs/problems.md`; closing one is a
code change plus a status edit, not a documentation act.

The three findings Phase 6.7–6.12 most plausibly superseded are flagged
**"checked in this pass"** with the evidence. Everything else is ranked from the
finding text alone. Treat a row as a hypothesis to confirm before scheduling
against it.

## Tier 1 — release-blocking (6)

These either destroy user data silently, or ship a documented promise the code
breaks. The first three were already named in the final report's Phase 7
recommendation; the next three were not ranked anywhere.

| ID | Why it blocks | Evidence |
|---|---|---|
| `P6-H-015` | An unreadable project tree makes the sync planner classify **every** mirror skill as `remove`. One permissions error becomes a mass deletion. | `docs/problems.md`: `src/sync/planner.mjs:66-71` swallows `readdir` errors and returns an empty project index |
| `P6-H-014` | `rollbackMirror()` trusts a snapshot the scan may never have produced, so a rollback deletes against an empty reference set. | `docs/problems.md`: `src/deploy/writer.mjs:110-143` wraps the mirror scan in `catch {}` and writes the snapshot unconditionally |
| `P6-H-016` | Any non-`ENOENT` read error marks the **whole** outcome corpus `positive`, so the adaptation loop learns from a fabrication. | `docs/problems.md`: `src/telemetry/outcomes.mjs:132-155` catches every read error under a comment that only an absent directory is expected |
| `P6-H-003` | Raw prompts are written to logs, which **contradicts the privacy invariant in `docs/ai-context.md`**. A doc/code contradiction on personal data is a release blocker for a public repo, independent of severity. | `docs/problems.md`: `hooks/route.mjs:192,202,214,271`, `src/telemetry/session-tracker.mjs:118` |
| `P6-H-010` | The symlink-containment checks are dead code, so the path-traversal hardening fixed in 6.1 is bypassable through a symlink. The two security regressions in Part A of the final report are only as strong as this. | `docs/problems.md`: `src/sync/planner.mjs:81-100`, `src/import/scanner.mjs:105-108`, `src/cli/import.mjs:33-38` use `stat()` (follows links) then test `isSymbolicLink()` |
| `P6-H-020` | `deploy --help` deploys and rewrites `~/.zcode/cli/config.json` with hook registration on by default. A help flag that mutates global state is a footgun with no opt-out a user can discover. | `docs/problems.md`: no `src/cli/*.mjs` inspects `--help`; `src/cli/deploy.mjs:27` defaults registration on |

## Tier 2 — ship with a documented caveat (9)

Real defects, none of which destroys data on its own. Each needs a line in the
user-facing docs before the plugin is considered safe to hand to someone else.

| ID | Caveat to publish |
|---|---|
| `P6-H-002` | The context budget can be exceeded by design (`max(quota, minPerSkill)`); the final report's own log line recorded `injectedChars: 24972` against a smaller cap. |
| `P6-H-005` | Deploy snapshot/rollback is broken on Windows separators — i.e. on the platform this project is developed and run on. Do not advertise rollback as working. |
| `P6-H-006` | `feedback --outcomes` attribution is structurally dead: decisions persist `promptHash`, the CLI needs `prompt`. Pairs with `P6-H-025`. |
| `P6-H-026` | The reranker's weights do not generalise (held-out R² −4.58 against in-sample 0.079). `--rerank on` is off by default; keep it that way and say so. |
| `P6-H-007`, `P6-H-017` | Documented env overrides that do not reach the code (`SKILL_ROUTER_BM25_*`, `SKILL_ROUTER_SLM_ENABLED`). The flags read as supported and silently do nothing. |
| `P6-H-021`, `P6-H-022`, `P6-H-023` | `--zcode-dir`/`--skills-dir` do not expand `~`; `tune --json` is accepted and ignored; `SKILL_ROUTER_SOURCES` is honoured by one of its two readers. Documented surface that does nothing. |
| `P6-H-025` | The live `feedback --outcomes` number is a function of the clock, so it is not a stable acceptance criterion and must not be quoted as one. |

## Tier 3 — defer, with a tracked reason (12)

Not user-visible on the shipped path. Deferring is a decision, not an oversight;
each has a destination in the final report's Phase 7 recommendation.

| ID | Why defer | Destination |
|---|---|---|
| `P6-H-001` | **Partly superseded, checked in this pass.** The "no score floor" half was fixed by the 6.9 review's finding B1: `hooks/route.mjs:183` computes `minBm25Score` (0.35) and every ranked list is filtered by it (`:197`, `:204`, `:232`). The "no `topK`" half still stands in the sense that there is no explicit count cap — the selection is bounded by the budget manager (`fitWithinBudget`, `hooks/route.mjs:344`) rather than by a top-k. Split the row rather than closing it. | Re-scope and re-rate |
| `P6-H-004` | **Line reference stale, checked in this pass.** The finding cites `tests/run-benchmark.mjs:38` defaulting to `hybrid`; that line is now a report-path assignment and 6.10 changed the flag handling. Whether the default still contradicts `data/baseline.json` was **not** re-verified. | Re-verify, then close or re-file |
| `P6-H-008`, `P6-H-009` | cwd-relative data paths and absolute personal paths in the generated index. Non-portable, not dangerous on a single machine. | 6.4-repair style: one `resolveRoot()` helper |
| `P6-H-011` | `mergeWithEnv` can turn a scalar into an array on a comma-containing env value. Needs a malformed input to trigger. | Config hardening |
| `P6-H-012` | `RoutePlan.mode` emits `bm25`/`none`/`explicit` against a documented union. A contract drift, not a behaviour bug. | Doc or type fix |
| `P6-H-013` | The query cache can never hit in production because a fresh `QueryCache` is built per hook process. Telemetry lies; performance does not. | Telemetry accuracy |
| `P6-H-018` | **Checked in this pass.** `src/analytics/analyzer.mjs:18` still imports `../retriever.mjs`, so the analytics CLI's `top10Skills` uses a different scorer than the live hook. Deleting it is an analytics change, not dead-code removal — see final report §9.6. | 6.9 — one commit, one caller |
| `P6-H-019` | **Checked in this pass.** `src/logger.mjs` is still fully orphaned. This is the *only* one of the six unreachable modules the final report can honestly claim to retire. | Delete |
| `P6-H-024` | The fictional inverted-index schema. Already corrected in 6.5's documentation pass; the row was never closed. | Verify, then close |
| `P6-H-027` | A tracked report reintroduces a personal path after the 6.3 redaction. | Re-redact and add a generator guard |

## Answers to three questions this file exists to settle

**"Should I ship this?"** Not before Tier 1. Five of the six are single-site
fixes with a characterisation test already written (the 6.11 audit inverted
`P6-H-014`, `P6-H-015` and `P6-H-016` deliberately so they could be flipped).
The sixth, `P6-H-003`, is a logging change plus a doc change.

**"Does the 200 ms / 3500 ms discrepancy mean ONNX is actually safe to enable?"**
No, and the two numbers are not in conflict. `src/config/defaults.mjs:153`'s
`hook.timeoutMs: 200` is the **internal race timer** consumed at
`hooks/route.mjs:36,199`; `hooks/hooks.json:12` registers the hook with
**`timeoutMs: 3500`**. A 1212 ms ONNX median fits inside 3500 ms but not inside
200 ms, and the guard at `hooks/route.mjs:196-201` fires on the 200 ms timer,
degrading to `rankSkills()` at `:203-205`. So ONNX is *latency-safe* for the hook
and *accuracy-negative* against the shipped BM25 configuration (Set Recall@5
0.9052 against 1.0000). Enabling it costs accuracy, not availability.

**"Where is the 35 MB stale `model.onnx.tmp.*` and should I delete it?"**
`node_modules/@huggingface/transformers/.cache/Xenova/all-MiniLM-L6-v2/onnx/model.onnx.tmp.11568.v47mjq`,
36,658,315 bytes, written 2026-09-25 23:15. It lives under `node_modules`, is
untracked by git, and is safe to delete; the live `model.onnx` is a separate
file. The phase does not delete it because it is a developer's local install
artefact, not repository state.
