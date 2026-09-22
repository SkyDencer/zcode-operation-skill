---
name: pagination
description: Laravel pagination patterns including cursor pagination, simple pagination, lazy loading with cursor, and custom pagination UI components
keywords:
  - pagination
  - cursor pagination
  - simple pagination
  - lazy loading
  - paginated responses
  - API pagination
domains:
  - backend
---

## When to use

Use when displaying large datasets in tables or lists, building paginated APIs, or optimizing performance for pages with many records.

## Instructions

1. Use simplePaginate() for basic two-page navigation
2. Use paginate() with custom per-page counts
3. Use cursorPaginate() for large datasets
4. Return paginated responses with meta data
5. Implement infinite scroll with cursor tokens
