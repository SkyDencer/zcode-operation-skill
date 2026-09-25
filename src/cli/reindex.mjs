/**
 * reindex — Rebuild the skill index from one or more sources.
 *
 * Usage: node bin/skill-router.mjs reindex [--skills-dir <dir>] [--sources project,zcode-user]
 */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { loadSkills } from '../loader.mjs';
import { buildEmbeddingIndex } from '../core/embeddings/engine.mjs';
import { logBuild } from '../core/telemetry/logger.mjs';
import { populateDomainsFromSkills } from '../core/routing/domain-registry.mjs';
import { writeFile } from 'node:fs/promises';
import { resolveCollisions } from '../index/dedupe.mjs';
import { projectSources } from '../index/sources.mjs';

// Default corpus must match hooks/build-index.mjs: leaf skills + router skills.
// Reindexing with data/skills alone silently dropped the 6 router-* entries.
const DEFAULT_SOURCES = projectSources();
const INDEX_PATH = resolve('data/skill-index.json');
const EMBEDDINGS_PATH = resolve('data/skill-embeddings.json');

/**
 * Parse --sources flag value into source config array.
 *
 * Supported values: "project", "zcode-user", "all"
 *
 * @param {string|null} sourcesFlag
 * @returns {Array<{path:string, source:string}>}
 */
function parseSourcesFlag(sourcesFlag) {
  if (!sourcesFlag) return DEFAULT_SOURCES;

  const parts = sourcesFlag.split(',').map((p) => p.trim().toLowerCase());
  const sources = [];

  // Always include the project source (leaf skills + router dispatchers)
  if (parts.includes('all') || parts.includes('project')) {
    sources.push(...projectSources());
  }

  // Include zcode-user source if available
  if (parts.includes('all') || parts.includes('zcode-user')) {
    const zcodePath = resolve('data/skills/zcode');
    if (existsSync(zcodePath)) {
      sources.push({ path: zcodePath, source: 'zcode-user' });
    } else {
      console.warn(`[skill-router] zcode-user source directory not found: ${zcodePath}`);
    }
  }

  return sources.length > 0 ? sources : DEFAULT_SOURCES;
}

/**
 * Tag each skill with its most-specific source.
 *
 * When sources are nested (e.g. data/skills and data/skills/zcode),
 * skills under the deeper path get the child source label.
 *
 * @param {Array<object>} skills
 * @param {Array<{path:string, source:string}>} sources
 * @returns {Array<object>}
 */
function tagSkillsBySource(skills, sources) {
  const sorted = [...sources].sort((a, b) => b.path.length - a.path.length);

  return skills.map((skill) => {
    for (const src of sorted) {
      const separator = skill.path[src.path.length] === '\\' ? '\\' : '/';
      if (skill.path.startsWith(src.path + separator)) {
        return { ...skill, source: src.source };
      }
    }
    return { ...skill, source: sources[0]?.source ?? 'project' };
  });
}

export async function main(argv) {
  let skillsDir = null;
  let sourcesFlag = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--skills-dir' && argv[i + 1]) {
      skillsDir = resolve(argv[++i]);
    } else if (argv[i] === '--sources' && argv[i + 1]) {
      sourcesFlag = argv[++i];
    }
  }

  // Override single-dir mode if --skills-dir is given (backward compat)
  let sources;
  if (skillsDir) {
    sources = [{ path: resolve(skillsDir), source: 'project' }];
  } else {
    sources = parseSourcesFlag(sourcesFlag);
  }

  // Validate that at least one source directory exists
  for (const src of sources) {
    if (!existsSync(src.path)) {
      console.error(`Source directory not found: ${src.path}`);
      process.exit(1);
    }
  }

  console.log(`Rebuilding index from ${sources.length} source(s):`);
  for (const src of sources) {
    console.log(`  [${src.source}] ${src.path}`);
  }
  console.log('');

  const startTime = performance.now();

  // Load from all sources (may have overlaps due to recursion)
  const allEntries = [];
  for (const src of sources) {
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

  // Deduplicate by name
  const deduplicated = resolveCollisions(tagged);

  await writeFile(INDEX_PATH, JSON.stringify(deduplicated, null, 2), 'utf-8');

  const embeddingIndex = buildEmbeddingIndex(deduplicated);
  const embeddingsForJson = {};
  for (const [name, vec] of embeddingIndex) {
    embeddingsForJson[name] = Array.from(vec);
  }
  await writeFile(EMBEDDINGS_PATH, JSON.stringify(embeddingsForJson, null, 2), 'utf-8');

  populateDomainsFromSkills(deduplicated);

  const durationMs = Math.round(performance.now() - startTime);
  await logBuild({ totalDocs: deduplicated.length, durationMs });

  // Source breakdown
  const bySource = {};
  for (const skill of deduplicated) {
    bySource[skill.source] = (bySource[skill.source] || 0) + 1;
  }

  console.log(`Indexed ${deduplicated.length} skills in ${durationMs} ms.`);
  for (const [source, count] of Object.entries(bySource)) {
    console.log(`  ${source}:  ${count}`);
  }
  console.log(`  BM25 index:    ${INDEX_PATH}`);
  console.log(`  Embeddings:    ${EMBEDDINGS_PATH}`);
  console.log(`  Domains:       data/domains/ (auto-populated)`);
}
