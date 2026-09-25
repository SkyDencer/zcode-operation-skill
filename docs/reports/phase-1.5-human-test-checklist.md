# Phase 1.5 — Human Test Checklist

> **Plugin installation note:** The plugin must first be deployed to the ZCode workspace before beginning these steps. The project root is `%USERPROFILE%\Desktop\projects\zcode-operation-skill`. Copy or symlink the project contents into the ZCode plugin directory:
>
> ```
> %USERPROFILE%\.zcode\workspace\default\plugins\zcode-skill-router\
> ```
>
> The `.zcode-plugin/plugin.json` defines the plugin metadata (`name: zcode-skill-router`, `manifest_version: 1`). After copying, ensure `data/skill-index.json` is present (build it with `npm run build-index` from the project root if missing).

## Prerequisites

- ZCode >= 3.14.1 installed
- Node >= 20 available
- Plugin deployed to `%USERPROFILE%\.zcode\workspace\default\plugins\zcode-skill-router\`
- `data/skill-index.json` built (54 skills indexed)

---

## Steps

### Step 1 — Restart ZCode

Close ZCode completely (ensure no background process remains), then reopen the app.

### Step 2 — Verify Plugin Loads

Open **Settings → Plugins** and confirm `zcode-skill-router` is listed as **enabled**. If it does not appear, the plugin was not installed correctly; check that the directory structure matches:

```
zcode-skill-router/
├── .zcode-plugin/
│   └── plugin.json
├── hooks/
│   ├── route.mjs
│   ├── build-index.mjs
│   └── hooks.json
├── src/
│   └── ...
├── data/
│   ├── skill-index.json
│   └── mock-skills/
└── logs/
```

### Step 3 — Open a New Chat Session

Start a fresh chat in ZCode (do not reuse an existing session, to avoid cached context).

### Step 4 — Send the Laravel N+1 Query Prompt

Type and send:

```
Fix the N+1 query in our Laravel Order model.
```

**Expected hook behaviour** (verified against `hooks/route.mjs:133` and `src/core/routing/planner.mjs:44`):
- The `UserPromptSubmit` hook fires and runs `hooks/route.mjs`.
- Route planner detects multi-domain signal (domains: `api`, `database`, `backend`).
- **Mode:** `multi` · **Primary domain:** `api`
- **Top-ranked skills:** `eloquent` (score 2.0), `graphql-basics`, `events-listeners`, `service-container`, `factories`
- A `[SKILL CONTEXT]` block (prefixed with `== SKILL CONTEXT ==`) is injected into the model prompt containing the full content of each ranked skill.
- A RoutePlan JSON object is written to `<project>/.zcode/output.json`.

**Step 4a — Verify Log Entry**

Open `logs/2026-09-*.jsonl` (today's file, e.g. `logs/2026-09-22.jsonl`) and confirm a new line like:

```json
{"ts":"2026-09-22T...","event":"retrieve","query":"Fix the N+1 query in our Laravel Order model.","resultCount":5,"durationMs":XX}
```

**Step 4b — Ask the Model for Confirmation**

Send:

```
Did you receive a SKILL CONTEXT block? What skills were injected?
```

Record the model's response. It should mention at least one of: **eloquent**, **graphql-basics**, or **Laravel N+1 / eager loading**.

---

### Step 5 — Repeat with Prompt (a): Checkout Responsive

Send:

```
Make the checkout component responsive on mobile
```

**Expected:**
- **Mode:** `multi` · **Primary domain:** `frontend`
- **Top-ranked skills:** `responsive-design`, `typography`, `image-optimization`, `patterns`
- Context block injected with those skill contents.

Check `logs/*.jsonl` for a matching retrieve entry, then ask the model to confirm the injected skills.

---

### Step 6 — Repeat with Prompt (b): Login 401 Error

Send:

```
Our login endpoint returns 401 after deploy
```

**Expected:**
- **Mode:** `fallback` (no single domain confidence > 0.90, no 2+ domains ≥ 0.50)
- **Top-ranked skills:** `api-resources`, `architecture`, `context`, `api-routes`, `events-listeners`
- Context block still injected (fallback mode returns top-k BM25 results regardless).

Check logs and confirm with the model.

---

### Step 7 — Repeat with Prompt (c): Pest Test

Send:

```
Write a Pest test for the Order model
```

**Expected:**
- **Mode:** `single` · **Primary domain:** `testing` (confidence > 0.90 with sufficient gap)
- **Top-ranked skills:** `pest-php`, `factories`, `vitest`, `tdd-basics`, `integration-testing`
- Context block injected with testing-domain skill contents.

Check logs and confirm with the model.

---

### Step 8 — Repeat with Prompt (d): Weather (Negative Test)

Send:

```
What is the weather today
```

**Expected:**
- **Mode:** `fallback` — no relevant coding skill should be confidently matched.
- **Top-ranked skills:** `cache`, `data-fetching`, `color-theory`, `accessibility`, `factories` (spurious low-confidence matches are possible due to token overlap).
- A context block **will still be injected** (the hook always injects when `ranked.length > 0` — `hooks/route.mjs:123-125`). This is expected behaviour for the current MVP; the human should note that the weather prompt does **not** produce a clean "no skill" response.

Check logs and confirm with the model. Record that the negative test produced a spurious injection.

---

### Step 9 — Repeat with Prompt (e): Multi-Domain Refactor

Send:

```
Refactor the payment module and update the React checkout
```

**Expected:**
- **Mode:** `fallback` — this cross-domain query (backend + frontend) may not trigger multi-domain routing if no single domain pair exceeds the 0.50 threshold with enough cohesion.
- **Top-ranked skills:** `performance`, `hooks-basics`, `suspense`, `context`, `tdd-basics` (low-confidence spread match).
- Context block injected. The human should assess whether the injected skills are sensibly related to **both** payment/refactoring and React/checkout.

Check logs and confirm with the model.

---

### Step 10 — Report Results

Fill in the table below after completing all steps. Use the model's own confirmation and your log checks as evidence.

| # | Prompt | Expected Mode | Expected Top Skill | Log Entry Found | Model Confirmed Context | Actual Result |
|---|--------|--------------|--------------------|-----------------|------------------------|---------------|
| 1 | Fix the N+1 query in our Laravel Order model. | multi / api | eloquent | ☐ Yes ☐ No | ☐ Yes ☐ No | ________________ |
| 2 | Make the checkout component responsive on mobile | multi / frontend | responsive-design | ☐ Yes ☐ No | ☐ Yes ☐ No | ________________ |
| 3 | Our login endpoint returns 401 after deploy | fallback | api-resources | ☐ Yes ☐ No | ☐ Yes ☐ No | ________________ |
| 4 | Write a Pest test for the Order model | single / testing | pest-php | ☐ Yes ☐ No | ☐ Yes ☐ No | ________________ |
| 5 | What is the weather today | fallback (negative) | *(none relevant)* | ☐ Yes ☐ No | ☐ Yes ☐ No | ________________ |
| 6 | Refactor the payment module and update the React checkout | fallback/multi | *(varies)* | ☐ Yes ☐ No | ☐ Yes ☐ No | ________________ |

---

### Step 11 — Do Not Uninstall the Plugin

The plugin must remain installed for any follow-up testing. Do **not** remove it from the ZCode workspace or edit `marketplace.json`.

---

## Key Files Referenced

| File | Purpose |
|------|---------|
| `hooks/route.mjs` | ZCode hook entry — reads prompt, runs route planner, writes `.zcode/output.json` and logs to `logs/*.jsonl` |
| `hooks/hooks.json` | Hook declaration — listens on `UserPromptSubmit`, runs `route.mjs` |
| `src/core/routing/planner.mjs:44` | `planRoutes()` — single/multi/fallback mode decision logic |
| `src/core/telemetry/logger.mjs:45` | `logRetrieve()` — appends to `logs/<YYYY-MM-DD>.jsonl` |
| `data/skill-index.json` | BM25 inverted index (54 skills) |
| `.zcode-plugin/plugin.json` | Plugin manifest |

## Notes for the Human Tester

- **Log location:** Logs are written to the **project root** `logs/` directory (e.g. `%USERPROFILE%\Desktop\projects\zcode-operation-skill\logs\2026-09-22.jsonl`), not to a `.zcode/routing.jsonl` file inside the plugin directory.
- **Context block format:** The injected context is wrapped in `== SKILL CONTEXT ==` / `== END SKILL CONTEXT ==` delimiters (`hooks/route.mjs:31-39`). Ask the model specifically about a "SKILL CONTEXT block."
- **Negative test caveat:** The current hook always injects a context block when `ranked.length > 0` (`hooks/route.mjs:123`). The weather prompt produces low-confidence matches — this is a known limitation. The human should note whether the injected skills feel clearly irrelevant.
- **Output location:** The RoutePlan JSON is written to `{cwd}/.zcode/output.json` relative to the ZCode project root, not a fixed path.
