# HANDOFF — Skill Router

> Repository: zcode-operation-skill
> Branch: main
> Generated: 2026-10-23 (v1.0.1 stabilization pass complete, awaiting human E2E)

## 1. Where Things Stand

- **v1.0.0 is tagged and released** (Phases 0–7 complete). The tag is intact and
  must not be moved.
- **The v1.0.1 stabilization pass is complete on `main`**: every known P6-H bug
  is fixed, all project docs are synced with reality, build artifacts are
  cleaned, and the **full test suite is green (2898 passed, 0 failed)**.
- **v1.0.1 is deliberately NOT tagged.** It waits for the human end-to-end run
  in ZCode. Tagging it is the project manager's decision after that run.

## 2. What This Stabilization Pass Changed

| Block | Subject | What it did |
|-------|---------|-------------|
| A.5r | `fix: fail explicitly on remaining silent readdir catches` | Completed P6-H-016: all six data-producing readers classify ENOENT/EISDIR as benign and EACCES/EPERM/EIO as named errors. |
| A.6 | `fix: implement --help on every CLI subcommand` | P6-H-020: `--help`/`-h` prints usage and stops, before any side effect (incl. `deploy`). |
| A.7 | `fix: remove reranker from default path` | P6-H-026: reranker is now an experimental opt-in (off by default); `docs/reranker.md`. |
| A.8 | `fix: redact personal path from tracked files` | P6-H-027: personal home paths removed from tracked files; `release-check` greps for them. |
| B.1–B.6 | `docs: …` (six commits) | Synced implementation plan, current-state, CHANGELOG, ai-context, security report, architecture/README/decision-dictionary. |
| C.1 | `chore: remove build artifacts and update gitignore` | Removed the accidental tracked `tmp/` tree and scratch clutter; hardened `.gitignore`. |
| D.1 | `test: fix ETIMEDOUT failures in analytics and tuning tests` | Hoisted the optimizer's threshold-independent ranking out of the grid (bit-identical, ~45× cheaper); relaxed stale test constants to invariants (D34); capped analyzer log reads; cut routing dead work + samples; re-scoped the perf p95 gate to internal time (D40); bounded the runner's run-coverage pass. |
| D.2 | `fix: restore run-synthetic-benchmark argument handling` | Bare invocation now defaults to a 54-skill corpus instead of exiting 1. |
| D.3 | `test: full suite green` | Classified EISDIR as a benign skip in both signals readers; gated the ONNX-vs-FNV-1a test on model availability. Suite now exits 0. |

## 3. Frozen Baseline (unchanged by this pass)

| Metric | Value |
|--------|-------|
| Index size | 258 entries (252 leaf + 6 router) |
| Frozen BM25 benchmark Top-1 | 0.6462 (84/130) via `tests/run-benchmark.mjs` |
| Health | 8/8 checks pass |
| Full test suite | 2898 passed, 0 failed (`node scripts/run-all-tests.mjs`) |
| Router skills in ZCode mirror | 6 (design, laravel, meta, next, react, test) |

## 4. What the Human Must Do Now (E2E, then v1.0.1)

The hook only becomes active after a **full ZCode restart**. Follow `docs/zcode-e2e-test.md`
"Run Sequence" — the same steps, condensed:

1. **Pre-flight gate** — `node scripts/verify-e2e-ready.mjs` → must print
   `READY FOR HUMAN E2E`. If not, fix the listed reason (usually `deploy` or
   `reindex`) and re-run.
2. **Sync the mirror** — `node bin/skill-router.mjs deploy`.
3. **Full ZCode restart** — fully quit and relaunch ZCode (a running session does
   not load a newly registered hook).
4. **Confirm the hook** — `node bin/skill-router.mjs verify --deep`; expect
   `Hook registered` and `Hook invocable` to PASS.
5. **Send the 6 prompts** in ZCode, one at a time (they cover every routing
   mode):
   1. `Fix the N+1 query in the Order model.` (implicit backend)
   2. `$laravel write a Pest test for the Order model` (explicit router-laravel)
   3. `$next how do I add middleware` (explicit router-next)
   4. `Make the checkout component responsive on mobile.` (implicit frontend)
   5. `What is the weather today?` (negative — must abstain)
   6. `Refactor the payment module and update the React checkout.` (multi-domain)
6. **Read the results** — today's decisions land in `logs/routing-<today>.jsonl`;
   run `node scripts/zcode-e2e-verify.mjs`.
7. **Record actual vs. expected** — fill in `docs/reports/phase-7.7-e2e-results.md`.
8. **Tag decision** — the project manager reviews the results and decides whether
   to tag v1.0.1.

Success criteria and the expected-mode/router/tier table are in
`docs/reports/phase-7.7-e2e-results.md` and `docs/zcode-e2e-test.md`.

## 5. Open Items & Caveats

- **The "a1" v1.0.0 commit message is unrecoverable.** It was pushed with an
  empty/meaningless subject; the mission forbids rebase/force-push, so it stays.
- **Mirror leaf drift is pre-existing and non-blocking.** `verify --deep` may
  report a few stale leaf copies in the ZCode mirror; leaves are disabled for
  routing (only the 6 routers route), and the hook drives decisions from the
  in-project index, not the mirror. `deploy` refreshes the mirror.
- **ONNX is opt-in and SLM is off** — the default path is dependency-light
  BM25 + FNV-1a; the ONNX backend is available via
  `SKILL_ROUTER_EMBEDDING_PROVIDER=onnx` when its model is cached.
- **Reranker is an experimental opt-in** (off by default; held-out R² is
  negative, so it is not recommended — `docs/reranker.md`).
- **`logs/pre-existing-failures.json` is a local (gitignored) provenance
  record**, not a tracked file; its `_note` records which tolerated failures the
  D.1/D.2/D.3 fixes cleared.

## 6. Repository Map

| Path | Purpose |
|------|---------|
| `.zcode-plugin/` | ZCode plugin manifest and install bundle |
| `bin/skill-router.mjs` | CLI entry point (19 subcommands; all answer `--help`) |
| `hooks/` | `route.mjs` (UserPromptSubmit hook, fail-open), `build-index.mjs` |
| `src/` | Core modules, CLI handlers, config, analytics, sync, deploy, embeddings |
| `src/telemetry/` | Decision logger, signal recorder, outcome correlator, session tracker |
| `src/core/retriever/` | BM25 + hybrid retrievers, weighted RRF, attribution, adaptive weights |
| `router-skills/` | The 6 router skill manifests |
| `data/` | Skill manifests, built index, embeddings, thresholds, weights, domains |
| `tests/` | Unit / integration / E2E suites, scale + SLM benchmarks, coverage runner |
| `docs/` | Architecture, reports, CLI reference, problem tracker, tuning + embeddings guides |
| `scripts/` | Utility, install, fixture and E2E-prepare/verify/ready scripts |

## 7. Key Commands

```
node scripts/verify-e2e-ready.mjs                       # E2E readiness gate
node bin/skill-router.mjs health                          # 8/8 health checks
node bin/skill-router.mjs verify --deep                   # mirror + index + hook
node bin/skill-router.mjs deploy                          # sync mirror + register hook
node scripts/run-all-tests.mjs                            # full suite (2898/0)
node tests/run-benchmark.mjs --corpus real --router flat  # frozen BM25 baseline
```

`npm` is not on the subprocess PATH on this host — always invoke `node <file>`
directly, never `npm test` / `npm run`.
