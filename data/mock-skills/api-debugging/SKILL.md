---
name: api-debugging
description: Debugging REST and GraphQL API issues including request/response inspection, middleware tracing, CORS errors, authentication token failures, and status code diagnostics
keywords:
  - REST API
  - GraphQL
  - CORS
  - authentication tokens
  - request inspection
  - status codes
  - middleware
  - Postman
  - network debugging
  - API tracing
domains:
  - debugging
  - backend
---

# API Debugging and Diagnostics

## When to use
Use this skill when APIs return unexpected status codes, requests fail silently, CORS blocks cross-origin calls, or authentication tokens are rejected.

## Instructions
1. Inspect the full request and response cycle in browser Network tab or Postman — check headers, payload, and status codes for every hop.
2. Verify CORS preflight (OPTIONS) requests are handled correctly by your middleware; mismatched Access-Control-Allow-Origin causes silent failures.
3. Test authentication tokens independently with a minimal curl or httpie command to isolate token validation from application logic.
4. Enable debug logging on every middleware layer to capture exactly where the request is modified, rejected, or timed out.
5. Check for race conditions in async API calls by comparing request timestamps against server-side processing logs.
6. Use GraphQL introspection or GraphiQL to validate schema expectations when a query returns 400 or missing field errors.
7. Compare your request body format against the OpenAPI or GraphQL schema specification to catch serialization mismatches.
8. Measure endpoint latency with ping or curl -w '{time_total}' to separate network slowness from application bottlenecks.
