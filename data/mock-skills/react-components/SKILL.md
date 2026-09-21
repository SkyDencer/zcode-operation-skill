---
name: react-components
description: React component architecture patterns including functional components with hooks, prop drilling solutions, context API, component composition, and reusable UI component design
keywords:
  - React hooks
  - useState
  - useEffect
  - props drilling
  - context API
  - component composition
  - custom hooks
  - React functional components
  - React Router
  - JavaScript
domains:
  - frontend
  - javascript
---

# React Component Architecture

## When to use
Use this skill when designing React components, resolving prop drilling issues, or building reusable UI libraries within a React application.

## Instructions
1. Prefer functional components with hooks over class components; use useState for local state and useEffect for side effects.
2. Lift shared state up to the nearest common ancestor before reaching for Context; use Context only for truly global theme or auth state.
3. Build custom hooks (useFetch, useForm, useLocalStorage) to extract and reuse logic across unrelated components.
4. Compose complex components from small presentational children rather than passing deeply nested callback props.
5. Use React.lazy() and Suspense for code-splitting routes or heavy components to reduce initial bundle size.
6. Keep props flat where possible; prefer compound component patterns (Table + TableRow + TableHeader) for flexible APIs.
7. Memoize expensive computations with useMemo and prevent unnecessary re-renders with useCallback on callback props.
8. Name components with PascalCase and keep single-responsibility files under 200 lines; extract sub-components early.
