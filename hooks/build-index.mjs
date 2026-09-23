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
 *   SKILL_ROUTER_SOURCES  Colon-separated paths (e.g. "data/skills:data/skills/zcode")
 *
 * Each index entry carries a `source` field: "project" | "zcode-user".
 * Router skills (from router-skills/) are tagged with source: "project".
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

const config = getConfig();
const INDEX_PATH = resolve('data/skill-index.json');
const EMBEDDINGS_PATH = resolve('data/skill-embeddings.json');

/**
 * Parse colon-separated source paths from SKILL_ROUTER_SOURCES.
 * Falls back to the default project source.
 *
 * @returns {Array<{path:string, source:'project'|'zcode-user'}>}
 */
function parseSources() {
  const raw = process.env.SKILL_ROUTER_SOURCES;
  if (!raw) {
    // Default: project skills + router skills
    return [
      { path: resolve('data/skills'), source: 'project' },
      { path: resolve('router-skills'), source: 'project' },
    ];
  }

  const parts = raw.split(':').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return [
      { path: resolve('data/skills'), source: 'project' },
      { path: resolve('router-skills'), source: 'project' },
    ];
  }

  const sources = parts.map((p) => ({
    path: resolve(p),
    source: determineSource(resolve(p)),
  }));

  return sources;
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
 * When sources are nested (e.g. data/skills and data/skills/zcode),
 * skills under the deeper path get the child source label.
 *
 * @param {Array<object>} skills - raw skill objects from loadSkills
 * @param {Array<{path:string, source:string}>} sources
 * @returns {Array<object>}
 */
function tagSkillsBySource(skills, sources) {
  // Sort sources by path length descending so deepest (most specific) matches first
  const sorted = [...sources].sort((a, b) => b.path.length - a.path.length);

  return skills.map((skill) => {
    for (const src of sorted) {
      if (skill.path.startsWith(src.path + (skill.path[src.path.length] === '\\' ? '\\' : '/'))) {
        return { ...skill, source: src.source };
      }
    }
    // Fallback: tag with first source
    return { ...skill, source: sources[0]?.source ?? 'project' };
  });
}

async function main() {
  const startTime = performance.now();
  const sources = parseSources();

  console.log(`Building index from ${sources.length} source(s):`);
  for (const src of sources) {
    console.log(`  [${src.source}] ${src.path}`);
  }
  console.log('');

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

  // Deduplicate by path (same file may be found via multiple source scans)
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

  // Build BM25 index (list of skill objects)
  await writeFile(INDEX_PATH, JSON.stringify(deduplicated, null, 2), 'utf-8');

  // Build and persist embedding index
  const embeddingIndex = buildEmbeddingIndex(deduplicated);
  // Convert Map to plain object for JSON serialization
  const embeddingsForJson = {};
  for (const [name, vec] of embeddingIndex) {
    embeddingsForJson[name] = Array.from(vec);
  }
  await writeFile(EMBEDDINGS_PATH, JSON.stringify(embeddingsForJson, null, 2), 'utf-8');

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
  console.log(`  Embeddings:    ${EMBEDDINGS_PATH}`);
  console.log(`  Domains:       data/domains/ (auto-populated)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
