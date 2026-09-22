---
name: context
description: React Context API for global state sharing, context providers, context optimization, and avoiding unnecessary re-renders
keywords:
  - Context API
  - providers
  - context optimization
  - useContext
  - re-render prevention
domains:
  - frontend
---

## When to use

Use when sharing theme data, authentication state, or locale settings across deeply nested component trees without prop drilling.

## Instructions

1. Create context with createContext()
2. Wrap app with provider component
3. Split contexts to prevent unwanted re-renders
4. Use context selector pattern for performance
5. Combine with useReducer for complex state
