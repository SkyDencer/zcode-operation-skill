---
name: seeding
description: Laravel database seeding with Factories, Faker integration, relationship seeding, and creating realistic test data for development and testing
keywords:
  - seeders
  - Factories
  - Faker
  - test data
  - relationship seeding
domains:
  - backend
  - testing
---

## When to use

Use when populating your database with realistic test data, setting up development environment with sample data, or creating deterministic test fixtures.

## Instructions

1. Create Factory classes for each model
2. Use Faker methods to generate realistic data
3. Seed related models together
4. Use refreshDatabase trait in tests
5. Create DatabaseSeeder to orchestrate all seeders
