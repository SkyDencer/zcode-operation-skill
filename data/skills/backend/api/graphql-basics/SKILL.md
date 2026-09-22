---
name: graphql-basics
description: GraphQL schema design, resolver patterns, DataLoader for N+1 prevention, introspection, and GraphQL versus REST tradeoffs
keywords:
  - GraphQL
  - schema design
  - resolvers
  - DataLoader
  - N+1 queries
  - GraphQL API
domains:
  - backend
  - api
---

## When to use

Use when building flexible APIs with complex data requirements, reducing over-fetching, or enabling client-driven queries with typed schemas.

## Instructions

1. Define schema with SDL (Schema Definition Language)
2. Create resolvers for each field
3. Use DataLoader to batch database queries
4. Enable introspection in development only
5. Document schema with descriptions
