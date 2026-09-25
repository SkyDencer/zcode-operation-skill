/**
 * Build the skill index from one or more SKILL.md sources.
 *
 * Scans the directories specified by SKILL_ROUTER_SOURCES (colon-separated),
 * parses frontmatter, builds BM25 index and embedding index, and writes
 * both to data/skill-index.json and data/skill-embeddings.json.
 *
 * Default sources: data/skills/ (project) and router-skills/ (router dispatchers).
 * Optional additional source: data/skills/<zcode-skills-dir> (zcode-user).
 *
 * Environment variables:
 *   SKILL_ROUTER_SOURCES            Colon-separated paths
 *   SKILL_ROUTER_EMBEDDING_PROVIDER 'fnv1a' (default) or 'onnx'
 *
 * CLI flags:
 *   --provider <fnv1a|onnx>         Override the provider for index building
 *
 * Each index entry carries a `source` field: "project" | "zcode-user".
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { loadSkills } from '../src/loader.mjs';
import { buildEmbeddingIndex } from '../src/core/embeddings/engine.mjs';
import { logBuild } from '../src/core/telemetry/logger.mjs';
import { getConfig } from '../src/config/env.mjs';
import { populateDomainsFromSkills } from '../src/core/routing/domain-registry.mjs';
import { resolveCollisions } from '../src/index/dedupe.mjs';
import { projectSources } from '../src/index/sources.mjs';
import { createProvider } from '../src/core/embeddings/provider.mjs';

const config = getConfig();
const INDEX_PATH = resolve('data/skill-index.json');
const EMBEDDINGS_256_PATH = resolve('data/skill-embeddings.json');
const EMBEDDINGS_384_PATH = resolve('data/skill-embeddings-384.json');

// ─── CLI argument parsing ─────────────────────────────────────────────────────

/**
 * Parse CLI flags from process.argv.
 *
 * @returns {{provider: string}}
 */
function parseArgs() {
  const argv = process.argv.slice(2);
  let provider = process.env.SKILL_ROUTER_EMBEDDING_PROVIDER?.toLowerCase().trim() || 'fnv1a';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--provider' && argv[i + 1]) {
      provider = argv[++i].toLowerCase().trim();
    }
  }
  return { provider };
}

// ─── Source parsing ────────────────────────────────────────────────────────────

/**
 * Parse colon-separated source paths from SKILL_ROUTER_SOURCES.
 * Falls back to the default project source.
 *
 * @returns {Array<{path:string, source:'project'|'zcode-user'}>}
 */
function parseSources() {
  const raw = process.env.SKILL_ROUTER_SOURCES;
  if (!raw) {
    return projectSources();
  }

  const parts = raw.split(':').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return projectSources();
  }

  return parts.map((p) => ({
    path: resolve(p),
    source: determineSource(resolve(p)),
  }));
}

/**
 * Determine source label from directory path.
 *
 * @param {string} dir - resolved directory path
 * @returns {'project'|'zcode-user'}
 */
function determineSource(dir) {
  const zcodeSuffix = resolve('data/skills/zcode');
  if (dir === zcodeSuffix) {
    return 'zcode-user';
  }
  return 'project';
}

/**
 * Tag each skill with its most-specific source.
 *
 * @param {Array<object>} skills
 * @param {Array<{path:string, source:string}>} sources
 * @returns {Array<object>}
 */
function tagSkillsBySource(skills, sources) {
  const sorted = [...sources].sort((a, b) => b.path.length - a.path.length);

  return skills.map((skill) => {
    for (const src of sorted) {
      if (
        skill.path.startsWith(
          src.path + (skill.path[src.path.length] === '\\' ? '\\' : '/')
        )
      ) {
        return { ...skill, source: src.source };
      }
    }
    return { ...skill, source: sources[0]?.source ?? 'project' };
  });
}

// ─── Provider readiness ───────────────────────────────────────────────────────

/**
 * Return a ready ONNX provider, downloading the model on first use.
 *
 * Exits 1 with an actionable message when the model cannot be loaded
 * (offline, remote models disabled, corrupt cache). The build is aborted
 * before any file is written.
 *
 * @returns {Promise<object|null>} provider, or null after the failure exit
 */
async function ensureOnnxReady() {
  const provider = createProvider('onnx');
  if (provider.isAvailable()) return provider;

  console.log('  ONNX model is not cached — attempting download on first use.');
  try {
    await provider.downloadModel();
    return provider;
  } catch (err) {
    console.error(
      `  Embedding build aborted: ${err.message}\n` +
        '  No files were written. Re-run with --provider fnv1a to build the ' +
        '256-dim index.'
    );
    process.exit(1);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = performance.now();
  const { provider: providerType } = parseArgs();

  console.log(`Building index from ${parseSources().length} source(s):`);
  for (const src of parseSources()) {
    console.log(`  [${src.source}] ${src.path}`);
  }
  console.log(`  Provider: ${providerType}`);
  console.log('');

  const sources = parseSources();

  // Load skills from each source (skip missing directories)
  const allEntries = [];
  for (const src of sources) {
    if (!existsSync(src.path)) {
      console.warn(`[skill-router] source directory not found: ${src.path}`);
      continue;
    }
    const skills = await loadSkills(src.path);
    allEntries.push(...skills);
  }

  // Deduplicate by path
  const seenPaths = new Set();
  const uniqueEntries = [];
  for (const entry of allEntries) {
    if (!seenPaths.has(entry.path)) {
      seenPaths.add(entry.path);
      uniqueEntries.push(entry);
    }
  }

  // Tag each skill with its most-specific source
  const tagged = tagSkillsBySource(uniqueEntries, sources);

  // Deduplicate by name: project source wins on collisions
  const deduplicated = resolveCollisions(tagged);

  // Resolve the embedding provider before writing anything, so a provider
  // that cannot be loaded (e.g. ONNX offline, model never cached) leaves the
  // existing index untouched instead of half-rebuilding it.
  let provider = null;
  if (providerType === 'onnx') {
    provider = await ensureOnnxReady();
    if (!provider) return;
  }

  // Build BM25 index (list of skill objects)
  await writeFile(INDEX_PATH, JSON.stringify(deduplicated, null, 2), 'utf-8');

  // Build and persist embedding index
  if (provider) {
    const embeddingIndex = await provider.buildIndex(deduplicated);
    const embeddingsForJson = {};
    for (const [name, vec] of embeddingIndex) {
      embeddingsForJson[name] = Array.from(vec);
    }
    await writeFile(EMBEDDINGS_384_PATH, JSON.stringify(embeddingsForJson, null, 2), 'utf-8');
    console.log(`  Embeddings (384d): ${EMBEDDINGS_384_PATH}`);
  } else {
    const embeddingIndex = buildEmbeddingIndex(deduplicated);
    const embeddingsForJson = {};
    for (const [name, vec] of embeddingIndex) {
      embeddingsForJson[name] = Array.from(vec);
    }
    await writeFile(EMBEDDINGS_256_PATH, JSON.stringify(embeddingsForJson, null, 2), 'utf-8');
    console.log(`  Embeddings (256d): ${EMBEDDINGS_256_PATH}`);
  }

  // Auto-populate domain metadata for hierarchical routing
  populateDomainsFromSkills(deduplicated);

  // Count by source for summary
  const bySource = {};
  for (const skill of deduplicated) {
    bySource[skill.source] = (bySource[skill.source] || 0) + 1;
  }

  const durationMs = Math.round(performance.now() - startTime);
  await logBuild({ totalDocs: deduplicated.length, durationMs });

  console.log(`Indexed ${deduplicated.length} skills in ${durationMs} ms.`);
  for (const [source, count] of Object.entries(bySource)) {
    console.log(`  ${source}:  ${count}`);
  }
  console.log(`  BM25 index:    ${INDEX_PATH}`);
  console.log(`  Domains:       data/domains/ (auto-populated)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
