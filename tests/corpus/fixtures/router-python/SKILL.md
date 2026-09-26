---
name: router-python
description: Dispatching an authoring prompt to the right Python skill by scanning for framework and tooling cues, then scoping retrieval to the matched domain so unrelated prompts abstain instead of guessing
keywords:
  - dispatch
  - routing
  - python
  - domain scoping
  - abstention
domains:
  - meta
  - backend
version: 0.1.0
---

## When to use

Use when a prompt mentions Python tooling and the router must pick between a
fastapi skill, a data-processing skill and an ML skill.

## Instructions

1. Detect the framework or tooling cue in the prompt.
2. Scope retrieval to the matched domain.
3. Abstain when no domain clears the relevance floor.
4. Never widen the scope to compensate for a weak match.
