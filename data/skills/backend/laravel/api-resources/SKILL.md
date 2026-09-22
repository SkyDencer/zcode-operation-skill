---
name: api-resources
description: Laravel API Resources for transforming model data into JSON responses, conditional field inclusion, resource collections, and nested resource responses
keywords:
  - API Resources
  - JSON transformation
  - resource collections
  - conditional fields
  - API responses
domains:
  - backend
  - api
---

## When to use

Use when building REST API endpoints, transforming Eloquent models to JSON, conditionally including fields based on user permissions, or creating nested API responses.

## Instructions

1. Create Resource classes extending JsonResource
2. Define toArray() method for field mapping
3. Use when() for conditional fields
4. Create ResourceCollection for multiple resources
5. Return resources from controller methods
