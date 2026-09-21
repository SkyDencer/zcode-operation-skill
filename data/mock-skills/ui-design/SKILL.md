---
name: ui-design
description: User interface design principles for modern web applications including layout grids, visual hierarchy, spacing systems, responsive breakpoints, and mobile-first design patterns
keywords:
  - visual hierarchy
  - layout grid
  - responsive design
  - mobile-first
  - spacing system
  - CSS grid
  - typography scale
  - design tokens
  - accessibility
  - UX principles
domains:
  - frontend
  - design
---

# UI Design Principles

## When to use
Reference this skill when defining page layouts, establishing spacing and typography scales, or ensuring responsive designs work across device sizes.

## Instructions
1. Start with a mobile-first CSS approach — define base styles for small screens then layer breakpoints with min-width media queries.
2. Use a consistent 8px spacing scale (4, 8, 12, 16, 24, 32, 48, 64) throughout the application to create visual rhythm.
3. Establish a type scale with modular ratios (1.25 or 1.333) for heading and body sizes to maintain typographic hierarchy.
4. Apply CSS Grid for macro layouts and Flexbox for micro-component alignment; avoid nesting more than two levels deep.
5. Ensure sufficient color contrast between text and background to meet WCAG 2.1 AA minimum ratios (4.5:1 for normal text).
6. Design interactive elements with minimum 44x44px tap targets for touch devices to improve usability on mobile screens.
7. Define CSS custom properties for spacing and color tokens so the design system remains centralized and easy to theme.
8. Test responsive layouts at real viewport widths using device emulation and physical devices, not just browser resize.
