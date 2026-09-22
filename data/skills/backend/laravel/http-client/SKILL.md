---
name: http-client
description: Laravel HTTP Client for making outbound API requests, handling responses, request retries, and mocking HTTP calls in tests
keywords:
  - HTTP client
  - API requests
  - response handling
  - request retries
  - HTTP mocking
domains:
  - backend
  - api
---

## When to use

Use when integrating with external APIs, making HTTP requests from Laravel, handling API response errors, or testing code that makes external HTTP calls.

## Instructions

1. Use Http::get() and Http::post() for requests
2. Handle responses with optional() method
3. Add retry() for automatic retries on failure
4. Mock HTTP calls with Http::fake() in tests
5. Use withHeaders() for authentication tokens
