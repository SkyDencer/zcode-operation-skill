---
name: versioning
description: API versioning strategies including URL path versioning, header versioning, content negotiation, and backward compatibility maintenance
keywords:
  - API versioning
  - URL versioning
  - content negotiation
  - backward compatibility
  - deprecated endpoints
domains:
  - backend
  - api
---

## When to use

Use when introducing breaking API changes, maintaining multiple client versions, or deprecating old API endpoints while supporting existing consumers.

## Instructions

1. Use URL path versioning: /api/v1/resources
2. Maintain backward compatibility when possible
3. Deprecate endpoints with warning headers
4. Document version changes in API changelog
5. Set sunset headers for deprecated versions
