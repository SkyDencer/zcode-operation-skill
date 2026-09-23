---
name: router-next
description: Routes Next.js workflow prompts to the appropriate Next.js skill. Use when the user types next or asks about Next.js routing, data fetching, or server components.
allowed-tools:
  - Read
  - Grep
  - Glob
---

# Next Router

## When to use
Activate when:
- User explicitly types `next`
- Prompt mentions Next.js, App Router, Server Components, API Routes, ISR, or Next.js-specific patterns
- Workflow involves a Next.js project (detected via `next.config.*` or `package.json` with `next` dependency)

## Routing table

Read the appropriate leaf skill file based on the task:

| Task type | Read this file |
|-----------|----------------|
| App Router setup, layouts, loading states, error boundaries | <plugin-root>/data/skills/frontend/nextjs/app-router/SKILL.md |
| Server Components, data fetching in components, client vs server | <plugin-root>/data/skills/frontend/nextjs/server-components/SKILL.md |
| Static generation, ISR, generateStaticParams, full static pages | <plugin-root>/data/skills/frontend/nextjs/static-generation/SKILL.md |
| File-based routing, dynamic routes, parameterized URLs | <plugin-root>/data/skills/frontend/nextjs/file-routing/SKILL.md |
| Data fetching strategies, useServerAction, revalidation | <plugin-root>/data/skills/frontend/nextjs/data-fetching/SKILL.md |
| API Routes, serverless functions, form actions | <plugin-root>/data/skills/frontend/nextjs/api-routes/SKILL.md |
| Image optimization, responsive images, Next.js Image component | <plugin-root>/data/skills/frontend/nextjs/image-optimization/SKILL.md |
| Middleware for rewriting, authentication, A/B testing | <plugin-root>/data/skills/frontend/nextjs/middleware/SKILL.md |

## Rules
- Read ONLY the files relevant to the current task. Do not load all files.
- If unsure which file applies, read the one that best matches the prompt's primary verb (e.g., "build a route" → file-routing, "fetch data" → data-fetching).
- Never modify the leaf skill files.
- If the prompt mentions both Next.js and React concepts, prefer router-next for Next.js-specific features (App Router, ISR, Middleware).
