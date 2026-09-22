---
name: errors
description: Consistent API error response formatting, problem details specification, error code taxonomy, and error handling middleware patterns
keywords:
  - error handling
  - Problem Details
  - error codes
  - API errors
  - error responses
domains:
  - backend
  - api
---

## When to use

Use when designing error response formats, implementing centralized error handling, or standardizing error codes across your API surface.

## Instructions

1. Follow RFC 7807 Problem Details format
2. Include error code, title, detail, and instance
3. Use standard HTTP status codes consistently
4. Add validation errors with field-level details
5. Log errors with correlation IDs for debugging
