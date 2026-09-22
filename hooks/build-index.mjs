/**
 * Build the skill index from SKILL.md manifests.
 *
 * Scans data/mock-skills/ (or any directory set via SKILL_ROUTER_SKILLS_DIR),
 * parses frontmatter, builds BM25 index and embedding index, and writes
 * both to data/skill-index.json and data/skill-embeddings.json.
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadSkills } from '../src/loader.mjs';
import { buildEmbeddingIndex } from '../src/core/embeddings/engine.mjs';
import { logBuild } from '../src/core/telemetry/logger.mjs';
import { getConfig } from '../src/config/env.mjs';

const config = getConfig();
const skillsDir =
  process.env.SKILL_ROUTER_SKILLS_DIR || resolve('data/skills');
const INDEX_PATH = resolve('data/skill-index.json');
const EMBEDDINGS_PATH = resolve('data/skill-embeddings.json');

async function main() {
  const startTime = performance.now();
  const skills = await loadSkills(skillsDir);

  // Build BM25 index (list of skill objects)
  await writeFile(INDEX_PATH, JSON.stringify(skills, null, 2), 'utf-8');

  // Build and persist embedding index
  const embeddingIndex = buildEmbeddingIndex(skills);
  // Convert Map to plain object for JSON serialization
  const embeddingsObject = {};
  // Float32Array cannot be JSON-stringified directly, so we store as typed array
  // We'll use a custom serializer: convert each Float32Array to a plain array
  const embeddingsForJson = {};
  for (const [name, vec] of embeddingIndex) {
    embeddingsForJson[name] = Array.from(vec);
  }
  await writeFile(EMBEDDINGS_PATH, JSON.stringify(embeddingsForJson, null, 2), 'utf-8');

  const durationMs = Math.round(performance.now() - startTime);
  await logBuild({ totalDocs: skills.length, durationMs });

  console.log(`Indexed ${skills.length} skills in ${durationMs} ms.`);
  console.log(`  BM25 index:    ${INDEX_PATH}`);
  console.log(`  Embeddings:    ${EMBEDDINGS_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
