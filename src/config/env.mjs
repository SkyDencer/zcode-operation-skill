/**
 * Environment-variable-based configuration overrides.
 *
 * Reads SKILL_ROUTER_* env vars, validates types and ranges,
 * and merges them into the default config from defaults.mjs.
 */
import { getDefaults, mergeWithEnv } from './defaults.mjs';

/**
 * Valid range for a numeric config value.
 * @typedef {Object} Range
 * @property {number} min
 * @property {number} max
 */

/** Schema mapping env keys to their expected range and type. */
const SCHEMA = {
  SKILL_ROUTER_BM25_K1: { min: 0, max: 5, type: 'float' },
  SKILL_ROUTER_BM25_B: { min: 0, max: 1, type: 'float' },
  SKILL_ROUTER_BM25_NAME_WEIGHT: { min: 1, max: 10, type: 'int' },
  SKILL_ROUTER_BM25_DESC_WEIGHT: { min: 1, max: 10, type: 'int' },
  SKILL_ROUTER_BM25_KEYWORD_WEIGHT: { min: 1, max: 10, type: 'int' },
  SKILL_ROUTER_EMBED_DIMS: { min: 16, max: 4096, type: 'int' },
  SKILL_ROUTER_RRF_K: { min: 1, max: 1000, type: 'int' },
  SKILL_ROUTER_DOMAIN_THRESHOLD: { min: 0, max: 1, type: 'float' },
  SKILL_ROUTER_MULTI_DOMAIN_THRESHOLD: { min: 0, max: 1, type: 'float' },
  SKILL_ROUTER_HIERARCHICAL_CONFIDENCE_THRESHOLD: { min: 0, max: 1, type: 'float' },
  SKILL_ROUTER_HIGH_THRESHOLD: { min: 0, max: 1, type: 'float' },
  SKILL_ROUTER_MEDIUM_THRESHOLD: { min: 0, max: 1, type: 'float' },
  SKILL_ROUTER_TIMEOUT_MS: { min: 50, max: 30000, type: 'int' },
  SKILL_ROUTER_MAX_PROMPT_LENGTH: { min: 128, max: 102400, type: 'int' },
  SKILL_ROUTER_MAX_OUTPUT_LENGTH: { min: 1024, max: 102400, type: 'int' },
  SKILL_ROUTER_BUDGET_MAX_CHARS: { min: 1024, max: 102400, type: 'int' },
  SKILL_ROUTER_BUDGET_MIN_PER_SKILL: { min: 100, max: 10240, type: 'int' },
  // String-typed overrides are handled separately below; listed here for
  // documentation so they appear in help text and can be discovered by grep.
  SKILL_ROUTER_EMBEDDING_PROVIDER: { type: 'string' },
};

/**
 * Parse and validate a single env value against its schema.
 *
 * @param {string} key
 * @param {string} rawValue
 * @param {object} schema
 * @returns {number|number[]|string}
 */
function parseValue(key, rawValue, schema) {
  if (schema.type === 'string') {
    return rawValue.trim().toLowerCase();
  }
  const nums = rawValue
    .split(',')
    .map((s) => {
      const n = Number(s.trim());
      if (Number.isNaN(n)) {
        console.warn(`[skill-router] invalid ${key}: "${s.trim()}", skipping`);
        return NaN;
      }
      if (schema.type === 'int' && !Number.isInteger(n)) {
        console.warn(`[skill-router] ${key} expected int, got ${n}, truncating`);
        return Math.trunc(n);
      }
      if (n < schema.min || n > schema.max) {
        console.warn(
          `[skill-router] ${key}=${n} out of range [${schema.min},${schema.max}], clamping`
        );
        return Math.max(schema.min, Math.min(schema.max, n));
      }
      return n;
    })
    .filter((n) => !Number.isNaN(n));
  return nums.length === 1 ? nums[0] : nums;
}

/**
 * Read SKILL_ROUTER_* env vars, validate, and merge into defaults.
 *
 * @param {object} defaults — from getDefaults()
 * @returns {object} merged config
 */
export function mergeEnvOverrides(defaults) {
  const cfg = mergeWithEnv(defaults);

  for (const [key, schema] of Object.entries(SCHEMA)) {
    const raw = process.env[key];
    if (raw === undefined || raw.trim() === '') continue;
    const parsed = parseValue(key, raw, schema);
    const path = getPath(key);
    if (!path) continue;
    let obj = cfg;
    for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
    obj[path[path.length - 1]] = parsed;
  }

  return cfg;
}

/**
 * Resolve an env-var key to its config-path array.
 *
 * @param {string} key
 * @returns {string[]|null}
 */
function getPath(key) {
  const pathMap = {
    SKILL_ROUTER_BM25_K1: ['bm25', 'k1'],
    SKILL_ROUTER_BM25_B: ['bm25', 'b'],
    SKILL_ROUTER_BM25_NAME_WEIGHT: ['bm25', 'nameWeight'],
    SKILL_ROUTER_BM25_DESC_WEIGHT: ['bm25', 'descriptionWeight'],
    SKILL_ROUTER_BM25_KEYWORD_WEIGHT: ['bm25', 'keywordWeight'],
    SKILL_ROUTER_EMBED_DIMS: ['embeddings', 'dimensions'],
    SKILL_ROUTER_EMBEDDING_PROVIDER: ['embeddings', 'provider'],
    SKILL_ROUTER_RRF_K: ['rrf', 'k'],
    SKILL_ROUTER_DOMAIN_THRESHOLD: ['routing', 'domainThreshold'],
    SKILL_ROUTER_MULTI_DOMAIN_THRESHOLD: ['routing', 'multiDomainThreshold'],
    SKILL_ROUTER_HIERARCHICAL_CONFIDENCE_THRESHOLD: ['routing', 'hierarchicalConfidenceThreshold'],
    SKILL_ROUTER_HIGH_THRESHOLD: ['confidence', 'highThreshold'],
    SKILL_ROUTER_MEDIUM_THRESHOLD: ['confidence', 'mediumThreshold'],
    SKILL_ROUTER_TIMEOUT_MS: ['hook', 'timeoutMs'],
    SKILL_ROUTER_MAX_PROMPT_LENGTH: ['hook', 'maxPromptLength'],
    SKILL_ROUTER_MAX_OUTPUT_LENGTH: ['hook', 'maxOutputLength'],
    SKILL_ROUTER_BUDGET_MAX_CHARS: ['budget', 'maxChars'],
    SKILL_ROUTER_BUDGET_MIN_PER_SKILL: ['budget', 'minPerSkill'],
  };
  return pathMap[key] ?? null;
}

// Export the active config singleton
const _config = mergeEnvOverrides(getDefaults());
export function getConfig() {
  return _config;
}
