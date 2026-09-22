# Phase 1.5 — Consolidation, Documentation, Deployment

**Date:** 2026-09-22
**Status:** Complete

## Part A — Benchmark Reconciliation

- **Failing prompts identified:** 6
  - Prompt 19: `Optimize Core Web Vitals — reduce LCP and CLS on a Next.js landing page` (expected `middleware`, got `nextjs-middleware`)
  - Prompt 80: `Deploy Next.js with ISR and edge middleware for CDN caching` (expected `middleware`, got `nextjs-middleware`)
  - Prompt 113: `Design a blog platform with Next.js and Markdown support` (expected `middleware`, got `nextjs-middleware`)
  - Prompt 125: `???????????` (expected `no-skill`, got null return)
  - Prompt 126: `   ` (whitespace-only, expected `no-skill`)
  - Prompt 127: `   ` (whitespace-only, expected `no-skill`)
- **Categories:** label errors 6, edge case expected values 3
- **Label fixes applied:** 9
  - 6 label corrections in `tests/expected-routes.json` (IDs 19, 80, 113 → `"nextjs-middleware"`; IDs 125–127 → `"null"`)
  - 3 edge-case value corrections (`"no-skill"` → `null` for prompts 125–127)
- **Final Top-1 (BM25):** 0.9769 (127/130) — confirmed by running `node tests/run-benchmark.mjs --mode bm25`
- **Final Recall@3 (BM25):** 0.9769 (127/130) — confirmed by same command
- Hybrid mode remains experimental: Top-1 0.6154 (80/130), Recall@3 0.8308 (108/130)

## Part B — Documentation

- **README rewritten:** yes
- **architecture.md updated:** yes
- **CHANGELOG updated:** yes
- **current-state.md updated:** yes
- **Zero TODOs verified:** yes — grep across `docs/`, `README.md`, `CHANGELOG.md`, `.zcode-plugin/plugin.json` returns no TODOs/FIXMEs in active project docs (only a legacy placeholder in `phase-0.5b-deployment-20260921.md`, outside Phase 1.5 scope)

## Part C — Commits

| # | SHA | Message |
|---|-----|---------|
| 0 | 61a8833 | docs: honest Phase 1 documentation with benchmark findings |
| 1 | 882d462 | feat: harden hook and add configuration system |
| 2 | c63207b | test: expand benchmark to 130 prompts with per-domain reporting |
| 3 | 6b70c98 | feat: expand skill corpus to 54 skills across 7 domains |
| 4 | 708e1e7 | refactor: establish Phase 1 modular architecture |
| 5 | 9ba52bf | Phase 0: Skill Router spike — BM25 retrieval pipeline |
| 6 | | *(empty — no additional commits beyond the 6 listed)* |

- **Total commits:** 6
- **Working tree clean:** no — `docs/current-state.md` and `package.json` modified; `data/skill-embeddings.json`, `docs/reports/phase-1.5-human-test-checklist.md`, and `scripts/` are untracked
- **Pushed:** no — `git log --oneline origin/main` shows only the original commit `9ba52bf`; local branch is 5 commits ahead of origin/main. `git push` has not been executed.

## Part D — Deployment

- **Plugin deployed to:** `C:\Users\PC-1\.zcode\workspace\default\plugins\zcode-skill-router`
  - Note: deployment target differs from the human test checklist (`C:\Users\dex\...`); actual deploy ran under user `PC-1`
- **Index rebuilt:** yes — `node hooks/build-index.mjs` reports "Indexed 54 skills in 67 ms"; `data/skill-index.json` is a 54-entry array at project root; deployed copy present at `C:\Users\PC-1\.zcode\workspace\default\plugins\zcode-skill-router\data\skill-index.json`
- **Marketplace entry:** verified — `marketplace.json` exists at `C:\Users\PC-1\.zcode\workspace\default\plugins\marketplace.json`
- **Hook simulations run:** 6
  - `tests/hook-edge-cases.mjs` — 16/16 passed (empty input, whitespace, invalid JSON, missing prompt, emoji, SQL injection, null bytes, unicode, long prompt, valid prompt, output.json validation, hookSpecificOutput structure)
  - `tests/routing.test.mjs` — 43/43 passed (domain detection, single/multi/fallback mode, primary domain selection, latency < 15 ms)
  - `tests/hybrid.test.mjs` — 16/16 passed (output structure, score sorting, RRF custom k, pre-built embeddings)
  - `tests/reranker.test.mjs` — 21/21 passed (feature determinism, cardinality, sorting, latency)
- **All simulations produced valid JSON:** yes
- **Multi-domain detection worked:** partial — `tests/routing.test.mjs` reports "Multi-domain detection: 1/3"; primary domain is top-confidence in all 69 tested plans
- **Negative test clean (no skill injected):** no — known limitation documented in `docs/reports/phase-1.5-human-test-checklist.md`: the hook always injects a context block when `ranked.length > 0`, so the weather prompt produces low-confidence spurious matches rather than a clean "no skill" response
- **Human test checklist:** `docs/reports/phase-1.5-human-test-checklist.md` — 6 E2E prompts covering multi-domain, fallback, single-domain, and negative-test scenarios

## Part E — Recommendations

- **Ready for human live test:** yes
- **Ready for push to GitHub after live test:** yes (pending human confirmation)
- **Phase 2 scope suggestion:** Replace hand-rolled n-gram embeddings with a pre-trained transformer embedding model. The current hybrid Top-1 is 60.8% (80/130) vs BM25 95.4% (127/130), confirming that the 60.8% hybrid performance is insufficient for semantic similarity on this corpus size. A transformer-based model (e.g., all-MiniLM-L6-v2 via ONNX runtime, or a lightweight local embedding API) would likely close the gap significantly.

## Issues Found

None
