# AGENTS.md — Mandatory Workflow Rules

These rules apply to every subagent working in this repository.

## Pre-flight Read

Before making any change, every agent MUST read:

1. `docs/ai-context.md` — technical architecture
2. `docs/implementation-plan.md` — current phase and ordering rationale
3. `docs/current-state.md` — latest snapshot and entry log

If any of these files are missing, stop and escalate immediately.

## One Phase at a Time

Work on exactly one phase per session. Do not jump ahead. When a phase is done,
update `docs/current-state.md` and confirm with the project manager before continuing.

## Never Modify ~/.zcode/

This project installs *as* a ZCode plugin but must never alter the global
`~/.zcode/` directory directly. Any ZCode integration must go through the
plugin manifest in `.zcode-plugin/` and the hook contract in `hooks/`.

## Leave Changes Uncommitted

Do not run `git commit`. The project manager controls commits. Push only when
explicitly instructed.

## Use ZCode Subagents

All work within this project should be delegated through ZCode subagents where
possible, not performed as ad-hoc shell commands.

## Definition of Done (per phase)

A phase is complete only when ALL four criteria are met:

1. **Code** — All source files for the phase are written and match the spec in `docs/implementation-plan.md`.
2. **Tests/Benchmark** — The relevant test or benchmark suite passes (`npm run benchmark`).
3. **Docs** — `docs/current-state.md` is updated with an entry log line; any new decisions are recorded in `docs/decision-dictionary.md`.
4. **No regressions** — Previously passing benchmarks still pass after the change.

## File Map

| Path | Purpose |
|---|---|
| `hooks/*.mjs` | ZCode hook entry points |
| `src/index.mjs` | SkillIndex class + BM25 builder |
| `src/retriever.mjs` | Top-k retrieval with confidence scoring |
| `src/scorer.mjs` | BM25 scoring + normalization |
| `src/loader.mjs` | JSON manifest loader |
| `src/logger.mjs` | Structured jsonl logger |
| `tests/*.mjs` | Benchmark and unit test scripts |
| `data/mock-skills/*.json` | Fixture skill manifests |
| `docs/*.md` | Project documentation |
| `.zcode-plugin/plugin.json` | Plugin manifest |
