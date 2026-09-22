---
name: rest-conventions
description: RESTful API design conventions including proper HTTP methods, status codes, resource naming, HATEOAS links, and API versioning strategies
keywords:
  - REST API
  - HTTP methods
  - status codes
  - resource naming
  - HATEOAS
  - API design
domains:
  - backend
  - api
---

## When to use

Use when designing new API endpoints, reviewing existing API contracts, or establishing API standards for a team. Essential for building consistent and predictable APIs.

## Instructions

1. Use GET for reads, POST for creates, PUT/PATCH for updates, DELETE for removals
2. Return appropriate status codes: 200, 201, 400, 401, 404, 422, 500
3. Name resources in plural lowercase with hyphens
4. Include pagination metadata in list responses
5. Version APIs via URL path or Accept header
