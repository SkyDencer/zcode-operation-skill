---
name: sanctum
description: Laravel Sanctum authentication for SPA and mobile app APIs, including token management, stateful authentication, CORS configuration, and API route protection
keywords:
  - Sanctum
  - API authentication
  - token management
  - SPA auth
  - stateful auth
  - CORS
  - API routes
domains:
  - backend
  - security
---

## When to use

Use when implementing API authentication for SPAs or mobile apps, setting up token-based auth, configuring CORS for cross-origin requests, or protecting API routes with Sanctum guards.

## Instructions

1. Install and configure Sanctum in config/auth.php
2. Set up stateful middleware for SPA sessions
3. Create API tokens with assignToken method
4. Configure CORS in cors.php for your domains
5. Protect routes with auth:sanctum middleware
