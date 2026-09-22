---
name: static-generation
description: Next.js static site generation with generateStaticParams, full static rendering, ISR with revalidate, and partial prerendering
keywords:
  - static generation
  - generateStaticParams
  - ISR
  - revalidate
  - partial prerendering
domains:
  - frontend
---

## When to use

Use when building statically generated pages, implementing Incremental Static Regeneration, or optimizing pages that rarely change.

## Instructions

1. Use generateStaticParams for dynamic routes
2. Set export const dynamic = 'force-static'
3. Configure revalidate for ISR
4. Use generateMetadata for SEO
5. Pre-render at build time with next build
