/**
 * Default configuration parameters for the Skill Router.
 *
 * All tunable constants live here so they can be overridden via
 * environment variables (see src/config/env.mjs).
 *
 * Confidence thresholds are loaded from data/thresholds.json when present
 * (produced by src/tuning/optimizer.mjs), otherwise the hardcoded defaults
 * below are used.
 *
 * BM25 field weights are loaded from data/weights.json when present
 * (produced by src/core/retriever/weights.mjs), otherwise the hardcoded
 * defaults below are used.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Load optimized thresholds from data/thresholds.json if it exists.
 * Falls back to undefined when the file is absent or malformed.
 *
 * @returns {{high:number, medium:number}|undefined}
 */
function loadThresholds() {
  try {
    const path = resolve('data/thresholds.json');
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw);
    if (typeof data.high === 'number' && typeof data.medium === 'number') {
      return { high: data.high, medium: data.medium };
    }
  } catch {
    // File missing or malformed — use hardcoded defaults
  }
  return undefined;
}

const _thresholds = loadThresholds();

/**
 * Load adaptive BM25 field weights from data/weights.json if it exists.
 * Falls back to hardcoded defaults when the file is absent or malformed.
 *
 * @returns {{name:number, description:number, keywords:number}|undefined}
 */
function loadWeights() {
  try {
    const path = resolve('data/weights.json');
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw);
    if (
      typeof data.name === 'number' &&
      typeof data.description === 'number' &&
      typeof data.keywords === 'number'
    ) {
      return { name: data.name, description: data.description, keywords: data.keywords };
    }
  } catch {
    // File missing or malformed — use hardcoded defaults
  }
  return undefined;
}

const _weights = loadWeights();

/**
 * Return the default configuration object.
 *
 * @returns {object}
 */
export function getDefaults() {
  return {
    bm25: {
      k1: 1.5,
      b: 0.75,
      nameWeight: _weights?.name ?? 3,
      descriptionWeight: _weights?.description ?? 2,
      keywordWeight: _weights?.keywords ?? 1,
    },
    embeddings: {
      dimensions: 256,
      ngramSizes: [2, 3],
      hashSeed: 0x811c9dc5,
      // Provider type: 'fnv1a' (default, zero-dependency) or 'onnx' (requires
      // model download). When set to 'onnx' and the model is not cached, the
      // hook falls back to 'fnv1a'.
      //
      // Sub-Phase 6.10 decision, measured on the 130-prompt real corpus
      // (docs/reports/phase-6-embedding-benchmark.md): ONNX stays opt-in.
      // With the semantic channel switched on (bm25 0.4 / semantic 0.6) ONNX
      // beats FNV-1a on Set Recall@5 by 5.18 pp (0.9052 vs 0.8534 over the
      // 116 prompts that name a skill) but costs 1445 ms median latency
      // against the 100 ms the decision rule allows — 14x over. Both are
      // worse than pure BM25 (1.0000). Keeping 'fnv1a' as the default also
      // keeps the default path free of a 591 MB dependency tree and a
      // 469 ms first-prompt model load.
      provider: 'fnv1a',
      fallbackToFnv1a: true,
      // RRF fusion weights: how much each retrieval signal contributes to the fused score.
      // bm25 + semantic should sum to 1.0 for a proper convex combination.
      //
      // MEASURED, not assumed. Weight sweep over the 130-prompt real-corpus
      // benchmark on the 54-skill leaf index the hook actually uses, with the
      // lexical relevance floor at 0.35 and reranking off (Top-1 hits / 130):
      //
      //   bm25/semantic   fnv1a   onnx(MiniLM)
      //   0.4 / 0.6        72        100     <- the weight this file used to ship
      //   0.5 / 0.5        85        108
      //   0.7 / 0.3        97        112
      //   0.9 / 0.1       123        120
      //   1.0 / 0.0       126        126     <- shipped default
      //   BM25 alone      126        126
      //
      // The semantic channel is a net negative for Top-1 at every weight and
      // with both providers, so it is off by default. It is not dead code: set
      // SKILL_ROUTER_RRF_SEMANTIC_WEIGHT (with the matching BM25 weight) to
      // bring it back once a provider is shown to help a target metric.
      // See docs/reports/phase-6-embedding-benchmark.md (Sub-Phase 6.10).
      // At 0.4/0.6 on the 130-prompt corpus, Set Recall@5 is 1.0000 (BM25
      // alone), 0.8534 (FNV-1a) and 0.9052 (ONNX).
      weights: { bm25: 1.0, semantic: 0.0 },
    },
    rrf: {
      k: 60,
    },
    reranker: {
      weights: {
        exactKeyword: 0.3,
        bigramOverlap: 0.2,
        domainMatch: 0.5,
        titleMatch: 3.0,
        // Cosine similarity between prompt and skill description embeddings.
        // Overridden by data/reranker-weights.json when that file is present;
        // those weights come from a least-squares fit over the 30-prompt
        // benchmark (src/scripts/train-reranker-weights.mjs). That fit's R² is
        // an IN-SAMPLE fit statistic, and the script's held-out R² is
        // negative — see the "WHAT THE FIT NUMBERS DO AND DO NOT MEAN" block
        // in that script before quoting either number.
        embeddingSimilarity: 0.8,
      },
    },
    routing: {
      domainThreshold: 0.80,
      multiDomainThreshold: 0.50,
      hierarchicalTopDomains: 3,
      hierarchicalConfidenceThreshold: 0.08,
    },
    confidence: {
      highThreshold: _thresholds?.high ?? 0.85,
      mediumThreshold: _thresholds?.medium ?? 0.60,
    },
    hook: {
      timeoutMs: 200,
      maxPromptLength: 10240,
      maxOutputLength: 30000,
    },
    budget: {
      maxChars: 24000,
      minPerSkill: 500,
    },
    slm: {
      enabled: false,
      topCandidates: 20,
      maxSelected: 7,
      bm25MinThreshold: 0.35,
      slmMinConfidence: 0.5,
      slmTimeoutMs: 2000,
      endpoint: 'http://127.0.0.1:8080',
      model: 'qwen2.5',
    },
  };
}

/**
 * Merge environment overrides into the default config.
 *
 * Reads SKILL_ROUTER_* prefixed environment variables and applies
 * them as numeric overrides where present.
 *
 * @param {object} defaults — from getDefaults()
 * @returns {object} merged config
 */
export function mergeWithEnv(defaults) {
  const cfg = JSON.parse(JSON.stringify(defaults)); // deep clone
  function override(path, envKey) {
    const val = process.env[envKey];
    if (val === undefined) return;
    const nums = val.split(',').map(Number);
    const parts = path.split('.');
    let obj = cfg;
    for (let i = 0; i < parts.length - 1; i++) {
      obj = obj[parts[i]];
    }
    const last = parts[parts.length - 1];
    if (nums.length === 1 && !Number.isNaN(nums[0])) {
      obj[last] = nums[0];
    } else {
      obj[last] = nums.filter((n) => !Number.isNaN(n));
    }
  }

  override('bm25.k1', 'SKILL_ROUTER_BM25_K1');
  override('bm25.b', 'SKILL_ROUTER_BM25_B');
  override('bm25.nameWeight', 'SKILL_ROUTER_BM25_NAME_WEIGHT');
  override('bm25.descriptionWeight', 'SKILL_ROUTER_BM25_DESC_WEIGHT');
  override('bm25.keywordWeight', 'SKILL_ROUTER_BM25_KEYWORD_WEIGHT');
  override('embeddings.dimensions', 'SKILL_ROUTER_EMBED_DIMS');
  override('embeddings.weights.bm25', 'SKILL_ROUTER_RRF_BM25_WEIGHT');
  override('embeddings.weights.semantic', 'SKILL_ROUTER_RRF_SEMANTIC_WEIGHT');
  override('rrf.k', 'SKILL_ROUTER_RRF_K');
  override('routing.domainThreshold', 'SKILL_ROUTER_DOMAIN_THRESHOLD');
  override('routing.multiDomainThreshold', 'SKILL_ROUTER_MULTI_DOMAIN_THRESHOLD');
  override('confidence.highThreshold', 'SKILL_ROUTER_HIGH_THRESHOLD');
  override('confidence.mediumThreshold', 'SKILL_ROUTER_MEDIUM_THRESHOLD');
  override('hook.timeoutMs', 'SKILL_ROUTER_TIMEOUT_MS');
  override('hook.maxPromptLength', 'SKILL_ROUTER_MAX_PROMPT_LENGTH');
  override('hook.maxOutputLength', 'SKILL_ROUTER_MAX_OUTPUT_LENGTH');
  override('budget.maxChars', 'SKILL_ROUTER_BUDGET_MAX_CHARS');
  override('budget.minPerSkill', 'SKILL_ROUTER_BUDGET_MIN_PER_SKILL');

  // Boolean env override for SLM enablement
  const slmEnabledRaw = process.env.SKILL_ROUTER_SLM_ENABLED;
  if (slmEnabledRaw !== undefined && slmEnabledRaw.trim() !== '') {
    const val = slmEnabledRaw.trim().toLowerCase();
    cfg.slm.enabled = val !== 'false' && val !== '0' && val !== '';
  }

  return cfg;
}
