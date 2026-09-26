---
name: backend-cache-priming
description: Cache priming strategies for a warmed application tier, covering bulk key warming, TTL staggering, and invalidation ordering so a deploy does not stampede the database
keywords:
  - cache warming
  - cache priming
  - TTL
  - stampede
  - invalidation
domains:
  - backend
  - devops
version: 0.1.0
---

## When to use

Use when a deployment leaves a cold cache and the first requests would otherwise
miss on the database, or when a bulk job needs a known set of keys resident
before it starts issuing work.

## Instructions

1. Collect the key set the request path actually touches.
2. Warm keys in dependency order, hottest key first.
3. Stagger TTLs so keys do not all expire in the same second.
4. Invalidate the reverse of the warm order on rollback.
