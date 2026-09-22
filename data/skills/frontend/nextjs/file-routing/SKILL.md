---
name: file-routing
description: Next.js file-based routing conventions, dynamic routes with [slug], catch-all routes with [...slug], and route segments
keywords:
  - file routing
  - dynamic routes
  - catch-all routes
  - route segments
  - [slug]
domains:
  - frontend
---

## When to use

Use when defining URL routes by file structure, creating dynamic pages from URL parameters, or implementing catch-all routes for nested content.

## Instructions

1. Create page.tsx for each route
2. Use [id].tsx for dynamic segments
3. Use [...slug].tsx for catch-all routes
4. Access params in page component
5. Organize route groups with ()
