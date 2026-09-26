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
Baseline At    : 2026-09-26T01:38:41.171Z
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

### The refusal you should expect today

Running the cycle against the current default (`fnv1a`, semantic weight 0.0)
gives this, and it is the correct outcome — not a bug to work around:

```
Proposed Weights
--------------------------------------------------
  sampleSize   : 127
  changed      : yes
  reason       : applied
  name         : 3.00 → 2.71
  description  : 2.00 → 2.71
  keywords     : 1.00 → 0.57

Guardrail      : refuse — weight change for 'description' exceeds MAX_DELTA (0.715 > 0.5)
```

The description delta is 0.715, which is 43% over the 0.5 limit. The guardrail
is doing exactly what it was built to do:

- The proposal comes from a **+5% / −5% per-outcome update applied to 127
  attributions and then normalized to preserve the weight sum**. With 118
  positives against 12 negatives the description field — which dominates 85 of
  the 127 attributions — is pushed up hard, and preserving the total forces the
  other two fields down. The arithmetic is doing what it is documented to do.
- MAX_DELTA exists precisely to stop one confident pass from moving a field far
  enough to change ranking behaviour everywhere. 0.715 on a field that decides
  most of the ranking is exactly the kind of change that bound was written for.
- `tune --apply` (live) therefore exits **1** before it writes anything:
  `data/weights.json` still holds `{name: 3, description: 2, keywords: 1}` and
  `logs/weights/` is never created, so there is no snapshot to roll back from
  because nothing was applied. `logs/tuning/decisions.jsonl` stays empty —
  a refusal is not a tuning attempt.

Do **not** raise `MAX_DELTA` to force this through. The unblocked path is more
usage data (dilutes the outlier), or an explicit, manual, benchmark-verified
edit to `data/weights.json` as described above. The refusal is the loop working.


## Safety Guarantees

The adaptation system is designed to be non-destructive. These guarantees hold by construction:

1. **Frozen baseline**: `data/baseline.json` records the authoritative Top-1 (92.31%) and default weights. All guardrail checks compare against this file. It is never modified by the tuning system — you update it manually after a successful adjustment.

   The 92.31% figure is the output of `node tests/run-benchmark.mjs --mode bm25`
   over the **60-entry** index (54 leaf skills + 6 `router-*` dispatchers),
   because that is the command `runBenchmark()` in `src/cli/tune-core.mjs`
   shells out to for the before/after comparison. The hook itself searches the
   **54-leaf** index with a 0.35 relevance floor, where the same 130 prompts
   score **96.92% (126/130)**. `data/baseline.json` records both under
   `corpora` so the two are never confused, along with the retrieval settings
   (`provider`, `rrfWeights`, `relevanceFloor`, `rerank`) the numbers were
   measured under. Re-freeze it with:

   ```bash
   node tests/run-benchmark.mjs --mode bm25
   node scripts/regenerate-fixtures.mjs
   ```

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

`scripts/regenerate-fixtures.mjs` re-derives the telemetry fixtures the loop is
exercised against, so a provider or weight change cannot leave the loop
validated against a stale corpus.

```bash
node scripts/regenerate-fixtures.mjs           # regenerate
node scripts/regenerate-fixtures.mjs --check   # exit 1 if they are stale
```

What it does, in order:

1. Resolves the embedding provider exactly as the hook does — `resolveProvider()`
   over `getConfig()`, so `SKILL_ROUTER_EMBEDDING_PROVIDER` and the
   `SKILL_ROUTER_RRF_*` overrides are honoured.
2. Replays the 130-prompt real corpus through the hook's default implicit path:
   the **leaf-only 54-skill index** (`hooks/route.mjs:162`) and
   `hybridRetrieve({ provider, rerank: false, minBm25Score })` with the
   relevance floor from `slm.bm25MinThreshold` (0.35), degrading to floored
   `rankSkills()` when no provider is usable.
3. Writes `tests/telemetry/fixtures/regen/` — `routing.jsonl` (one decision per
   prompt), `signals.jsonl` (a corrective signal on every retrieval miss) and
   `manifest.json` (the configuration the fixtures were produced under).

Properties worth knowing:

- **Deterministic.** Timestamps are anchored to a fixed epoch and every field
  is derived from the retrieval result — there is no `Math.random()`. Re-running
  under one configuration reproduces byte-identical files, which is what makes
  `--check` usable as a gate.
- **No raw prompts.** Records carry the corpus id, not the prompt text, matching
  the hook's privacy rule; tests recover the prompt from `tests/prompts.json`
  when `attributeOutcome` needs it.
- **The hand-crafted pair is never overwritten.**
  `outcomes-decisions.jsonl` and `signals-20260924.jsonl` encode a fixed
  positive/negative/unknown distribution that `tests/telemetry/outcomes.test.mjs`
  asserts, and they are what covers the `unknown` class (which needs a live
  clock). Only the provider-derived `regen/` tree is regenerated.
- **`--check` is the drift gate.** Changing `embeddings.provider`, the RRF
  weights, the relevance floor or the corpus makes it exit 1 with
  `STALE: <file> does not match the current default configuration`.
  `tests/tuning/adaptation-fixtures.test.mjs` asserts this on every suite run.

### Revalidation result (2026-09-26, default `fnv1a`, semantic weight 0.0)

Regenerating under the current default and replaying the full loop with a fixed
clock gives **the same proposal `tune --analyze` gives, to the last digit**:

| | Regenerated fixtures | `tune --analyze` |
|---|---|---|
| corpus | 54 leaf skills + 0.35 floor | 54 leaf skills, unfloored |
| attributions | 127 | 127 |
| dominant field | name 41 / description 85 / keywords 1 | name 41 / description 85 / keywords 1 |
| proposed weights | name 2.71, description 2.71, keywords 0.57 | identical |

The two corpora are not the same thing and the difference is worth stating
plainly. The regenerated fixtures use the hook's relevance floor, so a prompt
that correctly abstains is scored `positive`; `buildAttributions()` in
`src/cli/tune-core.mjs` calls `rankSkills()` without a floor, so the same
abstaining prompt comes back with a top skill and is scored `negative`. That is
why the fixture replay reports 4 negatives where `tune --status` reports 12. The
proposal is identical either way, because the extra "negatives" are attributed
to the same fields as the real ones.

With `semantic = 0.0` the embedding provider is never constructed
(`src/core/retriever/hybrid.mjs:137`), so the loop's input ranking is pure BM25
and the loop is genuinely unaffected by the Sub-Phase 6 provider work. That is
the finding this sub-phase exists to establish, and
`tests/tuning/adaptation-fixtures.test.mjs` pins it.


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
| `data/baseline.json` | Frozen benchmark baseline (Top-1, weights, thresholds, corpora, retrieval settings) |
| `data/weights.json` | Current adaptive weights (auto-generated by `--apply`) |
| `scripts/regenerate-fixtures.mjs` | Regenerate the provider-derived telemetry fixtures; `--check` is the drift gate |
| `tests/tuning/adaptation-fixtures.test.mjs` | Asserts the fixtures match the live default and the loop still lands on the same proposal and refusal |
| `logs/weights/` | Snapshot directory for previous weight states |
| `logs/tuning/decisions.jsonl` | Tuning attempt history (accepted/reverted/error) |
