/**
 * Hybrid retriever RRF-constant configuration tests (Sub-Phase 6.7).
 *
 * Pins that `hybridRetrieve()` derives its Reciprocal Rank Fusion constant
 * from the configuration object (`getDefaults().rrf.k`, the key behind the
 * documented SKILL_ROUTER_RRF_K env var in src/config/defaults.mjs) instead
 * of an inline numeric literal.
 *
 * Why this file exists: the Sub-Phase 6.7 provider refactor rewrote
 * `const k = options.k ?? rrf.k` as `options.k ?? 60`. The value was
 * identical (rrf.k is 60), so no ranking changed and every accuracy test
 * still passed — but the module was silently severed from its config key.
 * A purely behavioural test cannot catch that, so this test asserts both
 * the observable contract (default == configured constant) and the source
 * contract that keeps the config link alive.
 *
 * Not registered in the package.json test chain: the concurrent Sub-Phase
 * 6.8 agent is rewriting that single-line chain string to add
 * tests/embeddings/onnx-provider.test.mjs. Run it directly:
 *   node tests/embeddings/hybrid-rrf-config.test.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hybridRetrieve } from '../../src/core/retriever/hybrid.mjs';
import { createProvider } from '../../src/core/embeddings/provider.mjs';
import { getDefaults } from '../../src/config/defaults.mjs';

const HYBRID_PATH = resolve('src/core/retriever/hybrid.mjs');
const INDEX_PATH = resolve('data/skill-index.json');

const { rrf } = getDefaults();
const index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
const leafIndex = index.filter((s) => !s.name.startsWith('router-'));
const provider = createProvider('fnv1a');

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

console.log('\n=== Hybrid RRF Configuration Tests ===\n');

// 1. The configured constant is the documented default
console.log('1. Configured RRF constant');
assert(rrf.k === 60, `getDefaults().rrf.k is 60 (got ${rrf.k})`);

// 2. Default fusion constant equals the configured constant
console.log('\n2. Default constant equals configured constant');
const query = 'laravel eloquent relationships';
const byDefault = hybridRetrieve(query, leafIndex, { provider });
const byConfiguredK = hybridRetrieve(query, leafIndex, { provider, k: rrf.k });
assert(byDefault.length === byConfiguredK.length, 'same result count');
let scoresMatch = byDefault.length > 0;
for (let i = 0; i < byDefault.length; i++) {
  if (
    byDefault[i].skill.name !== byConfiguredK[i].skill.name ||
    Math.abs(byDefault[i].score - byConfiguredK[i].score) > 1e-12
  ) {
    scoresMatch = false;
    console.error(
      `    [${i}] ${byDefault[i].skill.name}=${byDefault[i].score} vs ` +
        `${byConfiguredK[i].skill.name}=${byConfiguredK[i].score}`
    );
    break;
  }
}
assert(scoresMatch, 'default scores are identical to an explicit k = getDefaults().rrf.k');

// 3. An explicit k still overrides the configured default
console.log('\n3. Explicit k overrides the default');
const bySmallK = hybridRetrieve(query, leafIndex, { provider, k: 1 });
assert(bySmallK.length > 0, 'k=1 returns results');
let differs = false;
for (let i = 0; i < Math.min(bySmallK.length, byDefault.length); i++) {
  if (Math.abs(bySmallK[i].score - byDefault[i].score) > 1e-9) {
    differs = true;
    break;
  }
}
assert(differs, 'k=1 produces different fusion scores than the default constant');

// 4. Source contract: the constant is read from config, not a literal
console.log('\n4. Source contract (config link)');
const source = readFileSync(HYBRID_PATH, 'utf-8');
assert(
  /const\s*\{\s*rrf(?:\s*,\s*embeddings)?\s*\}\s*=\s*getDefaults\(\)/.test(source),
  'hybrid.mjs destructures rrf (and optionally embeddings) from getDefaults()'
);
assert(
  source.includes('options.k ?? rrf.k'),
  'default k falls back to rrf.k'
);
assert(
  !source.includes('options.k ?? 60'),
  'no hardcoded 60 fusion constant remains'
);

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
