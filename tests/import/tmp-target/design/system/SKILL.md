---
name: design-system
description: Building and maintaining a design system with token-based theming, accessible component primitives, Storybook documentation, and cross-framework design consistency
keywords:
  - design tokens
  - Storybook
  - theming
  - accessibility
  - component library
  - Figma
  - CSS variables
  - design consistency
  - documentation
  - tokens
domains:
  - frontend
  - design
---

# Design System Development

## When to use
Use this skill when creating a shared design system, defining design tokens, building documented component primitives, or aligning multiple projects to a single visual language.

## Instructions
1. Define design tokens (colors, spacing, typography, shadows) as CSS custom properties in a central theme file for consistent consumption.
2. Build atomic component primitives first (Button, Input, Modal) with full keyboard and screen-reader accessibility before composing higher-order components.
3. Document every component in Storybook with interactive playcanvas examples showing variants, states, and edge cases.
4. Use a color token system with semantic names (color-primary-500, color-status-error) rather than hardcoded hex values in components.
5. Enforce contrast ratios that meet WCAG 2.1 AA standards using axe-core audits inside your Storybook preview.
6. Publish the design system as an internal npm package with versioned releases tied to changelog commits.
7. Create a Figma-to-code pipeline where Figma tokens map 1:1 to CSS variables so designers and engineers share a source of truth.
8. Add snapshot tests with Jest or Playwright to catch unexpected visual regressions when component props change.
