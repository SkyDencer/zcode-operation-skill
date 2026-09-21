---
name: laravel-testing
description: PHPUnit and Pest testing strategies for Laravel applications covering unit tests, feature tests, database transactions, mock factories, and CI integration for TDD workflows
keywords:
  - PHPUnit
  - Pest PHP
  - feature tests
  - unit tests
  - database factories
  - TDD
  - mocking
  - Laravel test case
  - CI integration
  - test coverage
domains:
  - backend
  - quality-assurance
---

# Laravel Testing and TDD Guide

## When to use
Use this skill when writing tests for Laravel applications, setting up test databases, or establishing a TDD workflow with PHPUnit or Pest.

## Instructions
1. Extend TestCase for feature tests and create dedicated UnitTestClass files for pure model logic without HTTP overhead.
2. Use DatabaseMigrations or DatabaseTransactions traits to isolate test state; prefer RefreshDatabase for fresh seeds each test.
3. Generate model factories with php artisan make:factory and use factory-state() for realistic test data variation.
4. Mock external services (Mail, Queue, HTTP) with Laravel's Facade::fake() to avoid side effects during unit tests.
5. Assert response status codes, JSON structure, and database state using ->assertStatus(200) and ->assertDatabaseHas().
6. Write Pest tests for concise DSL syntax when the project prefers BDD-style readability over PHPUnit boilerplate.
7. Set up dedicated .env.testing configuration with an in-memory SQLite driver for the fastest possible test execution.
8. Integrate test coverage reports into CI pipelines using phpunit --coverage-clover and track regressions over time.
