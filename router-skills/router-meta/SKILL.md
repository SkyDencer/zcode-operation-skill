---
name: router-meta
description: Routes meta-workflow prompts to the appropriate meta skill. Use when the user types meta or asks about architecture, code review, documentation, refactoring, or debugging.
allowed-tools:
  - Read
  - Grep
  - Glob
---

# Meta Router

## When to use
Activate when:
- User explicitly types `meta`
- Prompt mentions software architecture, design patterns, code review, documentation, refactoring, or systematic debugging
- Workflow involves cross-cutting concerns that are not tied to a specific framework

## Routing table

Read the appropriate leaf skill file based on the task:

| Task type | Read this file |
|-----------|----------------|
| MVC, layered architecture, event-driven design, microservices, ADRs | <plugin-root>/data/skills/meta/architecture/SKILL.md |
| Pull request review checklists, security review, consistency checks | <plugin-root>/data/skills/meta/code-review/SKILL.md |
| README structure, API references, changelogs, onboarding docs | <plugin-root>/data/skills/meta/documentation/SKILL.md |
| Extracting functions, reducing complexity, eliminating duplication | <plugin-root>/data/skills/meta/refactoring/SKILL.md |
| Stack trace analysis, memory leak detection, systematic debugging | <plugin-root>/data/skills/meta/debugging/SKILL.md |

## Rules
- Read ONLY the files relevant to the current task. Do not load all files.
- If unsure which file applies, read the one that best matches the prompt's primary verb (e.g., "review code" → code-review, "document API" → documentation).
- Never modify the leaf skill files.
- For questions spanning multiple meta areas (e.g., "architect and document a new service"), read the most relevant single skill and note that additional skills may apply.
