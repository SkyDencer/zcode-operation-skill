---
name: router-test
description: Routes testing workflow prompts to the appropriate testing skill. Use when the user types test or asks about TDD, Pest PHP, Vitest, Playwright, or integration testing.
allowed-tools:
  - Read
  - Grep
  - Glob
---

# Test Router

## When to use
Activate when:
- User explicitly types `test`
- Prompt mentions TDD, Pest PHP, Vitest, Playwright, integration testing, unit testing, or test coverage
- Workflow involves writing tests for any language or framework

## Routing table

Read the appropriate leaf skill file based on the task:

| Task type | Read this file |
|-----------|----------------|
| TDD methodology, red-green-refactor cycle, test naming conventions | <plugin-root>/data/skills/testing/tdd-basics/SKILL.md |
| Pest PHP for Laravel — feature tests, unit tests, database assertions | <plugin-root>/data/skills/testing/pest-php/SKILL.md |
| Vitest for Vite projects — unit tests, React component tests, mocks | <plugin-root>/data/skills/testing/vitest/SKILL.md |
| Playwright for end-to-end browser tests, visual regression, automation | <plugin-root>/data/skills/testing/playwright/SKILL.md |
| Integration testing patterns, test databases, mocking external services | <plugin-root>/data/skills/testing/integration-testing/SKILL.md |
| React component testing with React Testing Library, hook tests | <plugin-root>/data/skills/frontend/react/testing/SKILL.md |
| Laravel factory-based test data generation | <plugin-root>/data/skills/backend/laravel/factories/SKILL.md |
| Laravel database seeding for test environments | <plugin-root>/data/skills/backend/laravel/seeding/SKILL.md |

## Rules
- Read ONLY the files relevant to the current task. Do not load all files.
- If unsure which file applies, read the one that best matches the prompt's primary verb (e.g., "write PHPUnit tests" → pest-php, "E2E browser tests" → playwright).
- Never modify the leaf skill files.
- For framework-agnostic testing questions, prefer the TDD basics skill first, then the framework-specific skill.
