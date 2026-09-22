---
name: migrations
description: Laravel database migrations for schema management, blueprint methods, seeders, rolling back changes, and handling production migrations safely
keywords:
  - migrations
  - blueprint
  - schema management
  - seeders
  - rolling back
  - production migrations
domains:
  - backend
  - database
---

## When to use

Use when creating or modifying database tables, managing schema changes across environments, seeding test data, or safely deploying schema updates to production.

## Instructions

1. Use make:migration with --create flag
2. Define columns with appropriate types
3. Add indexes and foreign keys in migration
4. Create corresponding Seeder classes
5. Test rollback before deploying to production
