---
name: eloquent
description: Advanced Eloquent ORM patterns for Laravel including relationship optimization, query scope building, eager loading, chunking large datasets, and database migration best practices
keywords:
  - Eloquent ORM
  - relationship optimization
  - eager loading
  - query scopes
  - database migration
  - Laravel model
  - ORM query builder
  - soft deletes
  - accessors
  - mutators
domains:
  - backend
  - database
---

## When to use

Use when you need to write efficient database queries in Laravel, build relationships between models, or optimize N+1 query problems. Also apply when creating query scopes, using eager loading, or working with database migrations.

## Instructions

1. Analyze the query pattern and identify N+1 risks
2. Use eager loading with whereHas for filtered relations
3. Build query scopes for reusable filters
4. Add indexes for frequently queried columns
5. Use chunkById for large datasets
