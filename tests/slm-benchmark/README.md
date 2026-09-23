# SLM Benchmark Dataset

## Overview

This directory contains a benchmark dataset for evaluating how well a small language model (SLM) — such as Qwen2.5-0.5B — maps natural-language workflow authoring prompts to the correct ZCode skills.

- **`prompts.json`**: 30 prompts spanning 7 categories.
- **`expected.json`**: Ground-truth skill mappings keyed by prompt ID.
- **`README.md`**: This file — methodology and usage guide.

## Prompt Categories

| Category | Count | Description |
|---|---|---|
| `single-domain-clear` | 8 | Specific, unambiguous prompts that map cleanly to one primary skill (e.g., "Fix the N+1 query in the Order model" → `backend-eloquent`). |
| `single-domain-ambiguous` | 6 | Vague prompts within a single domain where multiple skills could reasonably apply (e.g., "Make this page look better" → typography / spacing / color-theory). |
| `multi-domain` | 5 | Prompts that require skills from multiple domains (e.g., "Add Stripe payment to Laravel and build checkout UI in Next.js"). |
| `debugging` | 4 | Troubleshooting scenarios that combine domain-specific knowledge with systematic debugging methodology. |
| `edge-case` | 4 | Stress-test prompts: very short ("fix auth"), very long (~600 words), code-heavy (PHP snippet), and mixed-language (Spanish/English). |
| `negative` | 3 | Prompts that should return **no** skill — general knowledge, humor, or topics outside the skill corpus. |

## Skill Matching Semantics

### `skills` (ideal set)

The `skills` array in `expected.json` represents the **ideal exact-match target**. For grading purposes, a prompt is considered correctly matched when the SLM's output includes **at least one** skill from this array (intersection ≥ 1). For multi-domain prompts, a fully correct response includes **all** skills in the array.

### `acceptable` (lenient set)

The `acceptable` array represents a **superset of valid skills** — any correct subset of this array should be accepted as a valid answer. This accounts for:
- Synonymous skill interpretations (e.g., "performance improvement" could map to `backend-eloquent` for query optimization or `backend-cache` for caching).
- Missing secondary skills in multi-domain prompts (e.g., returning only `backend-sanctum` for a prompt that also references checkout UI).
- Edge-case ambiguity where multiple skills are defensible.

**Grading rule:**
- A response is **correct** if its returned skills are a non-empty subset of `acceptable` AND intersect with `skills`.
- A response is **partial** if its returned skills are a subset of `acceptable` but have empty intersection with `skills` (unlikely but possible for ambiguous prompts).
- A response is **incorrect** if any returned skill is outside the `acceptable` set.
- For `negative` prompts, any non-empty skill return is incorrect.

## How to Add New Prompts

1. **Choose a category** from the table above and increment the count to stay balanced.
2. **Write the prompt** in `prompts.json` with a unique `id` (format: `promp-NNN`, zero-padded to 3 digits).
3. **Define `expected.json` entry** for the new ID:
   - `skills`: list the ideal exact-match skill names (must exist in `data/skills/`).
   - `acceptable`: list all defensibly correct skills (superset of `skills`).
   - `notes`: explain your reasoning — this helps reviewers validate the ground truth.
4. **Verify skill names** exist by running:
   ```
   node -e "const fs=require('fs');const p=require('path');function f(d){let r=[];for(const e of fs.readdirSync(d)){const fp=path.join(d,e);if(fs.statSync(fp).isDirectory())r.push(...f(fp));else if(e==='SKILL.md'){const c=fs.readFileSync(fp,'utf8');const m=c.match(/^name:\s*(.+)$/m);if(m)r.push(m[1].trim());}}return r;}console.log(f('data/skills').sort().join('\n'));"
   ```
5. **Run the benchmark** via the SLM router's test harness to confirm the prompt exercises the intended behavior.
6. **Update this README** if the category distribution or semantics change.

## Existing Skill Corpus

This benchmark uses the 54 real skills from `data/skills/`. Skill names follow the pattern `<domain>-<subdomain>-<name>` (e.g., `backend-eloquent`, `frontend-hooks-basics`). The full list is extracted from SKILL.md frontmatter at build time.

## Distribution Summary

```
single-domain-clear:    8 prompts  (promp-001 — promp-008)
single-domain-ambiguous: 6 prompts  (promp-009 — promp-014)
multi-domain:           5 prompts  (promp-015 — promp-019)
debugging:              4 prompts  (promp-020 — promp-023)
edge-case:              4 prompts  (promp-024 — promp-027)
negative:               3 prompts  (promp-028 — promp-030)
Total:                 30 prompts
```
