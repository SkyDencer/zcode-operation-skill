---
name: testing-contract-first
description: Writing the contract test before the implementation so the interface is pinned by an executable specification, then keeping the provider and consumer suites honest about drift
keywords:
  - contract testing
  - consumer driven contracts
  - interface drift
  - executable specification
  - provider verification
domains:
  - testing
version: 0.1.0
---

## When to use

Use when two teams or two services share an interface and one of them keeps
breaking the other without noticing.

## Instructions

1. Write the consumer expectation as an executable test.
2. Publish the contract as an artifact both sides run against.
3. Verify the provider against the contract on every build.
4. Fail the build on drift rather than warning.
