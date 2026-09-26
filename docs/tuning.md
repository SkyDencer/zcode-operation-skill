# Tuning — Adaptive BM25 Weight Adjustment

The Skill Router collects implicit user-correction signals as you author workflows in ZCode. Over time, these signals can be used to nudge BM25 field weights toward the patterns that your corpus actually responds to.

## How the Adaptation Works

### Step 1: Collect Routing Decisions

Every time the `UserPromptSubmit` hook fires, `src/telemetry/feedback.mjs` writes a decision record to `logs/routing-YYYYMMDD.jsonl`:

```jsonl
{"ts":"2026-09-24T12:00:00.000Z","mode":"implicit","router":null,"tier":"bm25","selectedSkills":["backend-laravel-eloquent"],"latencyMs":{"total":2,"bm25":2},"confidence":0.92,"prompt":"optimize eager loading in Laravel","promptHash":"sha256:abc123...","sessionId":"user-123","version":"0.2.0"}
```

### Step 2: Collect User Feedback Signals

When the model responds and the user takes a corrective action, `src/telemetry/signals.mjs` appends a signal record to `logs/signals-YYYYMMDD.jsonl`:

| Signal type | Meaning |
|---|---|
| `retry` | User re-submitted the same prompt within 5 minutes (dissatisfied) |
| `rephrase` | User rephrased the prompt within 5 minutes (dissatisfied) |
| `dismiss` | User dismissed the suggestion without using it |
| `explicit_override` | User forced a different routing within 2 minutes (dissatisfied) |
| `success` | No corrective signal within 10 minutes (assumed satisfied) |

Signals are **fire-and-forget**: they never block the hook or affect routing latency.

### Step 3: Correlate Decisions with Outcomes

`src/telemetry/outcomes.mjs` matches each decision to its related signals and classifies it:

1. `retry` within 5 min → **negative**
2. `explicit_override` within 2 min → **negative**
3. `rephrase` within 5 min → **negative**
4. No signals within 10 min → **positive**
5. Signals older than 10 min → **unknown**

Run the correlation with:

```bash
node bin/skill-router.mjs feedback --outcomes
```

This prints the count of positive/negative/unknown outcomes and, when an index is available, the dominant field for each attribution.

### Step 4: Attribute to BM25 Fields

`src/core/retriever/attribution.mjs` recomputes per-field BM25 scores for each classified decision and determines which field (name, description, or keywords) was the dominant contributor to the top-ranked skill:

```javascript
const attr = attributeOutcome(decision, 'negative', leafIndex);
// Returns: { decisionHash, outcome, fields: {name,description,keywords}, dominantField, selectedSkill }
```

### Step 5: Compute Weight Adjustments

`src/core/retriever/weights.mjs` aggregates attributions and applies a gradient-free update:

- Each **positive** outcome increases its dominant field by **+5%**
- Each **negative** outcome decreases its dominant field by **-5%**
- Every weight is **clamped** to `[0.5, 5.0]`
- Weights are **normalized** so their sum stays constant
- At least **20 attributed outcomes** are required before any change is produced

```javascript
const update = computeWeights(attributions, currentWeights);
// Returns: { changed, newWeights: {name, description, keywords}, reason, sampleSize }
```

## How to Read the Tuning Report

### `tune --status`

Shows current weights, when they were last applied, the frozen baseline Top-1, and the count of available attributions:

```bash
node bin/skill-router.mjs tune --status
```

```
Current Weights:
  name         : 3
  description  : 2
  keywords     : 1

Last Applied   : never
Baseline Top-1 : 92.31%
Baseline At    : 2026-09-24T13:00:00.000Z
Attributions   : 130 outcomes (pos: 118, neg: 12)
```

### `tune --analyze`

Computes proposed weights from the benchmark attribution data and prints a diff without writing anything:

```bash
node bin/skill-router.mjs tune --analyze
```

```
Benchmark samples  : 127
  positive  : 118
  negative  : 12
  unknown : 0

Field Attribution
--------------------------------------------------
  name        : 41
  description : 85
  keywords    : 1

Proposed Weights
--------------------------------------------------
  sampleSize   : 127
  changed      : yes
  reason       : applied
  name         : 3.00 → 2.71
  description  : 2.00 → 2.71
  keywords     : 1.00 → 0.57
```

The sample size shown is the number of benchmark prompts that produced a valid attribution. The `changed: yes` line means the algorithm detected a signal strong enough to propose a weight shift.

### `tune --report`

Prints the tuning history log from `logs/tuning/decisions.jsonl`:

```bash
node bin/skill-router.mjs tune --report
```

```
Total attempts : 3
  Accepted  : 2
  Reverted  : 1
  Error   : 0

Last 5 Attempts
--------------------------------------------------
  2026-09-24T14:00:00  accepted   before=92.31%  after=92.31%  accuracy changed by +0.00pp
  2026-09-24T13:30:00  reverted   before=92.31%  after=91.15%  accuracy dropped 1.16pp (tolerance: 1.0pp)
  2026-09-24T13:00:00  accepted   before=92.31%  after=92.31%  accuracy changed by +0.00pp
```

## When to Run `tune --auto`

Run `tune --auto` when you have accumulated enough routing decisions to produce reliable signal. The practical guideline is:

- **Minimum**: 20 attributed outcomes (the `minOutcomes` threshold). Below this, the algorithm returns `reason: "insufficient_data"` and no weights change.
- **Recommended**: After 2–4 weeks of regular ZCode usage, when you have 100+ decision records in `logs/routing-*.jsonl`.
- **After corpus changes**: Re-run `tune --analyze` after adding or removing skills to see if weights should be re-evaluated.

The safe workflow is:

```bash
# 1. Preview the proposed change
node bin/skill-router.mjs tune --auto --dry-run

# 2. If the guardrail says "accept", run the live apply
node bin/skill-router.mjs tune --auto

# 3. Verify the baseline is unchanged
node bin/skill-router.mjs benchmark --mode bm25
```

The `--auto` command runs `--analyze`, applies the proposed weights, runs the BM25 benchmark before and after, and **auto-rolls back** if Top-1 accuracy drops by more than 1 percentage point.

## What to Do If Tuning Is Refused

The guardrail (`src/cli/tune-guard.mjs`) has three possible actions:

| Action | Meaning | What to do |
|---|---|---|
| `accept` | Weights are within bounds and no regression expected | Safe to apply; `--apply` will write and benchmark |
| `revert` | Predicted accuracy drop exceeds tolerance | The change is blocked; review `feedback --outcomes` to understand the signal |
| `refuse` | Weights are malformed or exceed `MAX_DELTA` (0.5 per field) | The proposed change is too aggressive; either wait for more data or adjust manually |

If `tune --analyze` shows `changed: yes` but the guardrail says `refuse`, the per-field delta exceeds 0.5 from the baseline. This can happen when the corpus is small and a few dominant attributions push one field too far. In that case:

1. Collect more usage data (run ZCode for another week or two).
2. Re-run `tune --analyze`; the delta should shrink as more data dilutes outliers.
3. If you want to proceed anyway, edit `data/weights.json` directly and re-run the benchmark to verify.

## Safety Guarantees

The adaptation system is designed to be non-destructive. These guarantees hold by construction:

1. **Frozen baseline**: `data/baseline.json` records the authoritative Top-1 (92.31%) and default weights. All guardrail checks compare against this file. It is never modified by the tuning system — you update it manually after a successful adjustment.

2. **MAX_DELTA bound**: No single field can move more than 0.5 from the baseline in one step. This prevents runaway weight drift.

3. **Accuracy tolerance**: `--apply` benchmarks before and after. If Top-1 drops by more than 1.0 percentage point, weights are automatically restored to the pre-change state.

4. **Weight clamping**: Every weight stays in `[0.5, 5.0]`. No field can be disabled (weight = 0) or dominate unboundedly.

5. **Sum preservation**: After clamping, weights are normalized so `name + description + keywords` equals the original sum. The total signal strength is conserved.

6. **Snapshot rollback**: Every successful `--apply` writes a snapshot to `logs/weights/weights-*.json`. You can restore any previous state with `tune --rollback <path>`.

7. **No hook changes**: Tuning only modifies `data/weights.json` and the benchmark attribution state. The hook (`hooks/route.mjs`) reads weights at import time via `src/config/defaults.mjs`, so a reload is required for changes to take effect in running sessions. Restart ZCode after applying weights.

## Manual Weight Editing

If you need finer control than the automated pipeline provides, you can edit `data/weights.json` directly:

```json
{
  "name": 3.0,
  "description": 2.0,
  "keywords": 1.0
}
```

After editing, restart ZCode and run a benchmark to verify:

```bash
node bin/skill-router.mjs benchmark --mode bm25
```

To reset to the default weights, delete `data/weights.json` — `defaults.mjs` will fall back to `name: 3, description: 2, keywords: 1`.

## Fixtures

Telemetry fixture files under `tests/telemetry/fixtures/` are hand-crafted
to encode a known outcome distribution (3 negative, 3 positive, 1 unknown
decision) that downstream tests assert against. When the default embedding
provider changes, `scripts/regenerate-fixtures.mjs` re-evaluates them against
the live benchmark and writes date-stamped copies alongside the originals.
With the shipped default (`fnv1a`, `semantic=0`) the hand-crafted fixtures
remain valid and are never overwritten.

## Files

| Path | Purpose |
|---|---|
| `src/cli/tune.mjs` | Main CLI: `--analyze`, `--apply`, `--rollback`, `--status`, `--auto`, `--report` |
| `src/cli/tune-core.mjs` | Shared tuning logic: benchmark runner, snapshot management, decision logging |
| `src/cli/tune-guard.mjs` | Guardrail checks: MAX_DELTA, accuracy tolerance, weight bounds |
| `src/core/retriever/attribution.mjs` | Per-field BM25 scoring and dominant-field determination |
| `src/core/retriever/weights.mjs` | Gradient-free weight adjustment with clamping and normalization |
| `src/telemetry/feedback.mjs` | Routing decision logger and summarizer |
| `src/telemetry/signals.mjs` | User feedback signal recorder and reader |
| `src/telemetry/outcomes.mjs` | Decision-outcome correlator |
| `data/baseline.json` | Frozen benchmark baseline (Top-1, weights, thresholds) |
| `data/weights.json` | Current adaptive weights (auto-generated by `--apply`) |
| `logs/weights/` | Snapshot directory for previous weight states |
| `logs/tuning/decisions.jsonl` | Tuning attempt history (accepted/reverted/error) |
