# Phase 7.7 — End-to-End Results

> **Status:** PENDING — awaiting the human run (this is a fill-in template)
>
> **Date of run:** <YYYY-MM-DD, fill in>
> **ZCode version:** <fill in>
> **Machine:** <fill in>
>
> Companion to `phase-7.7-e2e-validation.md` (the preparation report) and
> `docs/zcode-e2e-test.md` (the step-by-step procedure). This file is where the
> actual observed outcomes are recorded so the pass/fail decision is reviewable
> and reproducible.

## Pre-Flight

Paste the output of the readiness gate that preceded the run:

```bash
$ node scripts/verify-e2e-ready.mjs
```

```
<paste "READY FOR HUMAN E2E" / "NOT READY — ..." output here>
```

Confirm the sequence from `docs/zcode-e2e-test.md` "Run Sequence" was followed:

- [ ] `verify-e2e-ready.mjs` printed READY
- [ ] `deploy` ran (mirror synced / hook registered)
- [ ] **Full ZCode restart** (quit and relaunch, not just a new window)
- [ ] `verify --deep` shows `Hook registered` + `Hook invocable` PASS

## Results by Prompt

For each prompt, record the mode / router / tier / selected skills the log shows
for today's `logs/routing-<today>.jsonl` entry, and whether the model actually
received the `[SKILL ROUTER]` context block.

| # | Prompt | Expected | Observed mode | Observed router | Observed tier | Observed selected skills | `[SKILL ROUTER]` block received? | Pass? |
|---|--------|----------|---------------|-----------------|---------------|--------------------------|-----------------------------------|-------|
| 1 | `Fix the N+1 query in the Order model.` | implicit / none / bm25 / backend-laravel-* | <fill> | <fill> | <fill> | <fill> | <yes/no> | <✓/✗> |
| 2 | `$laravel write a Pest test for the Order model` | explicit / router-laravel / bm25 / backend-laravel-* | <fill> | <fill> | <fill> | <fill> | <yes/no> | <✓/✗> |
| 3 | `$next how do I add middleware` | explicit / router-next / bm25 / frontend-nextjs-* | <fill> | <fill> | <fill> | <fill> | <yes/no> | <✓/✗> |
| 4 | `Make the checkout component responsive on mobile.` | implicit / none / bm25 / frontend-* | <fill> | <fill> | <fill> | <fill> | <yes/no> | <✓/✗> |
| 5 | `What is the weather today?` | implicit / none / **none** / empty (abstain) | <fill> | <fill> | <fill> | <fill> | <should be NO> | <✓/✗> |
| 6 | `Refactor the payment module and update the React checkout.` | implicit / none / bm25 / backend-* + frontend-* | <fill> | <fill> | <fill> | <fill> | <yes/no> | <✓/✗> |

## Log Excerpt

Paste the 6 decision lines from `logs/routing-<today>.jsonl` (run
`node scripts/zcode-e2e-verify.mjs` to pull them):

```
<paste the 6 JSON lines here>
```

> Raw prompts are never logged — only `promptHash` (SHA-256) appears. That is
> expected and is not a failure.

## Verdict

Success criteria (all must hold):

- [ ] All 6 prompts produced a routing decision (6 log lines)
- [ ] Prompts 1, 2, 3, 4, 6 produced a `[SKILL ROUTER]` block (non-empty `selectedSkills`)
- [ ] Prompt 5 abstained (empty `selectedSkills`, `tier: none`)
- [ ] Prompts 2 and 3 routed explicitly (`mode: explicit`, correct router)
- [ ] No `event: error` entries in the logs
- [ ] All latencies under 3500 ms (hook timeout)

**Overall:** <PASS / PARTIAL / FAIL — and one line on what, if anything, the
project manager must act on>

**Release decision:** this run is the input for the v1.0.1 tag. Record the
project manager's verdict here: <pending / cleared for v1.0.1 / blocked — why>
