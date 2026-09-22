---
name: integration-testing
description: Integration testing patterns including test databases, mocking external services, transaction rollback, and test isolation strategies
keywords:
  - integration tests
  - test database
  - mocking
  - transaction rollback
  - test isolation
domains:
  - testing
---

## When to use

Use when testing interactions between multiple system components, integrating with external APIs in tests, or managing test database state.

## Instructions

1. Use dedicated test database
2. Wrap tests in transactions
3. Mock external HTTP calls
4. Reset state between tests
5. Use factories for test data
