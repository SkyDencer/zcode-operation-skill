---
name: debugging
description: General-purpose debugging techniques including console diagnostics, stack trace analysis, breakpoint strategies, memory leak detection, and systematic root cause isolation
keywords:
  - stack trace
  - breakpoints
  - console logging
  - memory leaks
  - root cause analysis
  - debugger
  - profiling
  - error handling
  - diagnostic tools
  - log analysis
domains:
  - debugging
  - diagnostics
---

# General Debugging Techniques

## When to use
Apply this skill when encountering unexplained crashes, memory bloat, infinite loops, or any runtime behavior that lacks an obvious cause.

## Instructions
1. Reproduce the issue in the smallest possible isolated environment before touching production code or complex call stacks.
2. Use structured console logging with labeled prefixes (e.g., [UserService.fetch]) to trace execution flow through noisy applications.
3. Set conditional breakpoints at likely failure points rather than stepping blindly through every line of code.
4. Analyze full stack traces top-to-bottom, noting the origin frame first and the thrown exception last for complete context.
5. Profile CPU and memory with browser DevTools Performance tab or Node.js --inspect to identify hot paths and leaked objects.
6. Check environment variable mismatches, stale caches, and dependency version conflicts as common sources of silent failures.
7. Write a minimal failing test that reproduces the bug before attempting a fix — this confirms the diagnosis is correct.
8. Add temporary telemetry (request IDs, correlation tokens) to distributed systems so logs across services can be stitched together.
