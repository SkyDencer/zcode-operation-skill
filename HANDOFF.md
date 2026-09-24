# HANDOFF — Skill Router

> Repository: zcode-operation-skill
> Generated: 2026-09-24
> Current branch: main

## 1. What Is Done

Phases 0, 0.5a, 0.5b, 1, 2, 2.5, 3, 4, and 5 are complete. Phase 6 (semantic embedding upgrade) is the next planned work.

**Test results** (last verified 2026-09-24):

| Category | Passed | Failed | Total |
|----------|--------|--------|-------|
| Unit tests | 517 | 0 | 517 |
| Integration tests | 166 | 0 | 166 |
| **Grand total** | **683** | **0** | **683** |

All tests pass with zero regressions. The 4 pre-existing failures from Phase 3 have been resolved.

**BM25 real-corpus benchmark** (N=60 skills, 130 prompts):

| Metric | Value |
|--------|-------|
| Top-1 accuracy | 92.31% (120/130) |
| Recall@3 | 89.23% (116/130) |
| Median latency | 3 ms |
| P95 latency | 5 ms |
| Fallback rate | 8.46% (11/130) |

**Two-mode routing benchmark** (40 prompts: 15 explicit, 25 implicit):

| Metric | Value |
|--------|-------|
| Mode Detection Accuracy | 100% (15/15) |
| Router Selection Accuracy | 100% (15/15) |
| Implicit Top-1 Accuracy | 100% (25/25) |
| Overall Success Rate | 100% (40/40) |
| Latency p50 | 2 ms (explicit: 1ms, implicit: 3ms) |

**Adaptive feedback loop benchmark** (Phase 5):

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

Caveat: synthetic scale benchmarks (N=50..500) show accuracy dropping from 85% to ~39%. This is lexical poverty of randomly generated skill names, not a BM25 scalability wall. The real 60-skill corpus holds at 92.31%.

**Router capabilities today:**

- BM25 flat retrieval with weighted fields (name x3, description x2, keywords x1)
- Explicit `$mention` detection with 6 router aliases (next, react, laravel, design, test, meta)
- Implicit BM25 routing on leaf-skill corpus (filters out router-* entries)
- Hybrid retrieval via Reciprocal Rank Fusion (BM25 + FNV-1a embedding; k=60) — opt-in, underperforms BM25
- SLM opt-in infrastructure (Qwen2.5-0.5B); disabled by default due to underperformance
- Hierarchical domain-first routing (available via `--experimental`; deprecated as default)
- Route selector auto-picks flat by default based on corpus size
- Context budget manager with paragraph-safe truncation
- LRU query cache with 5-minute TTL and index-fingerprint keying
- Synonym expansion (opt-in; curated + co-occurrence + abbreviations sources)
- Adaptive threshold tuning (grid search over high/medium thresholds)
- Skill quality validator (6-field check)
- Sync planner/writer/state for mirroring project skills into ZCode
- Disable mechanism (mirror-delete or shadow SKILL.md; best-guess -- no native ZCode mechanism found)
- Two-source index with project-wins collision resolution
- Usage analytics (per-day histograms, top-10 skills, prompt hash tracking)
- Import pipeline with security checks (path traversal, symlink safety)
- Deploy subsystem (SHA-256 comparison, safe mirror writes, dry-run support)
- Structured JSONL logging with daily rotation filenames
- **Adaptive feedback loop**: implicit user-signal collection, outcome correlation, per-field BM25 attribution, gradient-free weight adjustment with MAX_DELTA and accuracy-tolerance guardrails, snapshot rollback
- **CLI with 18 subcommands**: list, add, remove, validate, reindex, benchmark, stats, import, sync, sources, verify, doctor, deploy, analytics, feedback, health, tune, help
- Zero npm dependencies; plain ESM

## 2. What Is Not Done

- No real-world deployment test in ZCode 3.14.1 since Phase 0.5b (manual E2E testing remains pending)
- The ZCode skill disable mechanism is a best-guess approach (no native per-skill disable found in ZCode 3.14.1); mirror-delete and shadow methods are unverified against actual ZCode behavior
- Scale benchmark uses synthetic data; real scalability beyond N=60 is unverified
- Hybrid retrieval underperforms BM25 alone (~55% vs 92% Top-1 on real corpus); not ready for production
- SLM (Qwen2.5-0.5B) underperforms BM25 and exceeds hook timeout; not ready for production
- No pre-trained embedding model integrated (deferred to Phase 6)
- No log rotation cleanup (logs accumulate indefinitely; Phase 4 was planned but implementation deferred)
- Adaptation has not yet seen negative user signals — all 300 logged decisions are positive (no retry/dismiss/override captured), so weight adjustments remain untested against real corrective feedback

## 3. Steps for User (ordered checklist)

1. Review this file and `docs/reports/phase-3-final-report.md`
2. Review commits: `git log --oneline -20`
3. Push to GitHub when ready: `git push origin main`
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
   node bin/skill-router.mjs verify
   node bin/skill-router.mjs doctor
   node tests/run-benchmark.mjs --mode bm25
   node tests/two-mode-benchmark/runner.mjs --mode all
   ```
7. Use ZCode for 2–4 weeks to accumulate routing decisions and feedback signals
8. Run tuning review:
   ```
   node bin/skill-router.mjs tune --status
   node bin/skill-router.mjs tune --analyze
   node bin/skill-router.mjs feedback --outcomes
   node bin/skill-router.mjs tune --auto --dry-run
   ```
9. Record results and decide whether to proceed to Phase 6

## 4. How to Verify Everything

Run from the repository root:

```
node tests/run-benchmark.mjs --mode bm25
node tests/two-mode-benchmark/runner.mjs --mode all
node bin/skill-router.mjs verify
node bin/skill-router.mjs doctor
node bin/skill-router.mjs deploy --dry-run
node bin/skill-router.mjs tune --status
node bin/skill-router.mjs tune --analyze
node bin/skill-router.mjs feedback --outcomes
node --test tests/slm/client.test.mjs
node --test tests/routing/explicit.test.mjs
node --test tests/deploy/planner.test.mjs
node --test tests/deploy/writer.test.mjs
node --test tests/retriever/attribution.test.mjs
node --test tests/retriever/weights.test.mjs
node --test tests/cli/tune.test.mjs
node --test tests/cli/tune-guard.test.mjs
```

## 5. Known Issues Carried Forward

- Best-guess disabler mechanism (no native ZCode per-skill disable)
- Synthetic scale benchmark caveat (not representative of real performance)
- Hybrid retrieval underperformance vs BM25 alone
- SLM underperformance vs BM25 (0.5B model too small)
- No negative feedback signals captured yet (all 300 decisions are positive); weight adaptation is untested against real corrective behaviour
- See `docs/problems.md` for additional open items

## 6. Repository Map

| Directory | Description |
|-----------|-------------|
| `.zcode-plugin/` | ZCode plugin manifest and installation bundle |
| `bin/` | CLI entry point (`skill-router.mjs`) with 18 subcommands |
| `hooks/` | ZCode hook implementations (`route.mjs`, `build-index.mjs`) |
| `src/` | Source code: core modules, CLI handlers, config, analytics, sync, deploy, SLM |
| `src/telemetry/` | Feedback decision logger, signal recorder, outcome correlator, session tracker |
| `src/core/retriever/` | Attribution engine (`attribution.mjs`), adaptive weight adjuster (`weights.mjs`) |
| `router-skills/` | 6 router skill manifests (router-next, router-react, etc.) |
| `data/` | Skill manifests, built index, synonyms, thresholds, baseline, weights, domain metadata |
| `tests/` | Unit tests, integration tests, E2E tests, scale benchmarks, SLM tests |
| `docs/` | Architecture, reports, CLI reference, getting-started, problem tracker, tuning guide |
| `scripts/` | Utility and install scripts (`fix-skill-quality.mjs`, etc.) |
| `logs/` | Runtime JSONL logs (rotated by date; no automatic cleanup) |
