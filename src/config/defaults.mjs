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
      // Provider type: 'fnv1a' (default, zero-dependency) or 'onnx' (requires model download).
      // When set to 'onnx' and the model is not cached, the hook falls back to 'fnv1a'.
      provider: 'fnv1a',
      fallbackToFnv1a: true,
      // RRF fusion weights: how much each retrieval signal contributes to the fused score.
      // bm25 + semantic should sum to 1.0 for a proper convex combination.
      weights: { bm25: 0.4, semantic: 0.6 },
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
        // Retrained via linear regression on the 30-prompt benchmark (see
        // tests/reranker/weights-train.mjs). Updated after retraining.
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
