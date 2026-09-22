---
name: cache
description: Laravel caching strategies including cache tags, cache locking, Redis integration, cache busting, and multi-layer caching patterns
keywords:
  - caching
  - cache tags
  - Redis
  - cache locking
  - cache busting
domains:
  - backend
---

## When to use

Use when optimizing slow database queries, storing frequently accessed data, implementing distributed locks, or reducing API response times.

## Instructions

1. Use Cache::remember() for auto-expiring cache
2. Implement cache tags for grouped invalidation
3. Use Cache::lock() for distributed locks
4. Configure Redis as cache driver in production
5. Monitor cache hit rates in Telescope
