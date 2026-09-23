---
name: router-react
description: Routes React workflow prompts to the appropriate React skill. Use when the user types react or asks about hooks, state management, components, or testing.
allowed-tools:
  - Read
  - Grep
  - Glob
---

# React Router

## When to use
Activate when:
- User explicitly types `react`
- Prompt mentions React Hooks, Context, state management, component patterns, portals, refs, or React testing
- Workflow involves a React project (detected via `package.json` with `react` dependency, no Next.js framework flag)

## Routing table

Read the appropriate leaf skill file based on the task:

| Task type | Read this file |
|-----------|----------------|
| useState, useEffect, useContext, useReducer, custom hooks | <plugin-root>/data/skills/frontend/react/hooks-basics/SKILL.md |
| Context API, providers, consuming context across trees | <plugin-root>/data/skills/frontend/react/context/SKILL.md |
| Forms with React Hook Form, Zod validation, controlled components | <plugin-root>/data/skills/frontend/react/forms/SKILL.md |
| Compound Components, Render Props, Higher-Order Components | <plugin-root>/data/skills/frontend/react/patterns/SKILL.md |
| memo, useMemo, useCallback, virtualization, bundle optimization | <plugin-root>/data/skills/frontend/react/performance/SKILL.md |
| Portals for modals, tooltips, dropdowns escaping parent DOM | <plugin-root>/data/skills/frontend/react/portals/SKILL.md |
| useRef, useImperativeHandle, forwardRef, DOM access | <plugin-root>/data/skills/frontend/react/refs/SKILL.md |
| Zustand, Jotai, Redux, MobX for global state | <plugin-root>/data/skills/frontend/react/state-management/SKILL.md |
| Suspense, lazy loading, error boundaries for data fetching | <plugin-root>/data/skills/frontend/react/suspense/SKILL.md |
| React Testing Library, hook tests, async component tests | <plugin-root>/data/skills/frontend/react/testing/SKILL.md |

## Rules
- Read ONLY the files relevant to the current task. Do not load all files.
- If unsure which file applies, read the one that best matches the prompt's primary verb (e.g., "manage state" → state-management, "build a form" → forms).
- Never modify the leaf skill files.
- If the prompt is about Next.js specifically (App Router, ISR, API Routes), use the Next.js router instead.
