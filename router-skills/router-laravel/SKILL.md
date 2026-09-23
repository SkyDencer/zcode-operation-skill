---
name: router-laravel
description: Routes Laravel and backend API workflow prompts to the appropriate skill. Use when the user types laravel, asks about Eloquent, migrations, testing, or backend API design.
allowed-tools:
  - Read
  - Grep
  - Glob
---

# Laravel Router

## When to use
Activate when:
- User explicitly types `laravel`
- Prompt mentions Eloquent ORM, migrations, factories, seeding, queues, events, middleware, Sanctum, caching, or task scheduling
- Workflow involves a Laravel project (detected via `composer.json` with `laravel/framework`)
- Prompt asks about backend API conventions, REST design, GraphQL, or versioning

## Routing table

Read the appropriate leaf skill file based on the task:

| Task type | Read this file |
|-----------|----------------|
| **Eloquent ORM** — relationships, query scopes, eager loading, chunking | <plugin-root>/data/skills/backend/laravel/eloquent/SKILL.md |
| **Migrations** — schema changes, blueprints, schema builder | <plugin-root>/data/skills/backend/laravel/migrations/SKILL.md |
| **Factories** — model factories, test data generation, state definitions | <plugin-root>/data/skills/backend/laravel/factories/SKILL.md |
| **Seeding** — database seeding, Faker integration, dev data population | <plugin-root>/data/skills/backend/laravel/seeding/SKILL.md |
| **Middleware** — request filtering, authentication, route middleware | <plugin-root>/data/skills/backend/laravel/middleware/SKILL.md |
| **Queues** — job dispatching, retry logic, rate limiting, workers | <plugin-root>/data/skills/backend/laravel/queues/SKILL.md |
| **Events & Listeners** — decoupled architecture, queued events | <plugin-root>/data/skills/backend/laravel/events-listeners/SKILL.md |
| **Cache** — cache tags, cache locking, cache stores | <plugin-root>/data/skills/backend/laravel/cache/SKILL.md |
| **Pagination** — cursor pagination, simple pagination, API pagination | <plugin-root>/data/skills/backend/laravel/pagination/SKILL.md |
| **Sanctum** — SPA auth, token-based auth, mobile app authentication | <plugin-root>/data/skills/backend/laravel/sanctum/SKILL.md |
| **Validation** — Form Requests, custom rules, validation responses | <plugin-root>/data/skills/backend/laravel/validation/SKILL.md |
| **API Resources** — transforming models to JSON, conditional includes | <plugin-root>/data/skills/backend/laravel/api-resources/SKILL.md |
| **HTTP Client** — outbound API requests, handling responses and errors | <plugin-root>/data/skills/backend/laravel/http-client/SKILL.md |
| **Task Scheduling** — cron configuration, recurring jobs, schedule commands | <plugin-root>/data/skills/backend/laravel/task-scheduling/SKILL.md |
| **Service Container** — dependency injection, binding interfaces, providers | <plugin-root>/data/skills/backend/laravel/service-container/SKILL.md |
| **REST Conventions** — HTTP methods, resource naming, status codes | <plugin-root>/data/skills/backend/api/rest-conventions/SKILL.md |
| **API Errors** — error response formatting, problem details specification | <plugin-root>/data/skills/backend/api/errors/SKILL.md |
| **API Versioning** — URL path versioning, header versioning, deprecation | <plugin-root>/data/skills/backend/api/versioning/SKILL.md |
| **Rate Limiting** — token bucket algorithm, API abuse protection | <plugin-root>/data/skills/backend/api/rate-limiting/SKILL.md |
| **GraphQL Basics** — schema design, resolver patterns, DataLoader | <plugin-root>/data/skills/backend/api/graphql-basics/SKILL.md |

## Rules
- Read ONLY the files relevant to the current task. Do not load all files.
- If unsure which file applies, read the one that best matches the prompt's primary verb (e.g., "query database" → eloquent, "create migration" → migrations).
- Never modify the leaf skill files.
- For general Laravel questions that touch multiple areas, read the most specific skill matching the primary concern.
