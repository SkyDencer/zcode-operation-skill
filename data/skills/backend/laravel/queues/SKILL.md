---
name: queues
description: Laravel queue workers, job dispatching, retry logic, rate limiting, and supervisor configuration for background task processing at scale
keywords:
  - queue worker
  - job dispatching
  - retry logic
  - rate limiting
  - supervisor
  - background jobs
  - queued jobs
domains:
  - backend
---

## When to use

Use when you need to process heavy tasks asynchronously, send emails in background, handle webhooks, or schedule periodic jobs. Essential for keeping HTTP responses fast.

## Instructions

1. Create a Job class with handle() method
2. Dispatch jobs with dispatch() or dispatchSync()
3. Configure retry limits and timeout in job class
4. Set up database or Redis queue driver
5. Run queue worker with php artisan queue:work
