# Troubleshooting — Skill Router

Common problems and their fixes.

## The hook does not fire

**Symptoms:**
- No `additionalContext` injected when authoring workflows
- ZCode shows no skill suggestions during authoring
- `logs/` directory has no new entries after authoring events
- `health` reports "hook not registered" or "hook not invocable"

**Diagnosis:**
```bash
# Check if hook is registered in ZCode config
node -e "import('./hooks/hooks.json').then(m => console.log(JSON.stringify(m.default, null, 2)))"

# Check hook registration status
node bin/skill-router.mjs health | grep -i hook

# Test the hook directly with a minimal payload
echo '{"prompt":"test","cwd":"."}' | node hooks/route.mjs
cat .zcode/output.json 2>/dev/null || echo "no output.json"
```

**Fix:**
```bash
# Re-deploy with hook registration (default behaviour — --no-hook opts out)
node bin/skill-router.mjs deploy

# If the hook is already registered but not firing, unregister and re-register
node bin/skill-router.mjs deploy --no-hook
node bin/skill-router.mjs deploy

# Verify
node bin/skill-router.mjs health
```

If the hook still doesn't fire after re-deploy, restart ZCode completely. The hook is registered in `~/.zcode/cli/config.json` at `hooks/hooks.json:12` with a 3500 ms timeout; ZCode reads this on startup.

---

## No `[SKILL ROUTER]` block appears in the injected context

**Symptoms:**
- The hook fires (logs are written) but the model sees no skill content
- `output.json` exists but `additionalContext` is empty or minimal
- Benchmark reports correct accuracy but the UX shows nothing

**Diagnosis:**
```bash
# Check the output file directly
cat .zcode/output.json | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{const o=JSON.parse(d); console.log('additionalContext length:', o.hookSpecificOutput?.additionalContext?.length ?? 0); console.log('RoutePlan:', JSON.stringify(o.RoutePlan))})"

# Check today's logs
tail -5 logs/$(date +%Y-%m-%d).jsonl 2>/dev/null || tail -5 logs/*.jsonl 2>/dev/null

# Check the route decision log
tail -3 logs/routing-*.jsonl 2>/dev/null
```

**Fix:**
1. **Empty prompt or too short.** The hook truncates prompts shorter than a few tokens to nothing. Ensure the prompt is non-empty and at least 10 characters.
2. **All skills below relevance floor.** The hook returns `tier: 'none'` when the top normalised BM25 score is below `slm.bm25MinThreshold` (0.35). This is correct behaviour for unrelated prompts — the hook is abstaining, not failing.
   ```bash
   # Check what tier the last decision had
   tail -1 logs/routing-*.jsonl | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{const o=JSON.parse(d); console.log('mode:', o.mode, 'tier:', o.tier, 'confidence:', o.confidence)})"
   ```
3. **Budget exhausted.** If top skills have very long SKILL.md files and the total exceeds `SKILL_ROUTER_BUDGET_MAX_CHARS` (default 24000), content is truncated paragraph-safe. Check that the budget isn't zeroed out.
   ```bash
   node -e "import('./src/config/env.mjs').then(m=>console.log('budgetMaxChars:', m.getConfig().budget.maxChars))"
   ```
4. **Index missing or empty.** The hook fails open (exit 0, no output) when `data/skill-index.json` is absent.
   ```bash
   ls -la data/skill-index.json
   node bin/skill-router.mjs reindex
   ```

---

## The wrong skill is selected

**Symptoms:**
- A prompt like "fix the login bug" returns `backend-caching-headers` instead of a security or auth skill
- Confidence scores are high but the skill seems irrelevant
- A `$mention` prompt routes to the wrong domain

**Diagnosis:**
```bash
# Run the benchmark to see current Top-1 accuracy
node bin/skill-router.mjs benchmark --mode bm25

# Check which skill a specific prompt would route to
echo '{"prompt":"fix the login bug","cwd":"."}' | node hooks/route.mjs
cat .zcode/output.json | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{const o=JSON.parse(d); console.log(JSON.stringify(o.RoutePlan, null, 2))})"

# Validate skill quality — name prefixes and description lengths matter
node bin/skill-router.mjs validate
```

**Fix:**
1. **Skill names don't match the domain convention.** The quality validator requires names to start with one of their declared domains followed by `-` (`src/quality/validator.mjs:169-179`). Rename incorrect skills:
   ```bash
   # Move a skill to the correct domain directory and rename
   mv data/skills/wrong-domain/my-skill data/skills/correct-domain/my-skill
   node bin/skill-router.mjs reindex
   ```
2. **Descriptions are too short or too long.** Descriptions must be 40–400 characters. Short descriptions carry weak BM25 signal. Edit the `description` frontmatter field directly.
3. **Missing keywords.** Skills with no `keywords` field lose the keyword x1 channel entirely. Add descriptive keywords to the frontmatter.
4. **Synonym expansion is diluting signal.** If you have expansion enabled, turn it off — it drops Top-1 from 92% to 80% on the real corpus:
   ```bash
   node bin/skill-router.mjs benchmark --mode bm25 --expand off
   ```
5. **Relevance floor not scaling at large corpora.** At 250+ skills, the normalised top score is always 1.0 whenever anything matches, so unrelated prompts can route. This is a known limitation (finding B1, documented in `docs/reports/phase-7.3-corpus-build.md`). There is no config fix — the floor is a "did anything match" test, not an absolute relevance test.

---

## The index is stale

**Symptoms:**
- New skills don't appear in routing results
- `stats` shows a different skill count than `find data/skills -name SKILL.md | wc -l`
- Benchmark accuracy drops unexpectedly after adding or removing skills

**Diagnosis:**
```bash
# Compare index count vs actual SKILL.md files
node bin/skill-router.mjs stats
find data/skills -name SKILL.md | wc -l

# Check index freshness
ls -la data/skill-index.json data/skill-index.prebuilt.json

# Check if the index builder reports the same count
node hooks/build-index.mjs
```

**Fix:**
```bash
# Rebuild the index from all sources
node bin/skill-router.mjs reindex

# Or rebuild with a specific provider
node hooks/build-index.mjs --provider fnv1a

# Verify the new index
node bin/skill-router.mjs verify
node bin/skill-router.mjs benchmark --mode bm25
```

If you added skills directly to `data/skills/` without going through the CLI, `reindex` is required before the hook sees them. The query cache (5-minute TTL) does not invalidate on its own — it keys on the index fingerprint, which changes when the index file is rebuilt.

---

## Performance is slow

**Symptoms:**
- The hook takes more than a few hundred milliseconds per prompt
- ZCode shows a delay before suggestions appear
- `doctor` reports high latency percentiles

**Diagnosis:**
```bash
# Check current latency from the benchmark
node bin/skill-router.mjs benchmark --mode bm25

# Check the performance report from scale testing
cat docs/reports/phase-7.6-hook-performance.md | head -40

# Check if the parsed-index cache is present (Sub-Phase 7.6)
ls -la data/skill-index.prebuilt.json
```

**Fix:**
1. **Missing parsed-index cache.** The cache (`data/skill-index.prebuilt.json`) was added in Sub-Phase 7.6 to reduce per-call retrieval time from ~35–120 ms to ~0.4 ms at 1000 skills. Rebuild the index to regenerate it:
   ```bash
   node hooks/build-index.mjs
   ls -la data/skill-index.prebuilt.json
   ```
2. **Large corpus.** At 252 skills the frozen baseline measures median 32 ms / p95 39.1 ms (`data/baseline.json`). The hook's own post-startup work at 1000 skills is ~40–60 ms, but the fixed process floor (ESM import graph + module-scope config) is ~120–129 ms p95 on this host — above the pre-registered 100 ms wall-clock gate. This is a host limitation, not a configuration issue. See `docs/reports/phase-7.6-hook-performance.md`.
3. **ONNX provider loaded accidentally.** If `SKILL_ROUTER_EMBEDDING_PROVIDER=onnx` is set, the hook loads the ONNX provider and the semantic channel, which adds 1445 ms median per prompt. Ensure the variable is unset:
   ```bash
   unset SKILL_ROUTER_EMBEDDING_PROVIDER
   node bin/skill-router.mjs health
   ```
4. **SLM enabled.** If `SKILL_ROUTER_SLM_ENABLED=true`, the hybrid path adds ~1.5 s per prompt. Disable it:
   ```bash
   unset SKILL_ROUTER_SLM_ENABLED
   ```
5. **Disk I/O on Windows.** The benchmark on this host reports median 178 ms / p95 647 ms for the full 258-entry index — significantly higher than the 32 ms / 39.1 ms frozen baseline. This is due to Windows disk I/O overhead reading 252 SKILL.md files for content injection, not a retrieval algorithm issue. The retrieval itself (BM25 scoring) is fast; the bottleneck is filesystem access.

---

## llama-server not running (SLM errors)

**Symptoms:**
- SLM routing fails with connection refused
- `SKILL_ROUTER_SLM_ENABLED=true` produces errors

**Diagnosis:**
```bash
# Check if SLM is enabled
node -e "import('./src/config/defaults.mjs').then(m => console.log('slm.enabled =', m.getDefaults().slm.enabled))"

# Test llama-server connectivity (if enabled)
curl -s http://localhost:8080/v1/models 2>&1 | head -5
```

**Fix:**
SLM is **disabled by default**. If you see SLM errors, it means SLM was explicitly enabled. To disable:
```bash
unset SKILL_ROUTER_SLM_ENABLED
```

Expected: `slm.enabled = false`.

To enable SLM for experimentation:
```bash
SKILL_ROUTER_SLM_ENABLED=true node hooks/route.mjs
```

Note: The 0.5B Qwen model underperforms BM25 (20% vs 46.67% Top-1) and adds ~1.5s latency. Not recommended for production. See [docs/reports/phase-2-slm-benchmark.md](./reports/phase-2-slm-benchmark.md).

---

## Deploy snapshot missing after crash

**Symptoms:**
- Deploy failed partway through
- Mirror is in an inconsistent state
- No snapshot available for rollback

**Diagnosis:**
```bash
# Check for existing snapshots
ls logs/deploys/

# Run verify to detect drift
node bin/skill-router.mjs verify
```

**Fix:**
```bash
# If a snapshot exists, list available timestamps
node bin/skill-router.mjs deploy --list-snapshots

# Restore from a snapshot. --restore takes a TIMESTAMP PREFIX, not a file path
node bin/skill-router.mjs deploy --restore 2026-09-23T10-00-00

# If no snapshot, re-deploy from scratch
node bin/skill-router.mjs deploy --verify
```

---

## Two-mode routing not detecting `$mention`

**Symptoms:**
- `$laravel` prompt routes implicitly instead of explicitly
- `Mode: implicit` appears for prompts that should be explicit

**Diagnosis:**
```bash
# Test explicit detection directly
echo '{"prompt":"$laravel fix N+1","cwd":"."}' | node hooks/route.mjs
cat .zcode/output.json | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{const o=JSON.parse(d); console.log('mode:', o.RoutePlan?.mode)})"

# Verify aliases are registered
node -e "import('./src/config/aliases.mjs').then(m=>console.log('aliases:', Object.keys(m.ROUTER_ALIASES)))"

# Check that the target router skill exists
ls router-skills/
```

**Fix:**
1. Ensure router skills are in the index:
   ```bash
   node bin/skill-router.mjs reindex
   ```
2. Verify aliases are registered:
   ```bash
   node -e "import('./src/config/aliases.mjs').then(m=>console.log(m.ROUTER_ALIASES))"
   ```
3. Check that the target router skill exists in `router-skills/`:
   ```bash
   ls router-skills/
   ```

---

## Benchmark accuracy dropped

**Symptoms:**
- Top-1 accuracy fell below the frozen baseline (0.6462 on the 258-entry index)
- Unexpected fallback rate increase

**Diagnosis:**
```bash
# Run benchmark and compare to baseline
node bin/skill-router.mjs benchmark --mode bm25

# Check the frozen baseline
node -e "console.log(JSON.stringify(require('./data/baseline.json').benchmark, null, 2))"

# Check if expected routes are still valid
node -e "const e=require('./tests/prompts.json'); console.log(e.length, 'prompts')"
```

**Fix:**
1. Re-run the expected-routes generator if skill descriptions changed:
   ```bash
   node scripts/update-expected-routes.mjs
   ```
2. Rebuild the index after any corpus changes:
   ```bash
   node bin/skill-router.mjs reindex
   node bin/skill-router.mjs benchmark --mode bm25
   ```
3. If weights were adapted, roll back to the frozen baseline:
   ```bash
   node bin/skill-router.mjs tune --rollback
   ```
