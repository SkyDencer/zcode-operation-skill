---
name: server-components
description: React Server Components in Next.js, data fetching patterns, client interaction, and the server-client component boundary
keywords:
  - Server Components
  - RSC
  - data fetching
  - client components
  - use client
domains:
  - frontend
---

## When to use

Use when fetching data directly in components, reducing client-side JavaScript bundle, or optimizing performance with server-rendered components.

## Instructions

1. Components are server by default in App Router
2. Use "use client" for interactive components
3. Fetch data directly in server components
4. Pass data as props to client components
5. Keep client components minimal
