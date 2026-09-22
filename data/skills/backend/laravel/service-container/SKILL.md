---
name: service-container
description: Laravel Service Container and Service Providers for dependency injection, binding interfaces to implementations, and managing application services
keywords:
  - Service Container
  - dependency injection
  - Service Provider
  - bindings
  - IOC container
domains:
  - backend
---

## When to use

Use when implementing dependency injection, binding interfaces to concrete classes, registering services with the container, or creating custom Service Providers.

## Instructions

1. Bind interfaces to implementations in Service Providers
2. Use type-hinted constructor injection
3. Resolve services with app() helper
4. Use bind() for singleton, singleton() for shared instances
5. Test bindings with container inspection
