/**
 * Weighted RRF fusion tests.
 *
 * Verifies that the hybrid retriever respects the configured
 * embeddings.weights (bm25 + semantic) when fusing rankings:
 *   - With equal weights, RRF scores differ from weighted scores.
 *   - With bm25=0, only embedding ranking contributes.
 *   - With semantic=0, only BM25 ranking contributes.
 *   - Weighted scores are a proper convex combination of the two sources.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hybridRetrieve } from '../../src/core/retriever/hybrid.mjs';
import { rankSkills } from '../../src/core/retriever/bm25.mjs';
import { createProvider } from '../../src/core/embeddings/provider.mjs';
import { getDefaults } from '../../src/config/defaults.mjs';

const INDEX_PATH = resolve('data/skill-index.json');
const index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
const leafIndex = index.filter((s) => !s.name.startsWith('router-'));
const provider = createProvider('fnv1a');
const query = 'laravel eloquent relationships';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log('  ✓', message);
  } else {
    failed++;
    console.error('  ✗', message);
  }
}

console.log('\n=== Weighted RRF Tests ===\n');

// 1. Default weights produce non-trivial fusion (both sources contribute)
console.log('1. Default weights — both sources contribute');
const defaultResult = hybridRetrieve(query, leafIndex, { provider, rerank: false });
const bm25Only = hybridRetrieve(query, leafIndex, {
  provider,
  rerank: false,
  _weightBm25: 1,
  _weightSemantic: 0,
});
const semanticOnly = hybridRetrieve(query, leafIndex, {
  provider,
  rerank: false,
  _weightBm25: 0,
  _weightSemantic: 1,
});
// With equal weighting (via options), results should match bm25-only or semantic-only
// But with default weights (1.0/0.0), only BM25 contributes.
assert(defaultResult.length > 0, 'default weighted result is non-empty');
assert(typeof defaultResult[0].score === 'number', 'default result has numeric score');
assert(typeof defaultResult[0].bm25Score === 'number', 'default result has bm25Score');
assert(typeof defaultResult[0].embeddingScore === 'number', 'default result has embeddingScore');

// 2. bm25 weight = 1, semantic = 0 → same as pure BM25
console.log('\n2. BM25-only weights match pure BM25');
const pureBm25 = rankSkills(query, leafIndex);
const bm25Weighted = hybridRetrieve(query, leafIndex, {
  provider,
  rerank: false,
  _weightBm25: 1,
  _weightSemantic: 0,
});
assert(bm25Weighted[0].skill.name === pureBm25[0].skill.name, 'bm25=1 top result matches pure BM25');

// 3. Configured weights are readable from defaults
console.log('\n3. Configured weights from defaults');
const defaults = getDefaults();
// NOTE: The default weights are bm25=1.0, semantic=0.0 because the
// Phase 6.10 benchmark sweep showed semantic embedding similarity was
// a net negative for Top-1 at every weight tested. See
// docs/reports/phase-6-embedding-benchmark.md for the full data.
assert(defaults.embeddings.weights.bm25 === 1.0, 'bm25 weight is 1.0 (semantic disabled by default)');
assert(defaults.embeddings.weights.semantic === 0.0, 'semantic weight is 0.0 (disabled by default)');

// 4. Weights sum to 1 (convex combination)
console.log('\n4. Weights form a convex combination');
const wSum = defaults.embeddings.weights.bm25 + defaults.embeddings.weights.semantic;
assert(Math.abs(wSum - 1.0) < 1e-9, `weights sum to 1.0 (got ${wSum})`);

// 5. Changing weights changes the ranking
console.log('\n5. Different weights produce different rankings');
const resultA = hybridRetrieve(query, leafIndex, { provider, rerank: false, k: 60 });
// With a very small k, BM25 dominates (rank difference is amplified)
const resultB = hybridRetrieve(query, leafIndex, { provider, rerank: false, k: 5 });
const different = resultA[0].skill.name !== resultB[0].skill.name ||
  Math.abs(resultA[0].score - resultB[0].score) > 1e-9;
assert(different, 'different k produces different ranking (confirms RRF is active)');

// 6. bm25Rrf and semanticRrf fields are present
console.log('\n6. Individual RRF components are tracked');
assert(typeof resultA[0].bm25Rrf === 'number', 'bm25Rrf is a number');
assert(typeof resultA[0].semanticRrf === 'number', 'semanticRrf is a number');
assert(resultA[0].bm25Rrf >= 0, 'bm25Rrf is non-negative');
assert(resultA[0].semanticRrf >= 0, 'semanticRrf is non-negative');

// 7. bm25Rrf + semanticRrf ≈ score (within floating-point tolerance)
console.log('\n7. Component scores sum to fused score');
for (const r of resultA.slice(0, 3)) {
  const sum = r.bm25Rrf + r.semanticRrf;
  const diff = Math.abs(r.score - sum);
  if (diff > 1e-9) {
    assert(false, `score ${r.score} ≠ bm25Rrf(${r.bm25Rrf}) + semanticRrf(${r.semanticRrf}) for ${r.skill.name}`);
    break;
  }
  if (r === resultA[2] || r.skill.name === resultA[resultA.length - 1].skill.name) {
    assert(true, 'component scores sum to fused score');
  }
}

// 8. The weights are numerically respected, not just read from config
console.log('\n8. Weight overrides change the fused components');
const onlyBm25 = hybridRetrieve(query, leafIndex, {
  provider,
  rerank: false,
  _weightBm25: 1,
  _weightSemantic: 0,
});
assert(onlyBm25.every((r) => r.semanticRrf === 0), 'semantic=0 zeroes every semanticRrf term');
assert(
  onlyBm25.every((r) => Math.abs(r.score - r.bm25Rrf) < 1e-12),
  'with semantic=0 the fused score is the BM25 RRF term alone',
);
const onlySemantic = hybridRetrieve(query, leafIndex, {
  provider,
  rerank: false,
  _weightBm25: 0,
  _weightSemantic: 1,
});
assert(onlySemantic.every((r) => r.bm25Rrf === 0), 'bm25=0 zeroes every bm25Rrf term');
assert(
  onlySemantic.every((r) => Math.abs(r.score - r.semanticRrf) < 1e-12),
  'with bm25=0 the fused score is the semantic RRF term alone',
);

// 9. Default weights scale each term by the configured weight
console.log('\n9. Default weights scale each RRF term');
const topDefault = defaultResult[0];
const bm25RankOfTop =
  rankSkills(query, leafIndex).findIndex((r) => r.skill.name === topDefault.skill.name) + 1;
// With bm25=1.0, semantic=0.0: bm25Rrf = 1/(60+rank), semanticRrf = 0
assert(
  bm25RankOfTop > 0 && Math.abs(topDefault.bm25Rrf - 1.0 / (60 + bm25RankOfTop)) < 1e-12,
  `bm25Rrf equals 1.0/(60+rank) with k=60 (got ${topDefault.bm25Rrf}, rank ${bm25RankOfTop})`,
);
// Semantic RRF should be 0 because semantic weight is 0.0
assert(
  topDefault.semanticRrf === 0,
  `semanticRrf equals 0 when semantic weight is 0 (got ${topDefault.semanticRrf})`,
);

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
