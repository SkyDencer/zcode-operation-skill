/**
 * Hierarchical routing tests.
 *
 * Verifies:
 *  1. routeHierarchical returns a valid HierarchicalPlan shape
 *  2. Top-3 candidate domains are detected correctly
 *  3. BM25 runs within candidate domains only
 *  4. Merge & rerank produces a ranked list
 *  5. Primary domain is the highest-confidence domain
 *  6. Latency overhead vs flat BM25 is bounded
 *  7. Top-1 accuracy on real corpus (hierarchical trades some recall for speed)
 *  8. Domain registry read/create works correctly
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { routeHierarchical } from '../src/core/routing/hierarchical.mjs';
import { rankSkills } from '../src/core/retriever/bm25.mjs';
import {
  readDomainMeta,
  readAllDomainMeta,
  createDomainMeta,
  populateDomainsFromSkills,
  matchDomainsToQuery,
} from '../src/core/routing/domain-registry.mjs';
import { tokenize } from '../src/utils/text.mjs';

const BASE = resolve('.');
const INDEX_PATH = resolve(BASE, 'data/skill-index.json');
const PROMPTS_PATH = resolve(BASE, 'tests/prompts.json');
const EXPECTED_PATH = resolve(BASE, 'tests/expected-routes.json');
// Domain registry uses data/domains/ — we use this directly in tests.
const DOMAINS_DIR = resolve(BASE, 'data/domains');

const index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
const prompts = JSON.parse(readFileSync(PROMPTS_PATH, 'utf-8'));
const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf-8'));

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

console.log('\n=== Hierarchical Routing Tests ===\n');

// ── 1. Plan shape ─────────────────────────────────────────────────────────────
console.log('1. routeHierarchical returns HierarchicalPlan shape');
const plan = routeHierarchical('Build a Laravel API with React frontend', index);
assert(plan.mode === 'hierarchical', `mode is "hierarchical": ${plan.mode}`);
assert(Array.isArray(plan.domains), 'domains is an array');
assert(Array.isArray(plan.skills), 'skills is an array');
assert(plan.primaryDomain === null || typeof plan.primaryDomain === 'string', 'primaryDomain is null or string');
assert(typeof plan.candidateDomainCount === 'number', 'candidateDomainCount is a number');
assert(typeof plan.totalSkillsScored === 'number', 'totalSkillsScored is a number');
assert(plan.skills.every((s) => 'skill' in s && 'score' in s), 'each skill has skill and score');

// ── 2. Top-3 candidate domains detected ──────────────────────────────────────
console.log('\n2. Top-3 candidate domains detected');
// Use a query that triggers strong domain signals (not a fallback case)
const plan2 = routeHierarchical('optimize eager loading Laravel N+1 queries', index);
assert(plan2.domains.length > 0 || plan2.skills.length > 0, 'detects domains or falls back to flat');
if (plan2.domains.length > 0) {
  assert(plan2.domains.length <= 3, `max 3 domains: got ${plan2.domains.length}`);
  for (const d of plan2.domains) {
    assert(typeof d.name === 'string' && d.name.length > 0, `domain has name: ${d.name}`);
    assert(typeof d.confidence === 'number' && d.confidence >= 0, `confidence >= 0: ${d.confidence}`);
  }
  // Check that detected domains overlap with actual skill domains
  const actualDomains = new Set();
  index.forEach((s) => (s.domains || []).forEach((d) => actualDomains.add(d)));
  const detectedDomains = plan2.domains.map((d) => d.name);
  const overlap = detectedDomains.filter((d) => actualDomains.has(d)).length;
  assert(overlap === detectedDomains.length, `all detected domains exist in index: ${overlap}/${detectedDomains.length}`);
} else {
  // Fallback case: no domains, but skills should still be returned
  assert(plan2.skills.length > 0, 'fallback returns skills from flat BM25');
}

// ── 3. Skills are from detected domains (or fallback returns all skills) ─────
console.log('\n3. Retrieved skills are valid');
const plan3 = routeHierarchical('optimize eager loading Laravel N+1 queries', index);
if (plan3.domains.length > 0) {
  // Hierarchical mode: skills should come from detected domains
  const detectedDomains3 = plan3.domains.map((d) => d.name);
  for (const skillEntry of plan3.skills) {
    const skillDomains = skillEntry.skill.domains || [];
    const inCandidate = skillDomains.some((d) => detectedDomains3.includes(d));
    assert(inCandidate, `skill "${skillEntry.skill.name}" is in a candidate domain`);
  }
} else {
  // Fallback mode: all skills are valid
  assert(plan3.skills.length > 0, 'fallback returns non-empty results');
}

// ── 4. Primary domain is highest-confidence ───────────────────────────────────
console.log('\n4. Primary domain is highest-confidence domain');
let primaryCorrect = 0;
let totalPlans = 0;
for (let i = 0; i < Math.min(30, prompts.length); i++) {
  const p = prompts[i];
  const pl = routeHierarchical(p.prompt, index);
  if (pl.domains.length === 0) continue;
  totalPlans++;
  if (pl.domains[0]?.name === pl.primaryDomain) primaryCorrect++;
}
assert(primaryCorrect === totalPlans, `primary matches top domain in all plans: ${primaryCorrect}/${totalPlans}`);

// ── 5. Latency: hierarchical vs flat ──────────────────────────────────────────
console.log('\n5. Latency: hierarchical vs flat BM25');
const latencies = [];
for (let i = 0; i < 10; i++) {
  const p = prompts[i % prompts.length];

  const startFlat = performance.now();
  rankSkills(p.prompt, index);
  const flatLat = performance.now() - startFlat;

  const startHier = performance.now();
  routeHierarchical(p.prompt, index);
  const hierLat = performance.now() - startHier;

  latencies.push({ flat: flatLat, hier: hierLat, ratio: hierLat / Math.max(flatLat, 0.01) });
}

const avgFlat = latencies.reduce((s, l) => s + l.flat, 0) / latencies.length;
const avgHier = latencies.reduce((s, l) => s + l.hier, 0) / latencies.length;
const avgRatio = latencies.reduce((s, l) => s + l.ratio, 0) / latencies.length;

console.log(`    Flat avg:      ${avgFlat.toFixed(2)} ms`);
console.log(`    Hierarchical:  ${avgHier.toFixed(2)} ms`);
console.log(`    Ratio:         ${avgRatio.toFixed(2)}x`);
// Hierarchical should not be more than 5x slower on small corpus (overhead is acceptable)
assert(avgRatio < 5, `hierarchical overhead < 5x flat (${avgRatio.toFixed(2)}x)`);

// ── 6. Top-1 accuracy vs flat BM25 ───────────────────────────────────────────
console.log('\n6. Top-1 accuracy comparison: hierarchical vs flat BM25');
let flatHits = 0;
let hierHits = 0;
let hierMissesWhereFlatHits = 0;

for (const p of prompts) {
  const exp = expected.find((e) => e.id === p.id);
  const expName = exp?.expected === null ? null : String(exp?.expected);

  // Flat BM25
  const flatRanked = rankSkills(p.prompt, index);
  const flatTop = flatRanked.length > 0 ? flatRanked[0].skill.name : null;

  // Hierarchical
  const hierPlan = routeHierarchical(p.prompt, index);
  const hierTop = hierPlan.skills.length > 0 ? hierPlan.skills[0].skill.name : null;

  if (flatTop === expName) flatHits++;
  if (hierTop === expName) hierHits++;
  if (flatTop === expName && hierTop !== expName) hierMissesWhereFlatHits++;
}

const flatAccuracy = (flatHits / prompts.length).toFixed(4);
const hierAccuracy = (hierHits / prompts.length).toFixed(4);
console.log(`    Flat BM25:         ${flatAccuracy} (${flatHits}/${prompts.length})`);
console.log(`    Hierarchical:      ${hierAccuracy} (${hierHits}/${prompts.length})`);
console.log(`    Hier misses flat:  ${hierMissesWhereFlatHits}`);

// Hierarchical routing now achieves ~87% Top-1 on the real corpus (threshold-based
// fallback ensures weak signals don't degrade accuracy). Assert ≥ 75% as a safe margin.
assert(hierAccuracy >= 0.75, `hierarchical accuracy ≥ 75% (${hierAccuracy})`);

// ── 7. Domain registry: read/create ───────────────────────────────────────────
console.log('\n7. Domain registry read/create');
try {
  rmSync(join(DOMAINS_DIR, 'test-domain'), { recursive: true, force: true });
} catch {}

const meta = createDomainMeta('test-domain', 'A test domain for unit testing.', ['test', 'unit', 'fixture']);
assert(meta.name === 'test-domain', 'created domain has correct name');
assert(meta.description.includes('test'), 'created domain has description');
assert(meta.keywords.includes('test'), 'created domain has keywords');

const readBack = readDomainMeta('test-domain');
assert(readBack !== null, 'readDomainMeta returns non-null for existing domain');
assert(readBack.name === 'test-domain', 'read back matches created name');

const allMetas = readAllDomainMeta();
assert(allMetas.length > 0, `readAllDomainMeta finds at least 1 domain: ${allMetas.length}`);

// Cleanup test domain
try { rmSync(join(DOMAINS_DIR, 'test-domain'), { recursive: true, force: true }); } catch {}

// ── 8. populateDomainsFromSkills ──────────────────────────────────────────────
console.log('\n8. populateDomainsFromSkills auto-generates meta');
const beforeCount = readAllDomainMeta().length;
populateDomainsFromSkills(index);
const afterCount = readAllDomainMeta().length;
assert(afterCount >= beforeCount, `populateDomainsFromSkills did not reduce domain count (${afterCount} >= ${beforeCount})`);
const populated = readAllDomainMeta();
const hasBackend = populated.some((d) => d.name === 'backend');
assert(hasBackend, 'backend domain metadata exists after population');
const hasDesign = populated.some((d) => d.name === 'design');
assert(hasDesign, 'design domain metadata exists after population');

// ── 9. matchDomainsToQuery ────────────────────────────────────────────────────
console.log('\n9. matchDomainsToQuery scoring');
const testDomains = [
  { name: 'backend', description: 'Server-side programming and database work', keywords: ['api', 'database', 'laravel', 'backend'] },
  { name: 'frontend', description: 'Client-side UI development with React and CSS', keywords: ['react', 'css', 'frontend', 'ui'] },
];
const tokens = tokenize('Laravel API design patterns');
const scored = matchDomainsToQuery(tokens, testDomains);
assert(scored.has('backend'), 'backend domain is in results');
assert(scored.has('frontend'), 'frontend domain is in results');
const backendScore = scored.get('backend').totalScore;
const frontendScore = scored.get('frontend').totalScore;
assert(backendScore > 0, `backend score > 0: ${backendScore}`);
// Backend should score higher for a Laravel query
assert(backendScore >= frontendScore, `backend scores ≥ frontend for Laravel query (${backendScore} vs ${frontendScore})`);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
