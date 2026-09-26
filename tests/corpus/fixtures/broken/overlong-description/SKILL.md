---
name: backend-overlong-description
description: This description is deliberately longer than the four hundred character ceiling the corpus validator enforces, because a harvested skill often carries an entire abstract or a paragraph of usage prose in the description field instead of the one line summary the retriever scores at double weight, and the retriever cannot rank a field that long or readable, so the validator rejects it before it ever reaches the index and the operator sees the failure here rather than as a silent zero score at query time, which is the whole point of running the corpus gate before an import rather than after it.
keywords:
  - description length
  - corpus gate
  - import validation
domains:
  - backend
version: 0.1.0
---

## When to use

Use when a harvested SKILL.md carries a paragraph in the description field and
you need to know why the import refused it.

## Instructions

1. Measure the description length.
2. Shorten it to one line of between 40 and 400 characters.
3. Re-run the corpus validator.
