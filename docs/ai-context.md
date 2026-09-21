# AI Context — Technical Architecture

## Overview

The Skill Router is a local ZCode plugin that improves workflow authoring UX by
surfacing the most relevant subagents (skills) at the moment a user is writing a
workflow. Instead of forcing the author to remember or scroll through a flat list
of all available skills, the router inspects the current editing context, ranks
skills by lexical relevance, and presents a concise, confidence-scored shortlist.

The system is intentionally lightweight: no external ML models, no network
calls, and no persistent state beyond the JSON skill index.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     ZCode Editor                            │
│                    (workflow authoring)                     │
└──────────────────────┬──────────────────────────────────────┘
                       │ onWorkflowAuthoring hook
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                      HOOK LAYER                             │
│  hooks/skill-router.mjs  ←  receives context payload       │
│         │                                                    │
│         ▼                                                    │
│  validates payload, extracts query text                      │
│  delegates to Retriever                                      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                      SRC LAYER                              │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Loader  │→ │ Index    │→ │ Retriev- │→ │  Scorer  │   │
│  │          │  │ Builder  │  │  er      │  │          │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│       │                                                             │
│       ▼                                                             │
│  ┌──────────┐                                                      │
│  │ Logger   │  (structured jsonl to logs/*.jsonl)                  │
│  └──────────┘                                                      │
└──────────────────────┬──────────────────────────────────────┘
                       │ result
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    ZCode UI / Output                        │
│         (suggested skill shortlist + confidence)            │
└─────────────────────────────────────────────────────────────┘
```

## Components

### Hook (`hooks/skill-router.mjs`)

- Entry point invoked by ZCode on every authoring event.
- Receives the ZCode context payload (see [Hook Contract](#hook-contract)).
- Extracts the current workflow draft text as the query.
- Calls `Retriever.retrieve(query, options)` and formats the result for ZCode.
- Logs the request/response cycle via `Logger`.

### Index Builder (`src/index.mjs`)

- Reads all `.json` skill manifests from `data/mock-skills/` (or any configured directory).
- Builds an inverted index keyed by token, storing posting lists with document-level stats.
- Persists the index as `data/skill-index.json` (regenerated on `npm run build-index`).
- Uses BM25 parameters: `k1 = 1.5`, `b = 0.75`.

### Retriever (`src/retriever.mjs`)

- Accepts a natural-language query string and optional `topK` / `confidenceThreshold`.
- Tokenizes the query, looks up postings in the index, computes BM25 scores.
- Returns ranked results as `{ id, name, score, confidence }[]`.

### Scorer (`src/scorer.mjs`)

- Pure function: `score(queryTokens, index, docId) → number`.
- Normalises raw BM25 into a 0–1 confidence band using min-max scaling over the
  current result set (never across runs, to avoid cross-environment drift).

### Loader (`src/loader.mjs`)

- `loadSkills(dir) → Promise<SkillManifest[]>`
- Validates each manifest against the schema in this document.
- Skips malformed files with a warning logged to stderr.

### Logger (`src/logger.mjs`)

- Appends one JSON object per line to `logs/<timestamp>.jsonl`.
- Fields: `ts`, `event` (`retrieve`, `build`, `error`), `query`, `resultCount`, `durationMs`, `error?`.

## Skill Index Schema

```jsonc
{
  "format": "tedgram-skill-index-v1",
  "version": 1,
  "builtAt": "2026-09-20T00:00:00.000Z",
  "stats": {
    "totalDocs": 42,
    "totalTerms": 318,
    "avgDocLen": 187
  },
  "index": {
    "<term>": {
      "df": 5,
      "postings": [
        { "docId": "skill-001", "tf": 3, "positions": [2, 7, 14] }
      ]
    }
  },
  "docs": {
    "skill-001": {
      "id": "skill-001",
      "name": "Deploy to AWS",
      "description": "Deploy a Lambda function to an AWS account.",
      "tags": ["deploy", "aws", "lambda"],
      "manifestPath": "data/mock-skills/deploy-aws.json"
    }
  }
}
```

## Retrieval Algorithm (BM25 MVP)

For each query term *q*:

```
score(q, d) = IDF(q) * Σ over positions p of:
              (tf(q,d) * (k1 + 1))
              ─────────────────────────────────
              tf(q,d) + k1 * (1 - b + b * |d|/avgDL)
```

Where:
- `IDF(q) = ln((N - df(q) + 0.5) / (df(q) + 0.5) + 1)`
- `k1 = 1.5`, `b = 0.75`
- `|d|` = document length in tokens
- `avgDL` = average document length across the corpus

Results are sorted descending by score, truncated to `topK` (default 5).

## Confidence Policy

Raw BM25 scores are non-negative and unbounded. We map them into three bands
using fixed thresholds applied to the *current* result set's min-max range:

| Band       | Threshold (of range) | Meaning                              |
|------------|----------------------|--------------------------------------|
| `high`     | ≥ 0.85               | Strongly relevant — present prominently |
| `medium`   | ≥ 0.60               | Likely relevant — include in shortlist |
| `low`      | ≥ 0.35               | Weakly relevant — show only if few results |
| `dismiss`  | < 0.35               | Ignore — do not surface              |

If only one result is returned, it is auto-graded `high`.
If zero results match, the hook returns an empty suggestion list.

## Hook Contract

The ZCode `onWorkflowAuthoring` hook receives a payload shaped as:

```typescript
interface AuthoringContext {
  workflowId: string;
  draftText: string;          // full text of the workflow being authored
  cursorPosition: number;     // character offset of cursor
  metadata: {
    sessionId: string;
    timestamp: string;        // ISO 8601
  };
}
```

The hook MUST respond with:

```typescript
interface AuthoringSuggestion {
  skills: Array<{
    id: string;
    name: string;
    confidence: "high" | "medium" | "low";
    score: number;
    reason: string;           // human-readable justification
  }>;
  meta: {
    queryTerms: string[];
    totalMatched: number;
    latencyMs: number;
  };
}
```

See `docs/implementation-plan.md` for the per-phase hook integration details.

## Logging Format

Every log line is a single JSON object (no pretty-print), one per line:

```jsonl
{"ts":"2026-09-20T12:00:00.000Z","event":"retrieve","query":"deploy aws lambda","resultCount":3,"durationMs":12}
{"ts":"2026-09-20T12:00:00.001Z","event":"build","totalDocs":42,"totalTerms":318,"durationMs":87}
{"ts":"2026-09-20T12:00:01.000Z","event":"error","query":"deploy aws lambda","error":"index not found"}
```

Logs rotate by date: `logs/2026-09-20.jsonl`. Lines older than 30 days are
eligible for cleanup (Phase 4).

## Constraints

- **No external dependencies.** The plugin ships as plain ESM; zero `npm install`.
- **No network calls.** All data is local to the project directory.
- **Deterministic.** Same input always produces the same ranking.
- **Memory bounded.** The index is loaded into memory at build time; capped at
  the size of the skill directory (expected < 1 MB for <= 200 skills).
- **Encoding.** UTF-8 for all text; gracefully handle malformed JSON with a warning.

## Out of Scope (for this project)

- Semantic / vector-based search (reserved for future phase).
- Multi-tenant or cloud-synced skill registries.
- Learning user preferences over time (no feedback loop yet).
- GUI components — the hook communicates through ZCode's existing UI channel.
- Real-time index updates during authoring (index is rebuilt on demand).
