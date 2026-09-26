# Phase 7.1 — Semantic Embedding Decision: keep the code, force it off, label it experimental

> Date: 2026-09-26
> Sub-Phase: 7.1
> Decision record: `docs/decision-dictionary.md` D29
> Supersedes nothing: it closes out D28, which settled *which* provider is the
> default. This sub-phase settles what the project does with the ONNX code D28
> kept.

## 1. The decision

**The ONNX embedding code stays in the tree. It is forced off by default and
marked experimental.**

Concretely:

| Item | Value |
|---|---|
| `embeddings.provider` default | `bm25-only` (was `fnv1a`) |
| `fnv1a` | kept as an accepted alias of `bm25-only`; both build `Fnv1aProvider` |
| `onnx` | selectable, flagged `experimental: true`, `risk: 'untested_scale'` |
| `embeddings.weights.semantic` | unchanged at `0.0` |
| Runtime signal when `onnx` is selected | telemetry `{"event":"experimental_mode","mode":"onnx","risk":"untested_scale"}` + stderr warning, emitted before the decision path |
| New dependency | none |

The SLM path (Qwen2.5-0.5B) was already disabled before this sub-phase and is
untouched by it: `slm.enabled` is `false` in `src/config/defaults.mjs:181-189`
and Phase 2 found the 0.5B model underperforming BM25
(`docs/reports/phase-2-slm-benchmark.md`).

## 2. Why, in one paragraph

The Phase 6 rule was fixed before measuring: *switch to ONNX only if it improves
Set Recall@5 by more than 5 percentage points over FNV-1a **and** latency stays
under 100 ms*. ONNX cleared the accuracy half and failed the latency half by an
order of magnitude, and — the comparison the rule omits — it is also **worse
than the configuration that actually ships**. A capability that is 14x over its
latency budget and 9.5 percentage points less accurate than the default is not
a supported option. Keeping the code costs nothing and preserves the ability to
revisit; shipping it as "opt-in" would have described a 591 MB dependency and
a 1.4 s prompt as a mild preference.

## 3. The Phase 6 numbers, and where each came from

All figures below are quoted from
[`docs/reports/phase-6-embedding-benchmark.md`](../phase-6-embedding-benchmark.md)
(Sub-Phase 6.10) and [`docs/reports/phase-6-final-report.md`](../phase-6-final-report.md).
Measurement conditions: 130-prompt real corpus from `tests/prompts.json`,
60-entry index (54 leaf + 6 `router-*`), `Xenova/all-MiniLM-L6-v2` (384-dim),
Windows 10 / Node 24. Set Recall@5 is the expected skill in the returned top 5,
computed over the **116** prompts that name a skill; the 14 negative prompts are
scored as an abstention decision.

| # | Claim | Exact figure | Source |
|---|---|---|---|
| 1 | BM25 alone — the shipped default | Set Recall@5 **1.0000** (116/116), Top-1 0.9231 (120/130), Recall@3 0.8923, 3 ms median, 5 ms p95 | `phase-6-embedding-benchmark.md:53` (Result 1 table) |
| 2 | ONNX's accuracy gain over FNV-1a, channel on | Set Recall@5 0.9052 vs 0.8534 = **+5.18 pp** | `:73`; the delta is stated at `:78` |
| 3 | ONNX latency, channel on | **1445 ms** median, **1827 ms** p95 | `:73` |
| 4 | The ONNX repeat run | 947 ms median, 1257 ms p95, identical accuracy (0.7615 / 0.9052) | `:75` |
| 5 | The budget in the pre-registered rule | **100 ms** | `:11-12` |
| 6 | How far over | **14.5x** (9.5x even on the faster repeat) | `:80` |
| 7 | Both semantic-on modes vs the incumbent | ONNX **9.48 pp** below pure BM25, FNV-1a **14.66 pp** below | `:84` |
| 8 | Cost breakdown behind the 1445 ms | `buildIndex(60)` 1407 ms per prompt; one embed 5.9 ms warm, 469 ms cold (model load) | `phase-6-final-report.md:132`, `docs/embeddings.md` (Provider Latency Comparison) |
| 9 | Disk | `node_modules` 591 MB + a 122 MB model cache | `docs/embeddings.md` (Disk Usage) |
| 10 | `@huggingface/transformers` 4.3.0 is in `dependencies`, not `optionalDependencies` | 591 MB is paid on install by every consumer whether or not ONNX is selected | `phase-6-final-report.md:111` region; `README.md` (Decision) |
| 11 | SLM already disabled | `slm.enabled: false` | `src/config/defaults.mjs:181-189`; rationale in `docs/reports/phase-2-slm-benchmark.md` |

One clarification the Phase 6 revision pass established, repeated here because it
is easy to misread: with the shipped weights (`semantic: 0.0`) the three rows of
Result 1 are the same run three times — `hybridRetrieve()` returns before a
provider is ever constructed. The provider comparison is Result 2, and it is the
only place the +5.18 pp and the 1445 ms come from.

## 4. Conditions for revisiting ONNX

All four must hold. They are stated in full in `docs/embeddings.md` under
"Phase 7.1 Decision (D29)" and summarised here.

1. **Median latency under 100 ms on a warm model.** The 1445 ms is dominated by
   rebuilding all 60 skill vectors on every prompt (1407 ms of it). Getting from
   ~1.4 s to under 100 ms is a 14x reduction that has to come from caching the
   index vectors, a smaller or quantised model, or moving the model load off the
   prompt path — not from tuning. The 469 ms cold first load has to stop
   mattering too, either by eliminating it or by pre-warming outside the hook's
   latency budget.
2. **Accuracy at or above the incumbent, not merely above FNV-1a.** The rule as
   written compares against FNV-1a, the weakest alternative, and ONNX passes it.
   The baseline that matters is what ships: Set Recall@5 **1.0000**. A candidate
   must beat that on the current corpus, or match it there and win clearly on a
   corpus this one cannot answer.
3. **A corpus that gives BM25 something to lose.** 60 short, keyword-rich
   manifests over a fixed technology vocabulary leave lexical matching almost
   nothing to lose — 116 of 130 prompts name concepts the manifests also name.
   The trigger is a **paraphrase test set** (prompts that deliberately avoid the
   skill's own vocabulary) showing the semantic channel ahead on the cases BM25
   currently misses. Re-running the Phase 6 comparison on the *current* corpus
   is explicitly not a reason to revisit (`docs/implementation-plan.md`, Phase 7
   item 9).
4. **A deployment story for 591 MB.** Shipping the semantic path as supported
   means making `@huggingface/transformers` an `optionalDependencies` entry, or
   accepting the footprint explicitly in writing.

## 5. Code changes

Every file this sub-phase created or modified, and why.

| File | Change |
|---|---|
| `src/core/embeddings/experimental.mjs` | **New**, 184 lines. The provider registry lookup (`getProviderEntry`, `resolveProviderType`, `isExperimentalMode`, `getProviderRegistry`, `normalizeMode`) and the fail-open emitter `emitExperimentalMode()`, which writes the `experimental_mode` telemetry event and the stderr warning. Never throws; a failure to write the event is dropped, not surfaced. JSDoc header. |
| `src/config/defaults.mjs` | `embeddings.provider` -> `'bm25-only'`; new `embeddings.providers` registry with `type` / `experimental` / `risk` per mode (`bm25-only` and `fnv1a` -> fnv1a, not experimental; `onnx` -> onnx, `experimental: true`, `risk: 'untested_scale'`). The comment block records D29 and the Phase 6 numbers. (The `provider` and registry edits were already present, uncommitted, in the working tree when this sub-phase started; the rest of the sub-phase depends on them.) |
| `src/core/embeddings/provider.mjs` | `createProvider()` accepts `'bm25-only'` as a name for `Fnv1aProvider`, so a config-driven caller cannot construct an unknown type. Header documents the three accepted names. |
| `src/core/embeddings/resolve.mjs` | Maps the configured *mode* through the registry to a provider *type* before constructing. `requested` is the mode, `used` is the constructed type. Without this, `createProvider('bm25-only')` threw `UnknownProviderError`, the default path fell back with a stderr warning, and `tests/hooks/embedding-provider-fallback.test.mjs` failed on "no provider warning on the default path" — reproduced in the pre-change baseline run. |
| `hooks/route.mjs` | Calls `await emitExperimentalMode(config).catch(() => {})` at module scope, immediately after `resolveProvider(config)` and therefore before the decision path. Header comment updated. No other hook logic touched. The net addition is 7 lines (393 -> 400). |
| `tests/embeddings-defaults.test.mjs` | **New**, 38 assertions. See section 6. |
| `package.json` | `tests/embeddings-defaults.test.mjs` appended to the `test` chain (73 -> 74 steps) and to `test:cli` (11 -> 12), so the suite gate actually runs it. |
| `tests/retriever/fallback-provider.test.mjs` | Section 6 asserted `embeddings.provider === 'fnv1a'`, which the new default falsifies. Replaced with the `bm25-only` assertion plus two new ones (mode maps onto fnv1a; `fallbackToFnv1a` still true). 13 -> 14 assertions. |
| `tests/tuning/adaptation-fixtures.test.mjs` | The manifest comparison `manifest.provider.used === config.embeddings.provider` no longer holds by design: the manifest records `requested` (the mode, `'bm25-only'`) and `used` (the constructed type, `'fnv1a'`). Split into two assertions — one on `requested` against `getConfig()`, one pinning `used === 'fnv1a'`. 24 -> 25 assertions. |
| `tests/telemetry/fixtures/regen/manifest.json` | Regenerated with `node scripts/regenerate-fixtures.mjs`: one line, `provider.requested` `fnv1a` -> `bm25-only`. `routing.jsonl` and `signals.jsonl` regenerated **byte-identical** (`git diff --stat` on the fixture directory shows only `manifest.json`, 1 insertion / 1 deletion), and the run still reports `correct=126 miss=4 top1=0.9692` — evidence that the mode rename changed no ranking. |
| `docs/embeddings.md` | "Status: Experimental" banner at the top, provider table and section headings relabelled, exact Phase 6 numbers in a sourced table, the four revisit conditions, the "Enabling" section relabelled as measurement-only, fallback/offline rows updated. |
| `README.md` | New "## Embeddings" section stating plainly that BM25-only is the default and the semantic path is experimental and not recommended; intro paragraph, decision paragraph, limitations and phase table updated. |
| `docs/ai-context.md` | Env-var table row for `SKILL_ROUTER_EMBEDDING_PROVIDER` (default `bm25-only`, onnx experimental); new "Experimental Provider Policy" section; Provider Resolution section documents the mode/type split; constraints line updated. |
| `docs/decision-dictionary.md` | D29 appended. |
| `docs/current-state.md` | Entry-log row appended. |
| `docs/reports/phase-7.1-semantic-decision.md` | This file. |

No new npm dependency. No file over 400 lines: the longest file touched is
`hooks/route.mjs` at exactly 400, which was already over the project's 300-line
cap before this pass (393). Nothing under `~/.zcode/` was touched.

## 6. Tests

`tests/embeddings-defaults.test.mjs` follows the assertion style of
`tests/hooks/embedding-provider-fallback.test.mjs` (incremental
`passed`/`failed` counters, `assert(condition, message)`, real-hook `spawn`
helper, `✓`/`✗` marks) and of `tests/embeddings/hybrid-rrf-config.test.mjs`
(numbered sections). Six sections:

1. **Default provider mode** — `getDefaults().embeddings.provider` and
   `getConfig().embeddings.provider` are both `'bm25-only'`, and not `'onnx'`.
2. **Provider registry** — `bm25-only` -> fnv1a / not experimental; `onnx` ->
   onnx / `experimental: true` / `risk: 'untested_scale'`; `createProvider('bm25-only')`
   builds the fnv1a provider; an unknown mode resolves to `null` rather than
   throwing.
3. **resolveProvider with the shipped default** — `requested === 'bm25-only'`,
   `used === 'fnv1a'`, a provider is returned, `fellBack === false`,
   `warning === null` (this is the assertion that failed before the registry
   wiring landed).
4. **Event shape** — the onnx event is exactly
   `{ event: 'experimental_mode', mode: 'onnx', risk: 'untested_scale' }`, three
   keys, no more; the default and unknown modes produce `null`.
5. **Real hook with `SKILL_ROUTER_EMBEDDING_PROVIDER=onnx`** — exits 0, still
   writes `output.json`, warns on stderr naming the mode and the risk, and adds
   **exactly one** `experimental_mode` line to `logs/YYYY-MM-DD.jsonl` whose
   three fields match the contract.
6. **Real hook on the default path** — exits 0, writes nothing to stderr, and
   emits no `experimental_mode` event.

## 7. Checks run in this sub-phase

All commands are `node <file>`; npm is not on the subprocess PATH on this
machine.

| Command | Result |
|---|---|
| `node scripts/run-all-tests.mjs` (before any of my edits, on the tree as found) | `Total: passed=2057, failed=8`. The tree already carried the uncommitted `defaults.mjs` mode change, which produced 4 real assertion failures (`no provider warning on the default path`, `embeddings.provider defaults to fnv1a`, `manifest provider "fnv1a" matches default "bm25-only"`, `--check exits 0 (got 1)`). All four are fixed below. `logs/pre-existing-failures.json` budgets 1 pre-existing assertion. |
| `node tests/embeddings-defaults.test.mjs` | **38 passed, 0 failed**, exit 0 |
| `node tests/retriever/fallback-provider.test.mjs` | 14 passed, 0 failed, exit 0 |
| `node tests/embeddings/provider.test.mjs` | 19 passed, 0 failed, exit 0 |
| `node tests/embeddings/hybrid-rrf-config.test.mjs` | 9 passed, 0 failed, exit 0 |
| `node tests/config/env.test.mjs` | 30 passed, 0 failed, exit 0 |
| `node tests/hooks/embedding-provider-fallback.test.mjs` | 26 passed, 0 failed, exit 0 |
| `node tests/tuning/adaptation-fixtures.test.mjs` | 25 passed, 0 failed, exit 0 |
| `node scripts/regenerate-fixtures.mjs` | `provider requested=bm25-only used=fnv1a`, `correct=126 miss=4 top1=0.9692`; only `manifest.json` changed |
| `node scripts/run-all-tests.mjs` (after the changes) | `Total: passed=2160, failed=5`, **zero failing assertions**. The 5 remaining are pre-existing and byte-identical in the baseline run: the untracked leftovers `tests/e2e/tmp-debug-hook.mjs` and `tests/e2e/tmp-trace-1790383091780.mjs` / `...791.mjs` (stale copies of the hook that resolve `../src/index.mjs` relative to `tests/e2e/`, so `ERR_MODULE_NOT_FOUND`), `tests/run-coverage.mjs` (`spawnSync node ETIMEDOUT`) and `tests/scale/run-synthetic-benchmark.mjs` (requires a `<skill-count>` argument). All four are swept by `run-all-tests.mjs` but none is in the `package.json` `test` chain. `logs/pre-existing-failures.json` budgets 1 failing assertion; the run reports 0. |
| `node tests/run-benchmark.mjs --mode bm25` | Top-1 **0.9231** (120/130), Recall@3 0.8923, **Set Recall@5 1.0000 (116/116)**, abstained 11/14, median 2 ms / p95 3 ms — the frozen baseline is unchanged |

### The env-var verification, run by hand

The workflow's checks cannot set environment variables, so this was verified
directly in the session shell, on the real hook with a real payload
(`{"prompt":"how do I write a laravel database migration","cwd":<repo root>}`).

```
SKILL_ROUTER_EMBEDDING_PROVIDER=onnx node -e "<spawn hooks/route.mjs, feed stdin, capture stderr>"
  EXIT=0
  [skill-router] experimental_mode: embedding provider "onnx" is EXPERIMENTAL and not
  recommended (risk: untested_scale). The default is "bm25-only" (lexical BM25). Measured
  in Phase 6 it was slower than the 100 ms budget and no more accurate than the default;
  see docs/embeddings.md and docs/reports/phase-7.1-semantic-decision.md.
```

Telemetry written by that run (`logs/2026-09-26.jsonl`):

```
{"ts":"2026-09-26T06:20:10.522Z","event":"experimental_mode","mode":"onnx","risk":"untested_scale"}
```

Control run with the variable deleted from the environment: `EXIT=0`,
`STDERR=[]`, and `grep -c experimental_mode logs/2026-09-26.jsonl` stayed at the
count produced by the onnx run — the default path emits nothing. The route event
from the same control run still records
`"embeddingProvider":"fnv1a","embeddingProviderFallback":false`, so the
telemetry field that the analytics tooling reads is unchanged by the rename.

`node -e "...getConfig()"` confirms the default resolves to
`{"bm25-only":{"type":"fnv1a",...},"fnv1a":{...},"onnx":{"type":"onnx","experimental":true,"risk":"untested_scale"}}`
and `resolveProvider(getConfig())` returns `requested=bm25-only used=fnv1a
fellBack=false warning=null`.

## 8. Not done, and known

- **`hooks/route.mjs` is now 400 lines**, exactly at the 400-line hard cap and
  over the pre-existing 300-line project cap (it was 393 before this pass, so
  the +7 lines are the experimental-mode call, its comments and the header line).
  The first draft of this change put the file at 411 lines; the call site and
  its comments were compressed to stay inside the cap rather than leaving the
  violation in place. Splitting the file is a structural change the run owner
  should schedule — it is flagged, not silently ignored — and doing it here
  would have meant re-testing every hook consumer
  (`tests/e2e/hook-process.mjs` alone is 148 assertions).
- **The stale 35 MB `model.onnx.tmp.*` in the transformers cache was not
  deleted.** It is a pre-existing untracked artefact recorded in the Phase 6
  reports; deleting 35 MB inside `node_modules` is not this sub-phase's call.
- **`@huggingface/transformers` is still a hard `dependencies` entry.** Moving
  it to `optionalDependencies` is revisit-condition 4 and would change the
  install contract for every consumer; it is a separate decision, not a
  documentation change.
- **No re-benchmark of the semantic channel was run.** The decision is made on
  the Phase 6 numbers quoted in section 3, which is what the brief directs; the
  ONNX path costs ~1.4 s per prompt, so re-measuring it here would buy a
  different number for the same conclusion.
- **Pre-existing uncommitted churn in the tree was left alone**:
  `docs/reports/phase-2-slm-benchmark.md`, `docs/reports/phase-3-scale-benchmark.md`,
  `docs/reports/phase-3-two-mode-benchmark.md` and
  `tests/integration/phase-2-results.json` are modified by the Phase 2/3
  benchmark runners on every run, exactly as the 6.9 and 6.11 passes recorded.
  They are not this sub-phase's changes and are not reverted here, because the
  project manager controls commits and reverting them would fight whatever ran
  last.
