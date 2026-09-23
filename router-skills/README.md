# Router Skills

## What Are Router Skills?

Router skills are lightweight orchestration skills that sit one level above leaf content skills. Each router skill acts as a **dispatcher**: it reads the user's prompt, determines the domain or framework being targeted, and then loads the single most relevant leaf SKILL.md file from `data/skills/`.

Think of routers as the "table of contents" for the skill corpus — they don't contain implementation instructions themselves; they contain the mapping from intent to skill.

## How Routers Differ from Leaf Skills

| Aspect | Router Skill | Leaf Skill |
|--------|-------------|------------|
| Location | `router-skills/router-{name}/SKILL.md` | `data/skills/{domain}/{skill-name}/SKILL.md` |
| Purpose | Route/dispatch to the right leaf skill | Contain the actual workflow instructions |
| Size | ~50–80 lines | ~50–200+ lines |
| Frontmatter | `name`, `description`, `allowed-tools` | `name`, `description`, `keywords`, `domains` |
| Content | Routing table + trigger conditions | Step-by-step instructions, examples |
| Modification | Created by router-skills-engineer | Author-generated, never modified by routers |

**Key principle:** Routers read leaf skills; leaf skills never reference routers. This creates a clean one-way dependency graph.

## Router Catalog

| Router | Triggers On | Skill Count |
|--------|------------|-------------|
| `router-next` | `next`, Next.js, App Router, ISR, Server Components | 8 |
| `router-react` | `react`, Hooks, Context, state management, portals | 10 |
| `router-laravel` | `laravel`, Eloquent, migrations, queues, API design | 20 |
| `router-design` | `design`, color, typography, accessibility, responsive | 6 |
| `router-test` | `test`, TDD, Pest, Vitest, Playwright, integration | 8 |
| `router-meta` | `meta`, architecture, code review, docs, refactoring, debugging | 5 |

## How Routers Get Deployed

Router skills are part of the plugin corpus and are picked up automatically by the skill index builder (`hooks/build-index.mjs`). The deployment flow is:

1. **Authoring phase** — The router-skills-engineer creates `router-skills/` files (this phase).
2. **Index build phase** — `build-index.mjs` scans `router-skills/` alongside `data/skills/`, parses frontmatter, and adds router entries to `data/skill-index.json` with a `type: "router"` marker.
3. **Routing phase** — When a `UserPromptSubmit` hook fires, the hybrid retriever ranks both routers and leaf skills. The top-ranked router is selected, and its routing table is used to load the target leaf skill.
4. **Context injection** — The leaf skill content is read, fitted within the context budget, and injected into the ZCode editor via `hookSpecificOutput.additionalContext`.

For full deployment details, see `phase-3-deployer-engineer` documentation and the hook contract in `docs/ai-context.md`.

## Creating a New Router

To add a new router:

1. Create `router-skills/router-{name}/SKILL.md` following the template in this directory.
2. Populate the routing table by reading `data/skills/` and grouping skills by their `domains` frontmatter field.
3. Ensure each routing table entry uses the relative path `<plugin-root>/data/skills/{domain}/{skill-name}/SKILL.md`.
4. Verify the router does not reference another router in its routing table.
5. Rebuild the index: run `node hooks/build-index.mjs`.

## Rules

- Routers must use `allowed-tools: [Read, Grep, Glob]` — no write or shell tools.
- Routers must never modify leaf skill files.
- Each router's description must be 100–200 characters and clearly state trigger conditions.
- Routing tables must reference existing files only; verify with `Glob` before finalizing.
- Keep each router file under 300 lines.
