# Troubleshooting — Skill Router

Common problems and their fixes.

## Hook Not Firing

**Symptoms:**
- No `additionalContext` injected when authoring workflows
- ZCode shows no skill suggestions during authoring
- `logs/` directory has no new entries after authoring events

**Diagnosis:**
```bash
# Check if hook is registered in ZCode config
cat ~/.zcode/cli/config.json | grep -A5 UserPromptSubmit

# Check if hook file exists and is valid
node -e "import('./hooks/hooks.json').then(m => console.log(JSON.stringify(m.default, null, 2)))"
```

**Fix:**
```bash
# Re-deploy with hook registration
node bin/skill-router.mjs deploy --with-hook

# Verify hooks.json is well-formed
node -e "import('./hooks/hooks.json').then(m=>console.log('OK'))"
```

If the hook still doesn't fire after re-deploy, restart ZCode completely.

---

## Skills Not Visible in ZCode

**Symptoms:**
- Router skills don't appear in the ZCode skill list
- Leaf skills are missing from the mirror
- `verify` reports orphan directories

**Diagnosis:**
```bash
# Check what verify reports
node bin/skill-router.mjs verify

# Check sync state
node bin/skill-router.mjs doctor | grep -A5 "Sync State"
```

**Fix:**
```bash
# Re-sync all skills to the mirror
node bin/skill-router.mjs sync

# Deploy routers (re-copy SKILL.md files)
node bin/skill-router.mjs deploy

# Restart ZCode to pick up changes
```

---

## llama-server Not Running (SLM Errors)

**Symptoms:**
- SLM routing fails with connection refused
- `SKILL_ROUTER_SLM_ENABLED=true` produces errors

**Diagnosis:**
```bash
# Check if SLM is enabled
grep slm.enabled src/config/defaults.mjs

# Test llama-server connectivity (if enabled)
curl -s http://localhost:8080/v1/models 2>&1 | head -5
```

**Fix:**
SLM is **disabled by default**. If you see SLM errors, it means SLM was explicitly enabled. To disable:
```bash
# Ensure SLM is off (default)
unset SKILL_ROUTER_SLM_ENABLED

# Or explicitly disable via config
node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('src/config/defaults.mjs','utf8'));
"
```

To enable SLM for experimentation:
```bash
SKILL_ROUTER_SLM_ENABLED=true node hooks/route.mjs
```

Note: The 0.5B Qwen model underperforms BM25 (20% vs 46.67% Top-1) and adds ~1.5s latency. Not recommended for production.

---

## Index Stale After Adding Skills

**Symptoms:**
- New skills don't appear in routing results
- `stats` shows wrong skill count
- Benchmark accuracy drops unexpectedly

**Diagnosis:**
```bash
# Compare index count vs actual SKILL.md files
node bin/skill-router.mjs stats
find data/skills -name SKILL.md | wc -l

# Check if index exists
ls -la data/skill-index.json
```

**Fix:**
```bash
# Rebuild the index from all sources
node bin/skill-router.mjs reindex

# Or reindex with all configured sources
node bin/skill-router.mjs reindex --sources all

# Verify the new index
node bin/skill-router.mjs verify
```

---

## Log Files Consuming Disk Space

**Symptoms:**
- `logs/` directory grows without bound
- Disk usage warnings from the OS

**Diagnosis:**
```bash
# Check log directory size
du -sh logs/

# Count log lines across all files
wc -l logs/*.jsonl
```

**Fix:**
Logs rotate by date automatically (`logs/YYYY-MM-DD.jsonl`). Old files are not automatically deleted (Phase 4 limitation). To clean up manually:
```bash
# Remove logs older than 30 days
find logs -name '*.jsonl' -mtime +30 -delete

# Remove old deploy snapshots
find logs/deploys -name '*.json' -mtime +30 -delete
```

Phase 4 documented this as a known limitation. Logs rotate by date automatically but are not automatically deleted. Users should clean old logs manually:

---

## Deploy Snapshot Missing After Crash

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
# If a snapshot exists, restore from it
node bin/skill-router.mjs deploy --restore ./logs/deploys/deploy-snapshot-<timestamp>.json

# If no snapshot, re-deploy from scratch
node bin/skill-router.mjs deploy --verify
```

---

## Two-Mode Routing Not Detecting `$mention`

**Symptoms:**
- `$laravel` prompt routes implicitly instead of explicitly
- `Mode: implicit` appears for prompts that should be explicit

**Diagnosis:**
```bash
# Test explicit detection directly
echo '{"prompt":"$laravel fix N+1","cwd":"."}' | node hooks/route.mjs
cat .zcode/output.json | grep Mode
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

## Benchmark Accuracy Dropped

**Symptoms:**
- Top-1 accuracy fell below 90% on the real corpus
- Unexpected fallback rate increase

**Diagnosis:**
```bash
# Run benchmark and compare to baseline
node bin/skill-router.mjs benchmark --mode bm25

# Check if expected routes are still valid
cat tests/expected-routes.json | head -20
```

**Fix:**
1. Re-run the expected-routes generator if skill descriptions changed:
   ```bash
   node scripts/update-expected-routes.mjs
   ```
2. Re-tune thresholds if the corpus changed significantly:
   ```bash
   node bin/skill-router.mjs benchmark --mode bm25 --reoptimize
   ```
