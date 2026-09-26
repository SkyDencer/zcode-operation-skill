# HANDOFF — Skill Router

> Repository: zcode-operation-skill
> Generated: 2026-09-26 (updated for the Phase 6 end state)
> Current branch: main

## 1. What Is Done

Phases 0, 0.5a, 0.5b, 1, 2, 2.5, 3, 4, 5 and 6 are complete. Phase 7
(Hardening and Corpus Truth) is the next planned work. Phase 6 is 12
sub-phases and 44 commits (`f799d99`..`6ca4a82`, 158 files, +19,518/-774);
see `docs/reports/phase-6-final-report.md`.

**Test results** (Sub-Phase 6.12 verification run, `package.json` `scripts.test`
driven step by step with `node <file>`; npm is not on the subprocess PATH on
this host):

| Category | Passed | Failed | Total |
|----------|--------|--------|-------|
| Test-chain steps | 73 | 0 | 73 |
| Assertions | 2024 (as summed by a concurrent 6.12 reporting pass; not independently verified) | 0 | 2024 |

All tests pass with zero regressions. The chain grew from 43 to 73 steps during
Phase 6 (30 test files added, none removed).

**Coverage** (not re-measured at 6.12): `logs/coverage-2026-09-25.json`, written
by the Sub-Phase 6.6 run, reports mean line 87.55%, branch 68.70%, function
83.23% across 91 modules, 23 of them at 100% line coverage. The 6.6 test audit
separately measured 80/86 modules reachable by at least one test (93.0%), with 6
unreachable.

**BM25 real-corpus benchmark** (N=60 index entries, 130 prompts):

| Metric | Value |
|--------|-------|
| Top-1 accuracy | 92.31% (120/130) |
| Top-1 on the 54-leaf corpus the hook searches | 96.92% (126/130) |
| Recall@3 | 89.23% (116/130) |
| Set Recall@5 (116 skill prompts) | 100% (116/116) |
| Median latency | 3 ms |
| P95 latency | 5 ms |
| Fallback rate | 8.46% (11/130) |

The frozen baseline is unchanged across Phases 4, 5 and 6.

**Two-mode routing benchmark** (40 prompts: 15 explicit, 25 implicit):

| Metric | Value |
|--------|-------|
| Mode Detection Accuracy | 100% (15/15) |
| Router Selection Accuracy | 100% (15/15) |
| Implicit Top-1 Accuracy | 100% (25/25) |
| Overall Success Rate | 100% (40/40) |
| Latency p50 | 2 ms (explicit: 1ms, implicit: 3ms) |

**Adaptive feedback loop** (Phase 5, revalidated in 6.11 against the unchanged default provider):

| Metric | Value |
|--------|-------|
| Attributions available | 127 / 130 |
| Positive outcomes | 118 |
| Negative outcomes | 12 |
| Unknown outcomes | 0 |
| Dominant field: name | 41 |
| Dominant field: description | 85 |
| Dominant field: keywords | 1 |
| Proposed weight shift | name: 3→2.71, desc: 2→2.71, kw: 1→0.57 |
| Guardrail result | refused (description delta 0.715 > MAX_DELTA 0.5) |

The refusal is the correct outcome and was not forced through.

**Embedding provider benchmark** (Phase 6, 130-prompt corpus, 60-entry index):

| Mode | Top-1 | Set Recall@5 (116) | Median |
|---|---|---|---|
| Flat (BM25), shipped | 92.31% | 1.0000 | 3 ms |
| Hybrid, FNV-1a, shipped weights | 92.31% | 1.0000 | 3 ms |
| Hybrid, ONNX, shipped weights | 92.31% | 1.0000 | 3 ms |
| Hybrid, FNV-1a, semantic 0.6 | 18.46% | 0.8534 | 36 ms |
| Hybrid, ONNX, semantic 0.6 | 76.15% | 0.9052 | 1445 ms |

**Decision: the default provider stays FNV-1a and the semantic weight stays 0.0.**
The first three rows are identical because with `semantic = 0.0` the provider is
never constructed. With the semantic channel switched on, ONNX clears the
accuracy half of the decision rule (+5.18 pp Set Recall@5) but fails the latency
half by 12-14x (1445 ms median in Sub-Phase 6.10, 1212 ms when re-measured in the
6.12 reporting pass, against a 100 ms budget), and both semantic-on modes score
below the pure-BM25 configuration that ships. ONNX remains available as an
opt-in.

Caveat: synthetic scale benchmarks (N=50..500) show accuracy dropping from 85% to ~39%. This is lexical poverty of randomly generated skill names, not a BM25 scalability wall. The real 60-skill corpus holds at 92.31%.

**Router capabilities today:**

- BM25 flat retrieval with weighted fields (name x3, description x2, keywords x1)
- Explicit `$mention` detection with 6 router aliases (next, react, laravel, design, test, meta)
- Implicit routing on the leaf-skill corpus (filters out router-* entries) with a relevance floor, so the hook abstains instead of injecting skills for every prompt
- **Embedding provider abstraction** (`createProvider`) with two backends: FNV-1a (256-dim, default, zero dependency) and ONNX / `Xenova/all-MiniLM-L6-v2` (384-dim, opt-in via `SKILL_ROUTER_EMBEDDING_PROVIDER`)
- **Hybrid retrieval on weighted RRF** (k=60) with runtime-configurable `SKILL_ROUTER_RRF_BM25_WEIGHT` / `SKILL_ROUTER_RRF_SEMANTIC_WEIGHT`, fail-open provider fallback, and an `embeddingSimilarity` reranker feature
- SLM opt-in infrastructure (Qwen2.5-0.5B); disabled by default due to underperformance
- Hierarchical domain-first routing (available as the `selectRouter()` `experimental` option; deprecated as default — there is no `--experimental` CLI flag)
- Route selector auto-picks flat by default based on corpus size
- Context budget manager with paragraph-safe truncation
- LRU query cache with 5-minute TTL and index-fingerprint keying
- Synonym expansion (opt-in; curated + co-occurrence + abbreviations sources)
- Adaptive threshold tuning (grid search over high/medium thresholds)
- Skill quality validator (6-field check)
- Sync planner/writer/state for mirroring project skills into ZCode
- Disable mechanism (mirror-delete or shadow SKILL.md; best-guess -- no native ZCode mechanism found)
- Two-source index with project-wins collision resolution, one shared default corpus for both index builders
- Usage analytics (per-day histograms, top-10 skills, prompt hash tracking)
- Import pipeline with **path-traversal and symlink safety** (both blockers fixed in Phase 6)
- Deploy subsystem (SHA-256 comparison, safe mirror writes, dry-run support, snapshot rollback)
- Structured JSONL logging with daily rotation filenames
- **Adaptive feedback loop**: implicit user-signal collection, outcome correlation, per-field BM25 attribution, gradient-free weight adjustment with MAX_DELTA and accuracy-tolerance guardrails, snapshot rollback, drift-gated fixtures
- **Coverage tooling** (`node tests/run-coverage.mjs`) keyed by repo-relative path
- **CLI with 18 subcommands**: list, add, remove, validate, reindex, benchmark, stats, import, sync, sources, verify, doctor, deploy, analytics, feedback, health, tune, help
- One runtime dependency, used only by the opt-in ONNX provider; the default path installs nothing

## 2. What Is Not Done

- No real-world deployment test in ZCode 3.14.1 since Phase 0.5b (manual E2E testing remains pending)
- The ZCode skill disable mechanism is a best-guess approach (no native per-skill disable found in ZCode 3.14.1); mirror-delete and shadow methods are unverified against actual ZCode behavior
- Scale benchmark uses synthetic data; real scalability beyond N=60 is unverified
- The semantic embedding channel is at weight 0.0 by default, so the ONNX provider is implemented, benchmarked and opt-in but **inert in the shipped configuration**
- SLM (Qwen2.5-0.5B) underperforms BM25 and exceeds hook timeout; not ready for production
- No log rotation cleanup (logs accumulate indefinitely; Phase 4 was planned but implementation deferred)
- Adaptation has never been exercised against real user data — the signals on disk are test-generated and age out past the 10-minute stale window, which is why `feedback --outcomes` legitimately reports 0 negative on live logs
- 19 High static-audit findings remain open (`P6-H-001`–`P6-H-019`), plus `P6-H-020`–`P6-H-026`
- Nine hand-written documents and nine code files exceed the 300-line rule

## 3. Steps for User (ordered checklist)

1. Review `docs/reports/phase-6-final-report.md` and the three audit reports it links
2. Review commits: `git log --oneline -40`
3. Push to GitHub when ready: `git push origin main` (the 6.3 range is already pushed; the rest of Phase 6 is local)
4. Deploy routers to ZCode mirror: `node bin/skill-router.mjs deploy`
5. Restart ZCode and test these 8 prompts:
   - "Laravel eager loading optimization"
   - "$laravel migration for users table"
   - "React custom hook for animations"
   - "$react context API patterns"
   - "Next.js app router data fetching"
   - "$next middleware rewrite"
   - "GraphQL schema design best practices"
   - "Write integration tests with Playwright"
6. Run health checks:
   ```
   node bin/skill-router.mjs health
   node bin/skill-router.mjs verify --deep
   node bin/skill-router.mjs doctor
   node tests/run-benchmark.mjs --mode bm25
   node tests/two-mode-benchmark/runner.mjs --mode all
   ```
7. Use ZCode for 2–4 weeks to accumulate real routing decisions and feedback signals
8. Run tuning review:
   ```
   node bin/skill-router.mjs tune --status
   node bin/skill-router.mjs tune --analyze
   node bin/skill-router.mjs feedback --outcomes
   node bin/skill-router.mjs tune --auto --dry-run
   ```
9. Record results and decide whether to proceed to Phase 7

## 4. How to Verify Everything

Run from the repository root. `npm` is not on the subprocess PATH on this host —
use `node <file>`, never `npm test` / `npm run`.

```
node bin/skill-router.mjs health
node bin/skill-router.mjs verify --deep
node bin/skill-router.mjs doctor
node bin/skill-router.mjs deploy --dry-run
node tests/run-benchmark.mjs --mode bm25
node tests/two-mode-benchmark/runner.mjs
node tests/slm-benchmark/runner.mjs --mode hybrid
node tests/run-coverage.mjs
node bin/skill-router.mjs tune --status
node bin/skill-router.mjs tune --analyze
node bin/skill-router.mjs feedback --outcomes
```

For the whole suite, run each of the 73 steps of the `package.json` `test` script
individually; that is what produced the 73/73 result in the Phase 6 final report.

## 5. Known Issues Carried Forward

- Best-guess disabler mechanism (no native ZCode per-skill disable)
- Synthetic scale benchmark caveat (not representative of real performance)
- Semantic channel at weight 0.0 — the ONNX provider is opt-in and inert by default
- SLM underperformance vs BM25 (0.5B model too small)
- Reranker weights do not generalise: held-out R² -4.58 against an in-sample ~0.1 (`P6-H-026`). The fit is a weak training signal, not a result, and `data/reranker-weights.json` was deliberately not regenerated
- No negative feedback signals from real usage; weight adaptation is untested against real corrective behaviour
- Three silent destructive failures remain open: deploy rollback against an empty snapshot (`P6-H-014`), mass removal planned on an unreadable tree (`P6-H-015`), and `positive` misclassification of the whole outcome corpus on any non-`ENOENT` read error (`P6-H-016`)
- No subcommand implements `--help`, so `deploy --help` deploys (`P6-H-020`)
- Raw prompts are persisted in logs, contradicting the documented privacy invariant (`P6-H-003`)
- See `docs/problems.md` for the full list of open items

## 6. Repository Map

| Directory | Description |
|-----------|-------------|
| `.zcode-plugin/` | ZCode plugin manifest and installation bundle |
| `bin/` | CLI entry point (`skill-router.mjs`) with 18 subcommands |
| `hooks/` | ZCode hook implementations (`route.mjs`, `build-index.mjs`) |
| `src/` | Source code: core modules, CLI handlers, config, analytics, sync, deploy, SLM |
| `src/telemetry/` | Feedback decision logger, signal recorder, outcome correlator, session tracker |
| `src/core/retriever/` | BM25 and hybrid retrievers, weighted RRF (`rrf.mjs`), attribution engine, adaptive weight adjuster |
| `src/core/embeddings/` | Provider abstraction (`provider.mjs`, `resolve.mjs`) and the `fnv1a` / `onnx` backends |
| `router-skills/` | 6 router skill manifests (router-next, router-react, etc.) |
| `data/` | Skill manifests, built index, embeddings, synonyms, thresholds, baseline, weights, domain metadata |
| `tests/` | 73-step test chain, unit / integration / E2E suites, scale and SLM benchmarks, coverage runner |
| `docs/` | Architecture, reports (including the four Phase 6 audit reports), CLI reference, getting-started, problem tracker, tuning guide, embeddings guide |
| `scripts/` | Utility, install and fixture-regeneration scripts |
| `logs/` | Runtime JSONL logs (rotated by date; no automatic cleanup) |

