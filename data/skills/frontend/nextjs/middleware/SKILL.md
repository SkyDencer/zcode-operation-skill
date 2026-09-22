---
name: nextjs-middleware
description: Next.js middleware for request rewriting, authentication checks, A/B testing, and edge runtime optimizations
keywords:
  - middleware
  - request rewriting
  - authentication
  - A/B testing
  - edge runtime
domains:
  - frontend
  - security
---

## When to use

Use when implementing route protection, A/B testing experiments, request rewriting, or geo-based routing without server-side logic.

## Instructions

1. Create middleware.ts in project root
2. Match routes with matcher config
3. Use NextResponse.rewrite() for routing
4. Check authentication tokens in middleware
5. Deploy to Edge Runtime for performance
