/**
 * Sub-Phase 7.6 — prebuilt parsed-index cache correctness.
 *
 * Pins the guarantee the hook relies on: rankSkills() with the prebuilt
 * corpus side (src/core/retriever/prebuilt.mjs) returns the SAME ranking
 * (identical order and scores) as the slow path that re-tokenizes every
 * call, both over a full index and over a leaf-only subset (where IDF and
 * average doc length must be recomputed for the subset, not read from the
 * cache). It also pins the invalidation: stale fingerprints, changed field
 * weights, or a changed document set must yield null so the caller falls
 * back to the slow path.
 *
 * The last section measures the slow-vs-fast gap on the committed 1000-entry
 * fixture so the report can attribute the Sub-Phase 7.6 numbers.
 *
 * Run: node tests/retriever/prebuilt.test.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankSkills } from '../../src/core/retriever/bm25.mjs';
import {
  buildPrebuiltIndex,
  preparePrebuiltFor,
  PREBUILT_VERSION,
} from '../../src/core/retriever/prebuilt.mjs';
import { computeIndexFingerprint } from '../../src/core/cache/query-cache.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ok: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

// A deterministic corpus: 60 skills with overlapping terms so IDF is
// non-trivial, plus router-* entries to exercise the leaf-subset case.
const corpus = [];
for (let i = 0; i < 60; i++) {
  const d = ['backend', 'frontend', 'design', 'testing', 'devops', 'meta'][i % 6];
  corpus.push({
    name: `${d}-skill-${i}`,
    description: `Guidance for ${d} tasks with caching, migrations, and pipeline checks (${i % 7 === 0 ? 'edge' : 'core'}).`,
    keywords: [d, 'caching', i % 5 === 0 ? 'edge' : 'core', `marker-${i % 11}`],
    domains: [d],
    path: `data/skills/${d}/skill-${i}/SKILL.md`,
    version: '0.1.0',
  });
}
for (let i = 0; i < 4; i++) {
  corpus.push({
    name: `router-x${i}`,
    description: `Dispatcher for x${i} work.`,
    keywords: [],
    domains: ['meta'],
    path: `router-skills/router-x${i}/SKILL.md`,
    version: '0.1.0',
  });
}
const leaf = corpus.filter((s) => !s.name.startsWith('router-'));

const PROMPTS = [
  'how do I handle backend caching edge cases',
  'frontend migrations pipeline marker-3',
  'design system marker-7 core',
  'zzzz qqqq flibbered gibberish',
];

function sameRanking(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].skill.name !== b[i].skill.name || a[i].score !== b[i].score) return false;
  }
  return true;
}

console.log('\n=== Prebuilt cache: slow/fast equivalence ===\n');
for (const prompt of PROMPTS) {
  const pre = buildPrebuiltIndex(corpus);
  const prepared = preparePrebuiltFor(corpus, leaf, pre);
  assert(prepared !== null, `prebuilt validates for the 64-entry corpus (${prompt.slice(0, 24)}…)`);
  const slow = rankSkills(prompt, leaf);
  const fast = rankSkills(prompt, leaf, { _prebuilt: prepared });
  assert(sameRanking(slow, fast), `identical ranking (all ${slow.length} docs, scores bit-equal) for "${prompt}"`);
}

console.log('\n=== Prebuilt cache: full-index subset ===\n');
{
  // Slow path over the leaf subset is the reference; the prebuilt path must
  // reproduce it even though the cache was built over the FULL array.
  const pre = buildPrebuiltIndex(corpus);
  const prepared = preparePrebuiltFor(corpus, leaf, pre);
  const slow = rankSkills('backend caching marker-5', leaf);
  const fast = rankSkills('backend caching marker-5', leaf, { _prebuilt: prepared });
  assert(sameRanking(slow, fast), 'leaf subset scores equal the slow path despite full-array cache');
}

console.log('\n=== Prebuilt cache: invalidation ===\n');
{
  const pre = buildPrebuiltIndex(corpus);

  // Document set changed: a new skill is not in the cache.
  const grown = [...corpus, { name: 'router-new', description: 'New dispatcher.', keywords: [], domains: ['meta'], path: 'x', version: '0.1.0' }];
  assert(preparePrebuiltFor(grown, grown, pre) === null, 'changed document set invalidates the cache');

  // Fingerprint tampered.
  const tampered = { ...pre, fingerprint: 'deadbeefdeadbeef' };
  assert(preparePrebuiltFor(corpus, leaf, tampered) === null, 'tampered fingerprint invalidates the cache');

  // Weights stamp changed (as after a data/weights.json tune without rebuild).
  const staleWeights = JSON.parse(JSON.stringify(pre));
  staleWeights.fieldWeights.name = staleWeights.fieldWeights.name + 1;
  assert(preparePrebuiltFor(corpus, leaf, staleWeights) === null, 'stale weight stamp invalidates the cache');

  // Wrong version.
  assert(preparePrebuiltFor(corpus, leaf, { ...pre, version: PREBUILT_VERSION + 1 }) === null, 'version bump invalidates the cache');

  // Corrupt shape.
  assert(preparePrebuiltFor(corpus, leaf, { version: PREBUILT_VERSION }) === null, 'missing docs array is rejected');

  // The fingerprint really is the one of the array it was built from.
  assert(computeIndexFingerprint(corpus) === pre.fingerprint, 'stamped fingerprint matches the source array');
}

console.log('\n=== Prebuilt cache: measured gap at 1000 skills ===\n');
{
  const fixturePath = resolve(ROOT, 'tests/fixtures/large-index/skill-index-1000.json');
  const prePath = resolve(ROOT, 'tests/fixtures/large-index/skill-index-1000.prebuilt.json');
  if (existsSync(fixturePath) && existsSync(prePath)) {
    const idx = JSON.parse(readFileSync(fixturePath, 'utf-8'));
    const leafIdx = idx.filter((s) => !s.name.startsWith('router-'));
    const prebuilt = JSON.parse(readFileSync(prePath, 'utf-8'));
    const prepared = preparePrebuiltFor(idx, leafIdx, prebuilt);
    assert(prepared !== null, `fixture prebuilt validates for the 1000-entry index (leaf ${leafIdx.length})`);
    assert(
      computeIndexFingerprint(idx) === prebuilt.fingerprint,
      'fixture prebuilt fingerprint matches the fixture index'
    );
    const prompt = 'how do I implement caching following best practices?';
    const time = (fn, n) => {
      const t0 = process.hrtime.bigint();
      for (let i = 0; i < n; i++) fn();
      return Number(process.hrtime.bigint() - t0) / n / 1e6;
    };
    const slowMs = time(() => rankSkills(prompt, leafIdx), 20);
    const fastMs = time(() => rankSkills(prompt, leafIdx, { _prebuilt: prepared }), 20);
    const slowRanked = rankSkills(prompt, leafIdx);
    const fastRanked = rankSkills(prompt, leafIdx, { _prebuilt: prepared });
    assert(sameRanking(slowRanked, fastRanked), '1000-skill ranking identical slow vs prebuilt');
    console.log(
      `  report: rankSkills on 1000 skills — slow ${slowMs.toFixed(1)} ms vs prebuilt ${fastMs.toFixed(1)} ms per call ` +
        `(delta ${(slowMs - fastMs).toFixed(1)} ms)`
    );
  } else {
    console.log('  report: fixture files absent — skipping the 1000-skill measurement (run tests/fixtures/large-index/build.mjs)');
  }
}

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);
if (failed > 0) process.exit(1);
