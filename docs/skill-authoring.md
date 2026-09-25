# Skill Authoring Guide

How to write high-quality SKILL.md files that the Skill Router can effectively rank and surface.

## What is a SKILL.md?

A SKILL.md file is the structured manifest for a single subagent skill. It lives in `data/skills/<domain>/<subdomain>/<skill-name>/SKILL.md` and defines both the **metadata** (frontmatter) and the **content** (markdown body) that the Skill Router uses for retrieval and context injection.

## Frontmatter Schema

Every SKILL.md must begin with a YAML-like frontmatter block delimited by `---`:

```markdown
---
name: backend-laravel-eloquent
description: "Write efficient Eloquent ORM queries for Laravel, including relationships, scopes, and query builder patterns."
keywords:
  - eloquent
  - orm
  - laravel
  - relationships
  - query builder
domains:
  - backend
  - laravel
version: 1.0.0
---
```

### Field Requirements

| Field | Required | Constraints | Validation Rule |
|---|---|---|---|
| `name` | Yes | Non-empty; must start with one of its `domains` followed by `-` | e.g. `backend-laravel-eloquent` is valid; `eloquent-query` is not |
| `description` | Yes | 40–400 characters | Concise summary of what the skill does |
| `keywords` | Yes | 3–15 entries | Specific terms the skill covers; avoids overly generic words |
| `domains` | Yes | At least one; must match a directory under `data/domains/` | e.g. `["backend", "laravel"]` |
| `version` | No | Semantic version string (e.g., `1.0.0`) | Optional but recommended |

### Writing Good Names

The name field must follow the `{domain}-{specific}` pattern. This is not cosmetic — the quality validator enforces it, and the hierarchical router uses it for domain inference.

**Good examples:**
- `backend-laravel-eloquent`
- `frontend-react-hooks-basics`
- `design-color-theory`
- `backend-api-rest-conventions`

**Bad examples:**
- `eloquent-queries` — missing domain prefix
- `Backend Laravel Eloquent` — spaces instead of hyphens, wrong case
- `laravel-eloquent-orm-queries-best-practices-guide` — too long, multiple subdomains

### Writing Good Descriptions

The description should be a single sentence (40–400 characters) that clearly states what the skill helps with. Think of it as the skill's elevator pitch.

**Good examples:**
- `"Writes efficient Eloquent ORM queries with proper relationship loading and query scoping for Laravel applications."` (104 chars)
- `"Implements accessible React components following WAI-ARIA patterns and keyboard navigation standards."` (104 chars)
- `"Defines color palettes using CSS custom properties with WCAG 2.1 AA contrast compliance."` (91 chars)

**Bad examples:**
- `"React"` (too short, 5 chars)
- `"This skill is about writing good React code and making sure that the components are well structured and easy to maintain while also being accessible to all users including those who use screen readers and other assistive technologies."` (too long, 249 chars — edge case but avoid)
- `"Handles stuff"` (vague and too short)

### Writing Good Keywords

Keywords are the primary signal for BM25 matching. Choose 3–15 terms that a user would actually type when looking for this skill.

**Good keywords:**
- `["eloquent", "orm", "laravel", "relationships", "query builder", "scopes"]`
- `["react", "hooks", "context", "state management", "useReducer"]`
- `["accessibility", "wcag", "aria", "keyboard navigation", "screen reader"]`

**Bad keywords:**
- `["php", "web", "code"]` — too generic; high IDF penalty, low discriminative power
- `["react", "js", "frontend"]` — overlaps heavily with many other skills
- `[]` — empty; fails validation (minimum 3)

### Choosing Domains

Domains organize skills into the hierarchical routing system. The top-level directory under `data/skills/` defines the domain. Make sure it matches an existing domain directory in `data/domains/`.

**Common domains:**
- `backend` — server-side logic, APIs, databases
- `frontend` — browser UI, React, Next.js
- `design` — visual design, typography, color, spacing
- `testing` — unit tests, integration tests, TDD
- `meta` — project structure, git workflow, documentation

Skills can belong to multiple domains (e.g., `["backend", "laravel"]`).

## Content Section

The markdown body after the frontmatter is the skill's **content**. This is what gets injected into the model context when the skill is surfaced.

### Length Requirements

- **Minimum:** 100 tokens (roughly 600–800 characters of prose)
- **Maximum:** 800 tokens (roughly 4,800–6,000 characters)

The quality validator enforces these bounds. Content that is too short provides insufficient context; content that is too long wastes the injected context budget.

### Structure

Organize content with clear headings so the budget manager's paragraph-safe truncation preserves readability:

```markdown
---
name: backend-laravel-eloquent
description: "Writes efficient Eloquent ORM queries with proper relationship loading and query scoping."
keywords:
  - eloquent
  - orm
  - laravel
  - relationships
  - query builder
  - scopes
domains:
  - backend
  - laravel
version: 1.0.0
---

# Laravel Eloquent ORM

## Overview

Eloquent is Laravel's ActiveRecord ORM implementation. It provides a clean, expressive syntax for database operations.

## Relationships

Define relationships in your model classes:

```php
// One-to-many
public function posts()
{
    return $this->hasMany(Post::class);
}

// Many-to-many
public function roles()
{
    return $this->belongsToMany(Role::class);
}
```

## Query Scopes

Scopes allow you to define reusable query constraints:

```php
public function scopeActive($query)
{
    return $query->where('active', true);
}
```

## Best Practices

- Use eager loading (`with()`) to avoid N+1 queries
- Prefer query scopes over manual where clauses for reusability
- Use lazy eager loading (`load()`) when relationships are conditional
```

### Do's and Don'ts

| Do | Don't |
|---|---|
| Write concrete, actionable guidance | Write vague descriptions like "this handles X" |
| Include code examples where relevant | Include massive code dumps that exceed 800 tokens |
| Use clear section headings | Write walls of unstructured text |
| Target ~200–500 tokens for most skills | Write less than 100 tokens (insufficient context) |
| Keep frontmatter fields specific and focused | Use overly generic keywords like "code", "php", "web" |

## Quality Checklist

Before committing a new or updated SKILL.md, run the validator:

```bash
node bin/skill-router.mjs validate
```

Or check an individual file:

```bash
node src/quality/validator.mjs data/skills/backend/laravel/eloquent
```

### Checklist

- [ ] **Name** follows `{domain}-{specific}` pattern and matches its declared domains
- [ ] **Description** is 40–400 characters, specific and actionable
- [ ] **Keywords** are 3–15 terms, specific to this skill's topic (not generic)
- [ ] **Domains** are registered in `data/domains/`
- [ ] **Content** is 100–800 tokens with clear section headings
- [ ] **Version** is a valid semantic version string (recommended)
- [ ] **Re-ran `node hooks/build-index.mjs`** after adding or modifying the file
- [ ] **Ran the benchmark** to confirm no accuracy regression

## Common Pitfalls

### Pitfall 1: Overly generic keywords

**Bad:** `["php", "laravel", "web", "code", "framework"]`
**Good:** `["eloquent", "orm", "relationships", "query builder", "scopes", "migrations"]`

Generic keywords inflate term frequency without adding discriminative signal. BM25 will still rank the skill, but it will compete poorly against other generic skills.

### Pitfall 2: Missing domain prefix in name

**Bad:** `name: eloquent-queries` (domains: `["backend", "laravel"]`)
**Good:** `name: backend-laravel-eloquent`

The validator requires the name to start with one of its domains. This also helps the hierarchical router infer domain membership when metadata is incomplete.

### Pitfall 3: Short descriptions

**Bad:** `description: "Laravel ORM"` (13 chars — fails validation)
**Good:** `description: "Writes efficient Eloquent ORM queries with relationships, scopes, and query builder patterns for Laravel applications."` (119 chars)

Short descriptions provide insufficient signal for the BM25 description field (weighted ×2).

### Pitfall 4: Unregistered domains

**Bad:** `domains: ["my-custom-domain"]` (no `data/domains/my-custom-domain/meta.json`)
**Good:** Add `data/domains/my-custom-domain/meta.json` first, then reference it.

The validator checks that every declared domain has a corresponding entry in `data/domains/`.

### Pitfall 5: Insufficient content

**Bad:** A 30-token description repeated as content.
**Good:** At least 100 tokens of substantive guidance, code examples, and best practices.

Content is what gets injected as context. Thin content means the model receives little useful information even when the skill ranks highly.

## Adding a New Skill — Step by Step

1. **Create the directory:** `mkdir -p data/skills/<domain>/<subdomain>/<skill-name>`
2. **Write SKILL.md** with proper frontmatter and 100–800 tokens of content
3. **Ensure domain metadata exists:** `data/domains/<domain>/meta.json`
4. **Run validation:** `node bin/skill-router.mjs validate`
5. **Fix any issues** reported by the validator
6. **Rebuild the index:** `node hooks/build-index.mjs`
7. **Run the benchmark:** `node tests/run-benchmark.mjs --mode bm25` to confirm no regression
8. **Commit the changes** (let the project manager handle commits)

## Bulk Importing Skills

If you have a directory of well-formed SKILL.md files from another project, use the import command:

```bash
node bin/skill-router.mjs import /path/to/source-skills
```

The importer will:
1. Scan the source directory recursively
2. Validate each skill against the 6 quality rules
3. Reject invalid skills with a detailed report
4. Copy valid skills into `data/skills/` preserving directory structure
5. Report how many were imported, rejected, or skipped (collision)

Use `--force` to overwrite existing skills, and `--json` for machine-readable output.
