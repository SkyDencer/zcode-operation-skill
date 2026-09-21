---
name: laravel-security
description: Laravel security best practices including CSRF protection, XSS prevention, SQL injection mitigation, authentication guards, and authorization policies for secure PHP web applications
keywords:
  - CSRF protection
  - XSS prevention
  - SQL injection
  - authentication
  - authorization
  - middleware
  - Eloquent ORM
  - blade templating
  - Laravel framework
  - PHP security
domains:
  - backend
  - security
---

# Laravel Security Hardening Guide

## When to use
Use this skill when writing or auditing Laravel applications that handle user data, payments, or sensitive operations. Reference these patterns before deploying to production.

## Instructions
1. Always use Laravel's built-in CSRF tokens via @csrf Blade directive on every POST/PUT/DELETE form.
2. Eager-load relationships with where clauses using parameterized queries — never interpolate user input into SQL strings.
3. Apply XSS sanitization by relying on Blade's {{ }} auto-escaping; use {!! !!} only for explicitly trusted HTML.
4. Implement policy classes with Gate::authorize() for every resource controller action instead of inline if-statements.
5. Use middleware groups (auth, throttle, ssl) on routes that require guarded access or rate limiting.
6. Configure session cookies with http_only, secure, and same_site attributes in config/session.php.
7. Enforce password hashing with bcrypt or Argon2 via Laravel's built-in Hash facade.
8. Audit third-party packages with composer audit before adding them to the dependency tree.
