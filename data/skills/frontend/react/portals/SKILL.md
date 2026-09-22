---
name: portals
description: React Portals for rendering children outside parent DOM hierarchy, modal dialogs, tooltips, dropdowns, and overlay components
keywords:
  - Portals
  - modal dialogs
  - overlays
  - tooltip
  - z-index
  - DOM rendering
domains:
  - frontend
---

## When to use

Use when creating modals, tooltips, dropdowns, or any component that needs to escape parent DOM constraints for z-index or overflow handling.

## Instructions

1. Use ReactDOM.createPortal for portal creation
2. Provide container element reference
3. Handle focus trapping in portals
4. Clean up event listeners on unmount
5. Style portals with position: fixed
