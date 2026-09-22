---
name: rate-limiting
description: API rate limiting strategies including token bucket algorithm, sliding window counters, per-user limits, and rate limit response headers
keywords:
  - rate limiting
  - token bucket
  - sliding window
  - API throttling
  - rate limit headers
domains:
  - backend
  - security
---

## When to use

Use when protecting APIs from abuse, implementing usage quotas, preventing brute force attacks, or managing resource-intensive operations.

## Instructions

1. Implement token bucket or sliding window algorithm
2. Return standard rate limit headers (X-RateLimit-*)
3. Apply different limits per user tier
4. Cache rate limit checks for performance
5. Return 429 with Retry-After header on limit exceeded
