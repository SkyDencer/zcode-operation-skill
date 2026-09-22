---
name: factories
description: Laravel model factories for test data generation, state definitions, sequence generation, and factory recycling patterns
keywords:
  - factories
  - test data
  - Faker
  - states
  - sequences
  - model factories
domains:
  - backend
  - testing
---

## When to use

Use when writing tests that need database records, generating realistic test data, or creating parameterized test scenarios with different model states.

## Instructions

1. Define factory states for different model variants
2. Use sequence() for sequential values
3. Chain states with afterMaking() and afterCreating()
4. Use Recycler for unique values
5. Test factories with php artisan tinker
