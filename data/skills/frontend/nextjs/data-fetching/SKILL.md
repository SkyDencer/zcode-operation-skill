---
name: data-fetching
description: Next.js data fetching strategies including Server Components fetch, useSWR, cache revalidation, and full-route cache control
keywords:
  - data fetching
  - useSWR
  - cache revalidation
  - stale-while-revalidate
  - full-route cache
domains:
  - frontend
---

## When to use

Use when implementing data fetching in Next.js, choosing between static and dynamic rendering, or managing cache revalidation strategies.

## Instructions

1. Fetch in Server Components with async/await
2. Use unstable_noStore() for dynamic data
3. Configure cache options on fetch()
4. Implement revalidatePath for mutations
5. Use useSWR for client-side caching
