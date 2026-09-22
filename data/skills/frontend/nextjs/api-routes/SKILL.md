---
name: api-routes
description: Next.js API Routes for serverless functions, request handling, CORS configuration, and middleware integration with API endpoints
keywords:
  - API Routes
  - serverless functions
  - request handling
  - API handlers
  - server actions
domains:
  - frontend
  - api
---

## When to use

Use when creating backend API endpoints in Next.js, handling form submissions server-side, or building serverless functions without external backend.

## Instructions

1. Create routes/app/api/endpoint/route.ts
2. Export GET, POST, PUT, DELETE handlers
3. Return NextResponse for structured replies
4. Handle CORS with response headers
5. Use server actions for mutations
