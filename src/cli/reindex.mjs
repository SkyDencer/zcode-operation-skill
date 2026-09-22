/**
 * reindex — Rebuild the skill index from the skills directory.
 *
 * Usage: node bin/skill-router.mjs reindex [--skills-dir <dir>]
 */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { loadSkills } from '../loader.mjs';
import { buildEmbeddingIndex } from '../core/embeddings/engine.mjs';
import { logBuild } from '../core/telemetry/logger.mjs';
import { populateDomainsFromSkills } from '../core/routing/domain-registry.mjs';
import { writeFile } from 'node:fs/promises';

const SKILLS_DIR = resolve('data/skills');
const INDEX_PATH = resolve('data/skill-index.json');
const EMBEDDINGS_PATH = resolve('data/skill-embeddings.json');

export async function main(argv) {
  let skillsDir = SKILLS_DIR;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--skills-dir' && argv[i + 1]) {
      skillsDir = resolve(argv[++i]);
    }
  }

  if (!existsSync(skillsDir)) {
    console.error(`Skills directory not found: ${skillsDir}`);
    process.exit(1);
  }

  console.log(`Rebuilding index from: ${skillsDir}`);
  console.log('');

  const startTime = performance.now();
  const skills = await loadSkills(skillsDir);

  await writeFile(INDEX_PATH, JSON.stringify(skills, null, 2), 'utf-8');

  const embeddingIndex = buildEmbeddingIndex(skills);
  const embeddingsForJson = {};
  for (const [name, vec] of embeddingIndex) {
    embeddingsForJson[name] = Array.from(vec);
  }
  await writeFile(EMBEDDINGS_PATH, JSON.stringify(embeddingsForJson, null, 2), 'utf-8');

  populateDomainsFromSkills(skills);

  const durationMs = Math.round(performance.now() - startTime);
  await logBuild({ totalDocs: skills.length, durationMs });

  console.log(`Indexed ${skills.length} skills in ${durationMs} ms.`);
  console.log(`  BM25 index:    ${INDEX_PATH}`);
  console.log(`  Embeddings:    ${EMBEDDINGS_PATH}`);
  console.log(`  Domains:       data/domains/ (auto-populated)`);
}
