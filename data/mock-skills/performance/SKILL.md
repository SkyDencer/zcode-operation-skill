---
name: performance
description: Web application performance optimization including Core Web Vitals improvement, bundle splitting, lazy loading, caching strategies, and runtime profiling for fast user experiences
keywords:
  - Core Web Vitals
  - bundle splitting
  - lazy loading
  - caching strategy
  - Lighthouse
  - runtime profiling
  - render optimization
  - code splitting
  - image optimization
  - latency reduction
domains:
  - frontend
  - performance
---

# Web Performance Optimization

## When to use
Use this skill when diagnosing slow page loads, high CLS/LCP scores, large bundle sizes, or poor runtime performance in production web applications.

## Instructions
1. Measure baseline performance with Lighthouse CI before and after every optimization to quantify improvements objectively.
2. Implement bundle splitting with dynamic import() to load code only when needed, reducing initial JavaScript payload.
3. Lazy-load below-the-fold images with loading="lazy" and use modern formats like WebP or AVIF for smaller file sizes.
4. Set aggressive cache headers (Cache-Control, ETag) on static assets with content-hash filenames for long-term caching.
5. Profile runtime rendering with React Profiler or Chrome Performance tab to find unnecessary re-renders and heavy computations.
6. Minimize layout thrashing by batching DOM reads and writes and avoiding synchronous layout forces inside animation loops.
7. Use service workers with stale-while-revalidate strategies to serve cached pages instantly on repeat visits.
8. Monitor Largest Contentful Paint (LCP) and Cumulative Layout Shift (CLS) in production via Real User Monitoring (RUM) dashboards.
