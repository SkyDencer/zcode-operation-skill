---
name: performance
description: React performance optimization including memoization, lazy loading, code splitting, virtualization, and profiling with React DevTools
keywords:
  - memoization
  - React.memo
  - lazy loading
  - code splitting
  - virtualization
  - performance
domains:
  - frontend
---

## When to use

Use when diagnosing render performance issues, optimizing bundle size, implementing virtualized lists, or reducing unnecessary re-renders.

## Instructions

1. Wrap expensive components with React.memo
2. Use useMemo and useCallback for derived values
3. Implement React.lazy() for code splitting
4. Use react-window for long list rendering
5. Profile with React DevTools Profiler
