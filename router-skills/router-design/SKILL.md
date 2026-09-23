---
name: router-design
description: Routes design and UI workflow prompts to the appropriate design skill. Use when the user types design or asks about color, typography, spacing, accessibility, or responsive layouts.
allowed-tools:
  - Read
  - Grep
  - Glob
---

# Design Router

## When to use
Activate when:
- User explicitly types `design`
- Prompt mentions color theory, typography, spacing systems, accessibility (WCAG), responsive design, glassmorphism, or design tokens
- Workflow involves UI/UX decisions, visual design systems, or front-end styling

## Routing table

Read the appropriate leaf skill file based on the task:

| Task type | Read this file |
|-----------|----------------|
| Color wheels, harmony schemes, contrast ratios, semantic color tokens | <plugin-root>/data/skills/design/color-theory/SKILL.md |
| Font pairing, type scales, responsive typography, font loading | <plugin-root>/data/skills/design/typography/SKILL.md |
| Modular spacing scales, padding tokens, visual rhythm, 8px grid | <plugin-root>/data/skills/design/spacing/SKILL.md |
| WCAG 2.1 AA compliance, ARIA attributes, keyboard navigation | <plugin-root>/data/skills/design/accessibility/SKILL.md |
| Mobile-first layouts, breakpoints, fluid typography, container queries | <plugin-root>/data/skills/design/responsive-design/SKILL.md |
| Backdrop blur effects, frosted glass UI, translucent layers | <plugin-root>/data/skills/design/glassmorphism/SKILL.md |

## Rules
- Read ONLY the files relevant to the current task. Do not load all files.
- If unsure which file applies, read the one that best matches the prompt's primary verb (e.g., "choose colors" → color-theory, "make responsive" → responsive-design).
- Never modify the leaf skill files.
- For cross-cutting design questions (e.g., "design a accessible color system"), read the most relevant single skill and note that multiple skills may apply.
