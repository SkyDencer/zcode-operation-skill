/**
 * Public API re-exports for the Skill Router.
 *
 * All external consumers (hooks, tests, tools) should import from this
 * module rather than reaching into internal paths directly.
 */

// Retrieval
export { rankSkills, readSkillContent } from './core/retriever/bm25.mjs';
export { hybridRetrieve } from './core/retriever/hybrid.mjs';

// Reranking
export { rerank } from './core/reranker/engine.mjs';
export { extractFeatures } from './core/reranker/features.mjs';

// Embeddings
export { embed, cosineSimilarity, buildEmbeddingIndex } from './core/embeddings/engine.mjs';

// Routing
export { detectDomains } from './core/routing/detector.mjs';
export { planRoutes } from './core/routing/planner.mjs';

// Telemetry
export {
  logRecord,
  logRetrieve,
  logBuild,
  logError,
} from './core/telemetry/logger.mjs';
export { increment, recordTiming, getSnapshot, resetMetrics } from './core/telemetry/metrics.mjs';
export { reportMetrics, reportBenchmark } from './core/telemetry/reporter.mjs';

// Config
export { getDefaults, mergeWithEnv } from './config/defaults.mjs';
export { mergeEnvOverrides, getConfig } from './config/env.mjs';

// Utils
export { tokenize, normalizeText, filterStopwords, bigrams } from './utils/text.mjs';
export { readFileJson, writeFileJson, walkDir, resolvePath } from './utils/fs.mjs';
export { now, measure, percentile } from './utils/time.mjs';

// Loader
export { parseFrontmatter, loadSkills } from './loader.mjs';
