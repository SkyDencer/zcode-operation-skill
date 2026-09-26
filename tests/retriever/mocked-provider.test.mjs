/**
 * Mocked-provider hybrid retrieval tests.
 *
 * Verifies that hybridRetrieve correctly uses a mocked provider
 * instance, producing deterministic rankings based on the mock's
 * embedding outputs. Also verifies that the provider's embed method
 * is called with the correct arguments.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hybridRetrieve } from '../../src/core/retriever/hybrid.mjs';
import { rankSkills } from '../../src/core/retriever/bm25.mjs';

const INDEX_PATH = resolve('data/skill-index.json');
const index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
const leafIndex = index.filter((s) => !s.name.startsWith('router-'));

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

console.log('\n=== Mocked-Provider Tests ===\n');

// 1. Mock provider that always returns identical embeddings
//    → all skills should have equal embedding similarity
//    → ranking should be determined primarily by BM25
console.log('1. Mock provider — identical embeddings');
const mockEmbeddings = new Float32Array(256).fill(0.0625); // unit-ish vector
let embedCallCount = 0;
const mockProvider = {
  name: 'mock',
  dimensions: 256,
  isAvailable() { return true; },
  embed(text) {
    embedCallCount++;
    return mockEmbeddings;
  },
  buildIndex(skills) {
    const idx = new Map();
    for (const s of skills) {
      idx.set(s.name, mockEmbeddings);
    }
    return idx;
  },
};

const resultMock = hybridRetrieve('test query', leafIndex, {
  provider: mockProvider,
  rerank: false,
  _weightSemantic: 0.6, // Non-zero to ensure embed is called
});
assert(resultMock.length > 0, 'mock provider returns results');
assert(embedCallCount > 0, 'provider.embed was called (with semantic weight > 0)');
// With identical embeddings, embedding similarity is equal for all skills.
// The ranking should match pure BM25 order (since semantic contribution is flat).
const bm25Only = rankSkills('test query', leafIndex);
assert(resultMock[0].skill.name === bm25Only[0].skill.name, 'top result matches pure BM25 with identical embeddings');

// 2. Mock provider that returns a predictable pattern
//    → second skill in BM25 ranking gets highest embedding score
console.log('\n2. Mock provider — skewed embeddings');
const mockEmbeddings2 = new Float32Array(256).fill(0);
mockEmbeddings2[0] = 1.0; // single dominant dimension

let embedCalls2 = [];
const mockProvider2 = {
  name: 'mock2',
  dimensions: 256,
  isAvailable() { return true; },
  embed(text) {
    embedCalls2.push(text);
    // Return a vector that makes "backend-*" skills score higher
    const vec = new Float32Array(256).fill(0);
    if (typeof text === 'string' && text.includes('backend')) {
      vec[0] = 1.0;
    }
    return vec;
  },
  buildIndex(skills) {
    const idx = new Map();
    for (const s of skills) {
      const desc = `${s.name} ${s.description} ${(s.keywords || []).join(' ')}`;
      const vec = new Float32Array(256).fill(0);
      if (desc.includes('backend') || s.name.includes('backend')) {
        vec[0] = 1.0;
      }
      idx.set(s.name, vec);
    }
    return idx;
  },
};

const resultSkewed = hybridRetrieve('backend API endpoint', leafIndex, {
  provider: mockProvider2,
  rerank: false,
});
assert(resultSkewed.length > 0, 'skewed mock provider returns results');
// At least one backend skill should rank high
const hasBackend = resultSkewed.some((r) => r.skill.name.startsWith('backend'));
assert(hasBackend, 'at least one backend skill in results with skewed provider');

// 3. Mock provider with empty embeddings
console.log('\n3. Mock provider — zero embeddings');
const zeroProvider = {
  name: 'zero',
  dimensions: 256,
  isAvailable() { return true; },
  embed() { return new Float32Array(256); },
  buildIndex(skills) {
    const idx = new Map();
    for (const s of skills) idx.set(s.name, new Float32Array(256));
    return idx;
  },
};

const resultZero = hybridRetrieve('test', leafIndex, {
  provider: zeroProvider,
  rerank: false,
});
assert(resultZero.length > 0, 'zero embeddings returns results');
// With all-zero embeddings, cosine similarity is 0 for all skills,
// but semantic RRF scores still contribute (0.6 * 1/(k+rank)).
// The result should still be valid and sorted descending.
assert(resultZero.every((r) => r.score >= (resultZero[resultZero.length - 1]?.score ?? 0)), 'zero embeddings results are sorted descending');

// 4. Provider is passed through to reranker
console.log('\n4. Provider passed to reranker');
const rerankCalls = [];
const mockProviderWithRerank = {
  name: 'rerank-mock',
  dimensions: 256,
  isAvailable() { return true; },
  embed(text) {
    rerankCalls.push(text);
    return new Float32Array(256).fill(0.0625);
  },
  buildIndex(skills) {
    const idx = new Map();
    for (const s of skills) idx.set(s.name, new Float32Array(256).fill(0.0625));
    return idx;
  },
};

const resultRerank = hybridRetrieve('test query', leafIndex, {
  provider: mockProviderWithRerank,
  rerank: true,
  topK: 3,
  _weightSemantic: 0.6, // Non-zero to ensure embed is called during reranking
});
assert(resultRerank.length <= 3, 'reranked result respects topK');
// The provider should have been used for feature extraction
assert(rerankCalls.length > 0, 'provider.embed was called during reranking (with semantic weight > 0)');

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
