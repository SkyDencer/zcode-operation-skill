---
name: Observability
description: Metric naming and log field conventions for a service, covering cardinality budgets, label hygiene, and the structured fields every dashboard panel is expected to read
keywords:
  - metrics
  - cardinality
  - log fields
  - dashboards
domains:
  - backend
  - diagnostics
version: 0.1.0
---

## When to use

Use when a metric name is ambiguous or a label set is about to grow without a
cardinality budget.

## Instructions

1. Name metrics for the thing, not the code path.
2. Bound label cardinality before shipping the metric.
3. Keep log field names identical across services.
