---
name: task-scheduling
description: Laravel Task Scheduling for recurring jobs, cron configuration, command scheduling, and monitoring scheduled tasks in production
keywords:
  - task scheduling
  - cron
  - scheduled commands
  - schedule work
  - recurring jobs
domains:
  - backend
---

## When to use

Use when you need to run periodic background tasks like daily reports, cleanup jobs, or scheduled API calls without managing external cron configurations.

## Instructions

1. Define schedules in Kernel.php schedule() method
2. Use everyHour(), daily(), weekly() convenience methods
3. Configure cron on server for Laravel scheduler
4. Add shouldRun() for conditional execution
5. Monitor with php artisan schedule:work
