---
name: events-listeners
description: Laravel event system for decoupled architecture, queued events, event subscribers, and firing custom application events
keywords:
  - events
  - listeners
  - queued events
  - event subscribers
  - decoupled architecture
domains:
  - backend
---

## When to use

Use when you need to decouple business logic, handle side effects asynchronously, or trigger multiple actions from a single event like user registration.

## Instructions

1. Define Event classes with payload data
2. Create Listener classes with handle() method
3. Register in EventServiceProvider
4. Make events queued for background processing
5. Use Event::fake() in tests
