---
name: frontend-streaming-ssr
description: Streaming server-side rendering patterns that flush early, suspend slow subtrees instead of blocking the shell, and keep hydration deterministic across partial responses
keywords:
  - streaming SSR
  - suspense boundary
  - hydration
  - server components
  - flush
domains:
  - frontend
version: 0.1.0
---

## When to use

Use when the first byte of a server-rendered page is delayed by one slow
component and the shell itself could be interactive sooner.

## Instructions

1. Render the shell first and flush it.
2. Suspend slow subtrees behind boundaries.
3. Keep hydration input identical on both passes.
4. Measure time to first byte, not just total render time.
