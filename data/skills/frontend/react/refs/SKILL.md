---
name: refs
description: React refs including useRef, useImperativeHandle, forwardRef, DOM ref manipulation, and ref callback patterns
keywords:
  - useRef
  - forwardRef
  - useImperativeHandle
  - DOM refs
  - ref callbacks
domains:
  - frontend
---

## When to use

Use when accessing DOM elements directly, managing focus, integrating with third-party libraries, or exposing imperative methods from child components.

## Instructions

1. Use useRef for mutable values that persist
2. Use forwardRef when wrapping components
3. Use useImperativeHandle to expose methods
4. Access DOM nodes with ref.current
5. Avoid ref abuse for state management
