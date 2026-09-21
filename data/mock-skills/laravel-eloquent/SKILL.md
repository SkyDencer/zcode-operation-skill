---
name: laravel-eloquent
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

# Laravel Eloquent ORM Patterns

## When to use
Reference this skill when building Laravel data layers, optimizing slow queries, or designing model relationships for maintainable CRUD operations.

## Instructions
1. Always eager load (with) nested relationships to avoid N+1 queries; use loadMissing() for conditional loading.
2. Define query scopes as static methods on models for reusable filters like scopeActive() or scopeRecent().
3. Use chunkById() instead of chunk() for large datasets to prevent primary key gaps from breaking pagination.
4. Implement soft deletes via the SoftDeletes trait and filter out deleted records with withoutTrashed() when needed.
5. Create accessors (getAttributeNameAttribute) and mutators (setNameAttribute) for computed or transformed fields.
6. Batch-create records using createMany() or insert() with arrays to reduce query count on bulk operations.
7. Use lazy loading only when you are certain the dataset is small; prefer explicit with() for clarity.
8. Add casts in the $casts property for datetime, array, boolean, and JSON serialization directly on models.
