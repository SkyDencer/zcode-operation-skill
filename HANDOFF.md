# HANDOFF — Skill Router

> Repository: zcode-operation-skill
> Generated: 2026-09-23
> Current branch: main

## 1. What Is Done

Phases 0, 0.5a, 0.5b, 1, 2, 2.5, and 3 are complete. Phase 4 (log rotation) is the next planned work.

**Test results** (last verified 2026-09-23):

| Category | Passed | Failed | Total |
|----------|--------|--------|-------|
| Unit tests | 792 | 1 | 793 |
| Integration tests | 157 | 9 | 166 |
| **Grand total** | **949** | **10** | **959** |

All 10 failures are pre-existing or Windows-environment-specific; zero Phase 3 regressions. The single unit test failure (`hook-edge-cases` -- `output.json created`) is a known Windows path issue.

**BM25 real-corpus benchmark** (N=54 skills, 130 prompts):

| Metric | Value |
|--------|-------|
| Top-1 accuracy | 96.92% (126/130) |
| Recall@3 | 89.23% (116/130) |
| Median latency | 2 ms |
| P95 latency | 3 ms |
| Fallback rate | 8.46% (11/130) |

Caveat: synthetic scale benchmarks (N=50..500) show accuracy dropping from 85% to ~39%. This is lexical poverty of randomly generated skill names, not a BM25 scalability wall. The real 54-skill corpus holds at 96.92%.

**Router capabilities today:**

- BM25 flat retrieval with weighted fields (name x3, description x2, keywords x1)
- FNV-1a n-gram embeddings (256-dim) for hybrid scoring (opt-in; underperforms BM25 alone)
- Hybrid retrieval via Reciprocal Rank Fusion (BM25 + embedding; k=60)
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
- CLI with 14 subcommands: list, add, remove, validate, reindex, benchmark, stats, import, sync, sources, verify, doctor, analytics, help
- Structured JSONL logging with daily rotation filenames (no automatic cleanup yet)
- Zero npm dependencies; plain ESM

## 2. What Is Not Done

- No real-world deployment test in ZCode 3.14.1 since Phase 0.5b (manual E2E testing remains pending)
- The ZCode skill disable mechanism is a best-guess approach (no native per-skill disable found in ZCode 3.14.1); mirror-delete and shadow methods are unverified against actual ZCode behavior
- Scale benchmark uses synthetic data; real scalability beyond N=54 is unverified
- Hybrid retrieval underperforms BM25 alone (55.38% vs 96.92% Top-1 on real corpus); not ready for production
- No pre-trained embedding model integrated (deferred to Phase 6)
- No log rotation cleanup (logs accumulate indefinitely; Phase 4)
- No feedback loop for implicit user corrections (Phase 5)
- Windows e2e test cleanup uses `rm -rf` which fails on Windows

## 3. What the Human Should Do Next (ordered checklist)

1. Read this file and `docs/reports/phase-3-final-report.md`
2. Review commits: `git log --oneline -20`
3. Push to GitHub when ready: `git push origin main`
4. Install in real ZCode: copy `.zcode-plugin/` to `C:\Users\<user>\.zcode\cli\plugins\zcode-skill-router\`
5. Restart ZCode and test these 6 prompts:
   - "Laravel eager loading optimization"
   - "React custom hook for animations"
   - "Next.js app router data fetching"
   - "GraphQL schema design best practices"
   - "Responsive CSS grid layout"
   - "Write integration tests with Playwright"
6. Record results and decide whether to proceed to Phase 4

## 4. How to Verify Everything

Run from the repository root:

```
node tests/hook-edge-cases.mjs
node tests/run-benchmark.mjs --mode bm25 --corpus real
node bin/skill-router.mjs verify
node bin/skill-router.mjs doctor
node tests/scale/run-scale.mjs
```

## 5. Known Issues Carried Forward

- Best-guess disabler mechanism (no native ZCode per-skill disable)
- Synthetic scale benchmark caveat (not representative of real performance)
- Hybrid retrieval underperformance vs BM25 alone
- Windows e2e test cleanup (rm -rf not available)
- See `docs/problems.md` for additional open items

## 6. Repository Map

| Directory | Description |
|-----------|-------------|
| `.zcode-plugin/` | ZCode plugin manifest and installation bundle |
| `bin/` | CLI entry point (`skill-router.mjs`) with 14 subcommands |
| `hooks/` | ZCode hook implementations (`route.mjs`, `build-index.mjs`) |
| `src/` | Source code: core modules, CLI handlers, config, analytics, sync |
| `data/` | Skill manifests, built index, synonyms, thresholds, domain metadata |
| `tests/` | Unit tests, integration tests, E2E tests, scale benchmarks |
| `docs/` | Architecture, reports, CLI reference, getting-started, problem tracker |
| `scripts/` | Utility and install scripts (`fix-skill-quality.mjs`, etc.) |
| `logs/` | Runtime JSONL logs (rotated by date; no automatic cleanup) |
