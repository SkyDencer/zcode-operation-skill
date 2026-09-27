# Configure — Skill Router

Every tunable parameter for the Skill Router, what it controls, and how to override it.

## How configuration works

The router reads a single source of truth at startup: `src/config/defaults.mjs`. It exports `getDefaults()` which returns every tunable with its default value, and `mergeWithEnv(defaults)` which overlays any `SKILL_ROUTER_*` environment variables onto those defaults. `src/config/env.mjs` exposes a singleton `getConfig()` that every module imports. There is no separate config file to edit — everything is driven by environment variables.

Overrides are validated against a schema (`src/config/env.mjs:17-40`). Values outside the declared range are clamped with a warning; non-numeric values for numeric fields are dropped with a warning. String fields (e.g. `SKILL_ROUTER_EMBEDDING_PROVIDER`) are lowercased and trimmed.

List parameters accept comma-separated values (e.g. `SKILL_ROUTER_BM25_NAME_WEIGHT=3,2,1`). Only one value is applied per key in the current schema; the list support exists for future multi-weight fields.

## Environment variable reference

All variables are prefixed `SKILL_ROUTER_`. The table below lists every real variable defined in `src/config/env.mjs`, its default, its type and range, and what it controls.

### BM25 parameters

| Variable | Default | Type / Range | Controls |
|----------|---------|--------------|----------|
| `SKILL_ROUTER_BM25_K1` | `1.5` | float, [0, 5] | Term-frequency saturation in the BM25 formula (`src/config/defaults.mjs:74`) |
| `SKILL_ROUTER_BM25_B` | `0.75` | float, [0, 1] | Length-normalisation factor (`src/config/defaults.mjs:75`) |
| `SKILL_ROUTER_BM25_NAME_WEIGHT` | `3` | int, [1, 10] | Multiplicative weight for the `name` field (tokens are replicated this many times in the query) |
| `SKILL_ROUTER_BM25_DESC_WEIGHT` | `2` | int, [1, 10] | Multiplicative weight for the `description` field |
| `SKILL_ROUTER_BM25_KEYWORD_WEIGHT` | `1` | int, [1, 10] | Multiplicative weight for the `keywords` field |

These weights are also loaded from `data/weights.json` when present (produced by `src/core/retriever/weights.mjs`). The file takes precedence over the hardcoded defaults; env vars override both.

### Embedding parameters

| Variable | Default | Type / Range | Controls |
|----------|---------|--------------|----------|
| `SKILL_ROUTER_EMBED_DIMS` | `256` | int, [16, 4096] | Dimensionality of the FNV-1a n-gram embedding vector (`src/config/defaults.mjs:81`) |
| `SKILL_ROUTER_EMBEDDING_PROVIDER` | `bm25-only` | string | Provider mode. Accepted values: `bm25-only` (default, zero-dependency), `fnv1a` (alias of `bm25-only`), `onnx` (experimental, requires `@huggingface/transformers`) |
| `SKILL_ROUTER_RRF_K` | `60` | int, [1, 1000] | Reciprocal Rank Fusion constant in weighted RRF (`src/config/defaults.mjs:143`) |
| `SKILL_ROUTER_RRF_BM25_WEIGHT` | `1.0` | float, [0, 1] | Weight for the BM25 channel in RRF fusion (`src/config/defaults.mjs:140`) |
| `SKILL_ROUTER_RRF_SEMANTIC_WEIGHT` | `0.0` | float, [0, 1] | Weight for the embedding channel in RRF fusion. At `0.0` the provider is never constructed (`src/core/retriever/hybrid.mjs:137`) |

**Provider selection:** The shipped default is `bm25-only`. The `fnv1a` alias is accepted for backwards compatibility. The `onnx` mode is **experimental and not recommended** (decision D29, `src/core/embeddings/experimental.mjs`): selecting it emits an `experimental_mode` telemetry event and warns on stderr, but the hook still runs and still fails open. Do not set this in production. See [docs/embeddings.md](./embeddings.md) for the full provider comparison.

### Routing parameters

| Variable | Default | Type / Range | Controls |
|----------|---------|--------------|----------|
| `SKILL_ROUTER_DOMAIN_THRESHOLD` | `0.80` | float, [0, 1] | Confidence threshold for single-domain routing decisions (`src/config/defaults.mjs:162`) |
| `SKILL_ROUTER_MULTI_DOMAIN_THRESHOLD` | `0.50` | float, [0, 1] | Confidence threshold for multi-domain routing decisions (`src/config/defaults.mjs:163`) |
| `SKILL_ROUTER_HIERARCHICAL_CONFIDENCE_THRESHOLD` | `0.08` | float, [0, 1] | Confidence threshold for domain selection in hierarchical routing (`src/config/defaults.mjs:165`) |

### Confidence thresholds

| Variable | Default | Type / Range | Controls |
|----------|---------|--------------|----------|
| `SKILL_ROUTER_HIGH_THRESHOLD` | `0.85` | float, [0, 1] | Override the `high` threshold from `data/thresholds.json` |
| `SKILL_ROUTER_MEDIUM_THRESHOLD` | `0.60` | float, [0, 1] | Override the `medium` threshold from `data/thresholds.json` |

Thresholds are normally loaded from `data/thresholds.json` (produced by `src/tuning/optimizer.mjs`). Env vars override that file. The current optimised values are `high=0.85`, `medium=0.60` (Grid search over 45 cells, top-1 maximised subject to fallback < 15%, tie-breaking to the default pair). See [docs/tuning.md](./tuning.md).

### Hook parameters

| Variable | Default | Type / Range | Controls |
|----------|---------|--------------|----------|
| `SKILL_ROUTER_TIMEOUT_MS` | `200` | int, [50, 30000] | Internal race timer wrapped around the hybrid retrieve path (`src/config/defaults.mjs:172`). The hook itself is registered with ZCode at 3500 ms (`hooks/hooks.json:12`) |
| `SKILL_ROUTER_MAX_PROMPT_LENGTH` | `10240` | int, [128, 102400] | Max prompt length in characters before truncation (`src/config/defaults.mjs:173`) |
| `SKILL_ROUTER_MAX_OUTPUT_LENGTH` | `30000` | int, [1024, 102400] | Max output length in characters (`src/config/defaults.mjs:174`) |

### Context budget parameters

| Variable | Default | Type / Range | Controls |
|----------|---------|--------------|----------|
| `SKILL_ROUTER_BUDGET_MAX_CHARS` | `24000` | int, [1024, 102400] | Total character budget for injected skill content (`src/config/defaults.mjs:177`) |
| `SKILL_ROUTER_BUDGET_MIN_PER_SKILL` | `500` | int, [100, 10240] | Minimum characters per skill when the budget is shared (`src/config/defaults.mjs:178`) |

### Source and mirror paths

| Variable | Default | Type | Controls |
|----------|---------|------|----------|
| `SKILL_ROUTER_SOURCES` | *(unset)* | string (colon-separated paths) | Secondary skill sources for multi-source indexing. Read by `hooks/build-index.mjs` only; not read by the hook or `reindex` CLI |
| `SKILL_ROUTER_ZCODE_DIR` | *(auto-detected)* | string | Override the ZCode skills mirror directory. Default is `~/.zcode/skills/` |

### SLM parameters

| Variable | Default | Type | Controls |
|----------|---------|------|----------|
| `SKILL_ROUTER_SLM_ENABLED` | `false` | boolean | Enable SLM routing. Accepted truthy values: any string that is not `false`, `0`, or empty after trimming (`src/config/defaults.mjs:242-245`) |

SLM is **disabled by default**. Enabling it requires a local llama-server on port 8080. Phase 2 benchmarks showed Qwen2.5-0.5B underperforms BM25 (Top-1: 20% vs 46.67%). See [docs/reports/phase-2-slm-benchmark.md](./reports/phase-2-slm-benchmark.md).

## Custom corpus paths

### Adding a secondary source

Skills from multiple directories can be indexed together. Set `SKILL_ROUTER_SOURCES` to a colon-separated list of absolute paths:

```bash
export SKILL_ROUTER_SOURCES="/path/to/my-skills:/path/to/another-corpus"
node hooks/build-index.mjs
```

The `reindex` CLI also accepts `--sources`:

```bash
node bin/skill-router.mjs reindex --sources project,zcode-user,all
```

Source priority on name collisions: `project` (2) > `zcode-user` (1). When the same skill name appears in both sources, the project entry wins (`src/index/dedupe.mjs`).

### Overriding the skills directory

The default skills directory is `data/skills/`. Override it with the CLI flag:

```bash
node bin/skill-router.mjs stats --skills-dir /path/to/custom-skills
node bin/skill-router.mjs validate --skills-dir /path/to/custom-skills
```

### Overriding the ZCode mirror

The default mirror is `~/.zcode/skills/`. Override it with `SKILL_ROUTER_ZCODE_DIR`:

```bash
export SKILL_ROUTER_ZCODE_DIR=/tmp/test-zcode-skills
node bin/skill-router.mjs sync --dry-run
```

## Custom thresholds

Thresholds are loaded from `data/thresholds.json` when present. To override them without editing the file, use the env vars:

```bash
export SKILL_ROUTER_HIGH_THRESHOLD=0.90
export SKILL_ROUTER_MEDIUM_THRESHOLD=0.70
```

To re-tune thresholds automatically, run the optimizer against the current corpus:

```bash
# Dry-run: shows proposed thresholds without writing
node bin/skill-router.mjs tune --analyze

# Apply: writes data/thresholds.json and re-runs the benchmark
node bin/skill-router.mjs tune --apply
```

The optimizer grid-searches `(high, medium)` pairs with `high` in [0.70, 0.95] step 0.05 and `medium` in [0.40, 0.75] step 0.05 (subject to `medium < high`), maximising Top-1 subject to fallback rate < 15%. The current corpus yields `high=0.85, medium=0.60` — the optimizer is threshold-invariant on this corpus because `rankSkills` normalises top scores to exactly 1.0 (`src/core/retriever/bm25.mjs:95-102`). See [docs/tuning.md](./tuning.md).

## Provider selection

The embedding provider is selected at module scope in `hooks/route.mjs` by `resolveProvider(config)` (`src/core/embeddings/resolve.mjs`). It maps the configured `embeddings.provider` mode through the registry in `src/config/defaults.mjs:107-117` to a provider type, constructs it, probes it with `isAvailable()` (a filesystem check only — no model load, no network), and falls back to FNV-1a with a stderr warning when the probe fails.

| Mode | Provider type | Experimental? | Risk label | Dependency load |
|------|---------------|---------------|------------|-----------------|
| `bm25-only` (default) | `fnv1a` | No | — | None |
| `fnv1a` | `fnv1a` | No | — | None |
| `onnx` | `onnx` | Yes | `untested_scale` | `@huggingface/transformers` (591 MB) |

To select the experimental ONNX provider:

```bash
export SKILL_ROUTER_EMBEDDING_PROVIDER=onnx
```

This is not recommended for production. The mode emits `{"event":"experimental_mode","mode":"onnx","risk":"untested_scale"}` on every invocation and warns on stderr (`src/core/embeddings/experimental.mjs`). The hook still runs and still fails open — a missing or unloaded ONNX model causes `resolveProvider()` to return `{ provider: null, warning: "..." }` and the hook degrades to pure BM25 (`hooks/route.mjs:52-53`).

See [docs/embeddings.md](./embeddings.md) for the full provider comparison and the conditions under which ONNX would be reconsidered.
