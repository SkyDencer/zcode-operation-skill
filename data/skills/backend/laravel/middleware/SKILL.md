---
name: middleware
description: Laravel HTTP middleware for request filtering, route middleware groups, middleware piping, and creating custom middleware for authentication and rate limiting
keywords:
  - middleware
  - request filtering
  - route middleware
  - middleware groups
  - custom middleware
domains:
  - backend
  - security
---

## When to use

Use when you need to filter HTTP requests, add authentication checks, implement rate limiting, or create reusable request processing layers.

## Instructions

1. Create middleware with make:middleware
2. Handle method for request processing
3. Register in Kernel.php or use anonymous middleware
4. Group middleware for route groups
5. Test middleware with Http facade
