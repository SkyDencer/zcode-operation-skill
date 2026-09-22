---
name: suspense
description: React Suspense for data fetching, lazy component loading, error boundaries, and streaming SSR with concurrent features
keywords:
  - Suspense
  - lazy loading
  - error boundaries
  - concurrent features
  - streaming SSR
domains:
  - frontend
---

## When to use

Use when implementing lazy-loaded components, suspense-based data fetching, or graceful fallback UI during asynchronous operations.

## Instructions

1. Wrap lazy imports with React.lazy()
2. Provide fallback UI with Suspense boundary
3. Use ErrorBoundary for error handling
4. Implement useSuspenseQuery for data fetching
5. Combine with concurrent mode features
