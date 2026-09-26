/**
 * Relevance floor tests (Sub-Phase 6.9 review fix, blocking finding B1).
 *
 * Neither retrieval source can abstain on its own. `rankSkills` returns an
 * entry for every indexed skill, including zero-score ones
 * (src/core/retriever/bm25.mjs), and every skill has a non-zero cosine
 * similarity under both providers, so weighted RRF handed the caller a
 * non-empty ranking for *every* prompt. The hook then injected five Laravel
 * backend skills (~20k characters) into an unrelated conversation:
 *
 *   prompt: "zzzz qqqq unrelated gibberish xyzzy"
 *   before: Tier: bm25, 5 skills, 20394 injected chars
 *   after:  no output.json at all (tier 'none')
 *
 * The floor restores the gate the replaced SLM path already had
 * (src/core/routing/hybrid.mjs returns tier 'none' below bm25MinThreshold).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rankSkills } from '../../src/index.mjs';
import { hybridRetrieve } from '../../src/core/retriever/hybrid.mjs';
import { createProvider } from '../../src/core/embeddings/provider.mjs';
import { getDefaults } from '../../src/config/defaults.mjs';

const index = JSON.parse(readFileSync(resolve('data/skill-index.json'), 'utf-8'));
const leafIndex = index.filter((s) => !s.name.startsWith('router-'));
const provider = createProvider('fnv1a');
const FLOOR = getDefaults().slm.bm25MinThreshold;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.error(`  ✗ ${message}`); }
}

console.log('\n=== Relevance floor tests ===\n');

const UNRELATED = 'zzzz qqqq unrelated gibberish xyzzy';
const RELEVANT = 'how do I write a laravel database migration';

// 1. The precondition the fix rests on: neither source can abstain.
console.log('1. Precondition — neither source abstains on its own');
const bm25Only = rankSkills(UNRELATED, leafIndex);
assert(bm25Only.length === leafIndex.length, 'rankSkills returns every skill for an unrelated prompt');
assert(bm25Only.every((r) => r.score === 0), 'and every one of them scores 0');
const unfloored = hybridRetrieve(UNRELATED, leafIndex, { provider, rerank: false, _weightSemantic: 0.6 });
assert(unfloored.length > 0, 'without a floor the retriever still returns a ranking (the bug)');
assert(unfloored.every((r) => r.semanticRrf > 0), 'each of them got a non-zero semantic RRF term');

// 2. The floor abstains.
console.log('\n2. The floor abstains on an unrelated prompt');
const floored = hybridRetrieve(UNRELATED, leafIndex, { provider, rerank: false, minBm25Score: FLOOR, _weightSemantic: 0.6 });
assert(Array.isArray(floored), 'returns an array');
assert(floored.length === 0, 'and it is empty, so the caller can report tier none');

// 3. The floor does not suppress a real match.
console.log('\n3. The floor keeps a real match');
const relevant = hybridRetrieve(RELEVANT, leafIndex, { provider, rerank: false, minBm25Score: FLOOR, _weightSemantic: 0.6 });
assert(relevant.length > 0, 'a relevant prompt still returns skills');
assert(relevant[0].bm25Score >= FLOOR, 'and its top result clears the floor');
assert(relevant.some((r) => r.skill.name === 'backend-migrations'), 'the expected skill survives the floor');

// 4. It works on the shipped default too (semantic weight 0).
console.log('\n4. The floor applies to the shipped default (semantic weight 0)');
const dfltUnrelated = hybridRetrieve(UNRELATED, leafIndex, { minBm25Score: FLOOR });
assert(dfltUnrelated.length === 0, 'default weights: unrelated prompt abstains');
const dfltRelevant = hybridRetrieve(RELEVANT, leafIndex, { minBm25Score: FLOOR });
assert(dfltRelevant.length > 0, 'default weights: relevant prompt still routes');
assert(dfltRelevant[0].skill.name === rankSkills(RELEVANT, leafIndex)[0].skill.name, 'default ranking matches pure BM25 top-1');

// 5. A prompt with no tokenisable content at all cannot reach the floor.
console.log('\n5. Empty / whitespace prompts');
for (const p of ['', '   ', '\t\n']) {
  const r = hybridRetrieve(p, leafIndex, { provider, rerank: false, minBm25Score: FLOOR, _weightSemantic: 0.6 });
  assert(r.length === 0, `prompt ${JSON.stringify(p)} returns nothing`);
}

// 6. The floor is opt-out, so callers that want every skill keep that ability.
console.log('\n6. minBm25Score 0 disables the floor');
const noFloorOption = hybridRetrieve(UNRELATED, leafIndex, { provider, rerank: false, minBm25Score: 0, _weightSemantic: 0.6 });
assert(noFloorOption.length > 0, 'minBm25Score: 0 restores the unfloored behaviour');

// 7. The hook reads the floor from the same config key as the SLM path.
console.log('\n7. Hook and SLM path share one threshold');
const defaults = getDefaults();
assert(defaults.slm.bm25MinThreshold === FLOOR, 'the floor is slm.bm25MinThreshold');
const hookSource = readFileSync(resolve('hooks/route.mjs'), 'utf-8');
assert(hookSource.includes('config.slm?.bm25MinThreshold'), 'the hook reads the same key');
assert(hookSource.includes('minBm25Score'), 'and passes it to hybridRetrieve');

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);
if (failed > 0) process.exit(1);
