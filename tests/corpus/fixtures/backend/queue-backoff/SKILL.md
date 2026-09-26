---
name: backend-queue-backoff
description: Exponential backoff and retry budgets for background queue workers, including dead-letter routing, jitter, and the point at which a poison message is abandoned rather than retried forever
keywords:
  - exponential backoff
  - retry budget
  - dead letter queue
  - jitter
  - poison message
domains:
  - backend
  - devops
version: 0.1.0
---

## When to use

Use when a worker keeps failing on the same message, or when a downstream
service degrades and you need the queue to back off instead of amplifying the
outage.

## Instructions

1. Cap the number of attempts per message.
2. Apply exponential backoff with jitter.
3. Route exhausted messages to the dead-letter queue.
4. Alert on dead-letter growth, not on individual retries.
