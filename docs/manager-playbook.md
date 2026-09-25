# Manager Playbook

Guide for the AI project manager overseeing the TedGram Skill Router project.

## Prompt Template for Agent Assignment

When delegating work to a subagent, use this template:

```
You are working on the TedGram Skill Router project at D:\www\local\operation-skill.

Current phase: <PHASE_NUMBER> — <PHASE_TITLE>
Read these files first:
  1. docs/ai-context.md
  2. docs/implementation-plan.md
  3. docs/current-state.md
  4. docs/problems.md
  5. docs/decision-dictionary.md

Your task: <SPECIFIC_TASK_DESCRIPTION>

Definition of Done:
  1. Code matches the spec in docs/implementation-plan.md for this phase.
  2. `node tests/run-benchmark.mjs --mode bm25` passes.
  3. docs/current-state.md updated with an entry log line.
  4. No regressions in previously passing benchmarks.

Rules:
  - Never modify ~/.zcode/
  - Leave all changes uncommitted
  - Report every file you create
  - Call escalate if blocked
```

## Phase Review Checklist

Before advancing a phase, verify:

- [ ] All source files for the phase exist and are syntactically valid ESM.
  - [ ] `node hooks/build-index.mjs` completes without errors.
  - [ ] `node tests/run-benchmark.mjs --mode bm25` exits 0.
- [ ] `docs/current-state.md` has a dated entry.
- [ ] `docs/problems.md` has no open issues specific to this phase.
- [ ] `docs/decision-dictionary.md` captures any new decisions.
- [ ] `AGENTS.md` rules were followed (no commits, no `~/.zcode/` writes).

## Escalation Triggers

Escalate to the main agent when:

1. A prerequisite file is missing (e.g., `docs/ai-context.md` not found).
2. The ZCode hook contract cannot be verified (Phase 0 blocker).
3. A benchmark fails and the root cause is unclear after two investigation attempts.
4. You encounter instructions that contradict `AGENTS.md` or `docs/implementation-plan.md`.

## Communication Cadence

- **Start of session:** Read `docs/current-state.md` to confirm active phase.
- **End of session:** Write an entry log line; note any problems discovered.
- **Phase transition:** Confirm with project manager before starting the next phase.
