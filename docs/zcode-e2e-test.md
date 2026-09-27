# ZCode Skill Router — End-to-End Test Procedure

This document describes the step-by-step procedure for running a real-world
end-to-end test of the ZCode Skill Router plugin. The test validates that the
hook correctly routes prompts to the appropriate skills and injects context
into the model.

## Prerequisites

1. ZCode is installed and the Skill Router plugin is deployed.
2. The skill index is built (`data/skill-index.json` exists).
3. The hook is registered in `~/.zcode/cli/config.json`.
4. **Router skills installed in ZCode mirror** — run the following if the `Routers installed` health check shows any missing:

```bash
node bin/skill-router.mjs deploy
```

Run the preparation script first:

```bash
node scripts/zcode-e2e-prepare.mjs --yes
```

This will:
- Verify Node.js >= 20
- Build the skill index
- Run sync to mirror the plugin
- Register the hook (if not already registered)
- Run verification

## Test Prompts

The human must send these **6 prompts** to ZCode, covering every routing mode:

### Prompt 1: Implicit Backend Routing

```
Fix the N+1 query in the Order model.
```

**Expected behavior:**
- Mode: implicit
- Router: none
- Tier: bm25
- Selected skills: `backend-laravel-eloquent`, `backend-api-rest` (or similar)
- The model should receive a `[SKILL ROUTER]` block with Laravel backend context

**Record:**
- [ ] Did the model receive a `[SKILL ROUTER]` block? (yes/no)
- [ ] Which skill(s) were selected?
- [ ] How long did it take? (latency in ms)

---

### Prompt 2: Explicit Laravel Routing

```
$laravel write a Pest test for the Order model
```

**Expected behavior:**
- Mode: explicit
- Router: `router-laravel`
- Tier: bm25
- Selected skills: scoped to backend domain (e.g., `backend-laravel-migrations`, `backend-laravel-eloquent`)
- The `$laravel` mention should be stripped from the cleaned prompt
- The model should receive a `[SKILL ROUTER]` block with Laravel-specific context

**Record:**
- [ ] Did the model receive a `[SKILL ROUTER]` block? (yes/no)
- [ ] Was the router `router-laravel`? (yes/no)
- [ ] Which skill(s) were selected?
- [ ] How long did it take? (latency in ms)

---

### Prompt 3: Explicit Next.js Routing

```
$next how do I add middleware
```

**Expected behavior:**
- Mode: explicit
- Router: `router-next`
- Tier: bm25
- Selected skills: scoped to frontend/nextjs domain
- The `$next` mention should be stripped from the cleaned prompt
- The model should receive a `[SKILL ROUTER]` block with Next.js context

**Record:**
- [ ] Did the model receive a `[SKILL ROUTER]` block? (yes/no)
- [ ] Was the router `router-next`? (yes/no)
- [ ] Which skill(s) were selected?
- [ ] How long did it take? (latency in ms)

---

### Prompt 4: Implicit Frontend Routing

```
Make the checkout component responsive on mobile.
```

**Expected behavior:**
- Mode: implicit
- Router: none
- Tier: bm25
- Selected skills: `frontend-react-responsive`, `frontend-css-grid` (or similar)
- The model should receive a `[SKILL ROUTER]` block with frontend context

**Record:**
- [ ] Did the model receive a `[SKILL ROUTER]` block? (yes/no)
- [ ] Which skill(s) were selected?
- [ ] How long did it take? (latency in ms)

---

### Prompt 5: Negative Test — Must Abstain

```
What is the weather today?
```

**Expected behavior:**
- Mode: implicit
- Router: none
- Tier: none (abstention)
- Selected skills: empty array `[]`
- The model should **NOT** receive a `[SKILL ROUTER]` block
- The hook should exit 0 (fail-open) with no output

**Record:**
- [ ] Did the model receive a `[SKILL ROUTER]` block? (yes/no)
- [ ] Was the tier `none`? (yes/no)
- [ ] Were no skills selected? (yes/no)
- [ ] How long did it take? (latency in ms)

---

### Prompt 6: Multi-Domain Routing

```
Refactor the payment module and update the React checkout.
```

**Expected behavior:**
- Mode: implicit
- Router: none
- Tier: bm25
- Selected skills: should include both backend and frontend skills
  - Backend: `backend-api-rest`, `backend-laravel-eloquent`
  - Frontend: `frontend-react-hooks`, `frontend-react-state`
- The model should receive a `[SKILL ROUTER]` block with multi-domain context

**Record:**
- [ ] Did the model receive a `[SKILL ROUTER]` block? (yes/no)
- [ ] Were both backend and frontend skills selected? (yes/no)
- [ ] Which skill(s) were selected?
- [ ] How long did it take? (latency in ms)

---

## How to Read the Logs

After running all 6 prompts, the routing decisions are logged to:

```
logs/routing-YYYYMMDD.jsonl
```

Each line is a JSON object with this shape:

```json
{
  "ts": "2026-09-27T12:00:00.000Z",
  "mode": "implicit" | "explicit",
  "router": null | "router-laravel" | "router-next" | ...,
  "tier": "bm25" | "none" | "fail-open",
  "selectedSkills": ["skill-name-1", "skill-name-2"],
  "latencyMs": { "total": 42, "bm25": 38 },
  "confidence": 0.92,
  "promptHash": "sha256:abc123...",
  "sessionId": null,
  "version": null
}
```

**Important:** Raw prompts are never stored — only SHA-256 hashes appear.

To view the logs:

```bash
cat logs/routing-20260927.jsonl | jq .
```

Or use the verification script:

```bash
node scripts/zcode-e2e-verify.mjs
```

## Expected Outcomes Summary

| # | Prompt | Expected Mode | Expected Router | Expected Tier | Expected Skills |
|---|--------|---------------|-----------------|---------------|-----------------|
| 1 | Fix the N+1 query in the Order model. | implicit | none | bm25 | backend-laravel-* |
| 2 | `$laravel` write a Pest test for the Order model | explicit | router-laravel | bm25 | backend-laravel-* |
| 3 | `$next` how do I add middleware | explicit | router-next | bm25 | frontend-nextjs-* |
| 4 | Make the checkout component responsive on mobile. | implicit | none | bm25 | frontend-* |
| 5 | What is the weather today? | implicit | none | none | (empty) |
| 6 | Refactor the payment module and update the React checkout. | implicit | none | bm25 | backend-* + frontend-* |

## Success Criteria

The E2E test passes if:

1. **All 6 prompts produce a routing decision** (entries in the log)
2. **Prompts 1, 2, 3, 4, 6 produce a `[SKILL ROUTER]` block** (non-empty `selectedSkills`)
3. **Prompt 5 abstains** (empty `selectedSkills`, `tier: none`)
4. **Prompts 2 and 3 route explicitly** (`mode: explicit`, correct router)
5. **No errors in the logs** (no `event: error` entries)
6. **All latencies are under 3500ms** (hook timeout)

## Reporting Success or Failure

After running the test:

1. Run `node scripts/zcode-e2e-verify.mjs` and capture the output
2. Compare the actual outcomes against the expected outcomes above
3. Update `docs/reports/phase-7.7-e2e-results.md` with the real results
4. If any criterion fails, note which prompt and what went wrong

## Troubleshooting

If the hook does not fire:

```bash
# Check if the hook is registered
node bin/skill-router.mjs doctor

# Check the ZCode CLI config
cat ~/.zcode/cli/config.json | jq '.hooks'

# Test the hook directly
echo '{"prompt":"test","cwd":"."}' | node hooks/route.mjs
```

If the index is missing or stale:

```bash
# Rebuild the index
node hooks/build-index.mjs

# Check the index
cat data/skill-index.json | jq 'length'
```

If the sync has drift:

```bash
# Re-sync
node bin/skill-router.mjs sync
```
