/**
 * Edge-case tests for the retrieval / routing public APIs.
 *
 * Fills the gaps listed in docs/reports/phase-6-test-audit.md section 4, which
 * found the happy path covered but empty, invalid and boundary inputs untested:
 *
 *   1. rankSkills      — empty prompt, null/undefined index, empty index,
 *                        whitespace prompt, non-string prompt, fractional field
 *                        weights (Phase 6.4 C1 regression at this call site).
 *   2. readSkillContent— happy path, missing file, missing path field, the
 *                        4000-char cap boundary, empty ranked list.
 *   3. detectDomains   — empty query, null index, empty index, index with no
 *                        domains, confidence bounded to [0, 1].
 *   4. planRoutes      — empty query, empty index, topK boundary (0 and 1),
 *                        unknown retrieval mode falls back to bm25.
 *   5. resolveCollisions — empty index, same-source collision, unknown source.
 */
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { rankSkills, readSkillContent, buildWeightedDocTokens } from '../../src/core/retriever/bm25.mjs';
import { detectDomains } from '../../src/core/routing/detector.mjs';
import { planRoutes } from '../../src/core/routing/planner.mjs';
import { resolveCollisions } from '../../src/index/dedupe.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log(`  \u2713 ${message}`); }
  else { failed++; console.error(`  \u2717 ${message}`); }
}

function skill(name, overrides = {}) {
  return {
    name,
    description: `Description for ${name}`,
    keywords: [name, 'keyword'],
    domains: ['backend'],
    path: `data/skills/${name}/SKILL.md`,
    version: '0.1.0',
    source: 'project',
    ...overrides,
  };
}

const index = JSON.parse(
  (await import('node:fs')).readFileSync(resolve(PROJECT_ROOT, 'data', 'skill-index.json'), 'utf-8')
);
const leafIndex = index.filter((s) => !s.name.startsWith('router-'));

console.log('\n=== Retrieval / routing edge cases ===\n');

// ─── 1. rankSkills: empty, invalid, boundary ──────────────────────────────────
console.log('1. rankSkills empty / invalid / boundary input');

assert(Array.isArray(rankSkills('', leafIndex)) && rankSkills('', leafIndex).length === 0,
  'empty prompt returns []');

assert(Array.isArray(rankSkills('   ', leafIndex)) && rankSkills('   ', leafIndex).length === 0,
  'whitespace-only prompt returns [] (no tokens)');

assert(rankSkills('!!! ???', leafIndex).length === 0,
  'punctuation-only prompt returns [] (tokenizes to nothing)');

// KNOWN GAP (not fixed here): rankSkills does not guard a null index the way
// detectDomains does, so it throws a TypeError instead of returning []. The
// hook never reaches this state (it filters the parsed index before calling
// rankSkills, and an uncaught throw there is caught by main().catch and fails
// open), so this test pins the real behaviour rather than a wished-for one.
let nullIndexError = null;
try {
  rankSkills('laravel', null);
} catch (err) {
  nullIndexError = err;
}
assert(nullIndexError instanceof TypeError,
  `null index throws TypeError (documented gap, not silently changed) — got ${nullIndexError?.name ?? 'no error'}`);

const withEmptyIndex = rankSkills('laravel', []);
assert(withEmptyIndex.length === 0, 'empty index returns []');

const unfiltered = rankSkills('laravel migration', leafIndex);
assert(unfiltered.length === leafIndex.length, 'every leaf entry is ranked, not just the top hit');
assert(unfiltered.every((r, i) => i === 0 || unfiltered[i - 1].score >= r.score),
  'results are sorted by descending score');
assert(unfiltered.every((r) => r.score >= 0 && r.score <= 1), 'scores are normalised into [0, 1]');
assert(unfiltered[0].score === 1, 'the top score is exactly 1 after normalisation');

// Single-document index: IDF of a term present in every document is 0, so no
// score should exceed 1 and the ranking must not lose the entry.
const single = rankSkills('laravel', [skill('backend-laravel')]);
assert(single.length === 1, 'single-entry index still returns the entry');
assert(single[0].score >= 0 && single[0].score <= 1, `single-entry score stays in [0, 1] (got ${single[0].score})`);

// Fractional field weights (Phase 6.4 C1) must not throw a RangeError here.
let fractionalThrew = null;
try {
  const tokens = buildWeightedDocTokens(skill('backend-laravel'), { nameWeight: 2.71, descriptionWeight: 2.71, keywordWeight: 0.57 });
  fractionalThrew = tokens.length;
} catch (err) {
  fractionalThrew = err.message;
}
assert(typeof fractionalThrew === 'number' && fractionalThrew > 0,
  `fractional field weights produce tokens without RangeError (got ${fractionalThrew})`);

// ─── 2. readSkillContent ─────────────────────────────────────────────────────
console.log('\n2. readSkillContent happy / invalid / boundary');

const tmp = mkdtempSync(join(tmpdir(), 'skill-router-edge-'));
const longSkill = join(tmp, 'long');
const missingSkill = join(tmp, 'missing');
const emptySkill = join(tmp, 'empty');
writeFileSync(join(tmp, 'long.md'), 'x'.repeat(5000));
writeFileSync(join(tmp, 'empty.md'), '');

const content = await readSkillContent([
  { skill: { name: 'long', path: join(tmp, 'long.md') }, score: 1 },
  { skill: { name: 'missing', path: join(tmp, 'nope.md') }, score: 0.5 },
  { skill: { name: 'empty', path: join(tmp, 'empty.md') }, score: 0.25 },
  { skill: { name: 'no-path' }, score: 0.1 },
]);

assert(content.length === 2, `unreadable entries are skipped, readable ones kept (got ${content.length}: ${content.map((c) => c.name).join(', ')})`);
assert(content[0].name === 'long' && content[0].content.length === 4000, `content is capped at 4000 chars (got ${content[0]?.content.length})`);
assert(content[1].name === 'empty' && content[1].content.length === 0, 'an empty SKILL.md yields an empty string, not an error');

const noArgs = await readSkillContent([]);
assert(Array.isArray(noArgs) && noArgs.length === 0, 'empty ranked list returns []');
rmSync(tmp, { recursive: true, force: true });

// ─── 3. detectDomains ────────────────────────────────────────────────────────
console.log('\n3. detectDomains empty / invalid / boundary input');

assert(detectDomains('', leafIndex).length === 0, 'empty query returns []');
assert(detectDomains(null, leafIndex).length === 0, 'null query returns []');
assert(detectDomains('anything', []).length === 0, 'empty index returns []');
assert(detectDomains('anything', null).length === 0, 'null index returns []');
assert(detectDomains('!!!', leafIndex).length === 0, 'punctuation-only query returns [] (no tokens)');
assert(detectDomains('laravel', [skill('a', { domains: [] })]).length === 0,
  'index whose skills declare no domains returns []');

const detected = detectDomains('laravel eloquent migration', leafIndex);
assert(detected.length > 0, `a real query detects at least one domain (got ${detected.length})`);
assert(detected.every((d) => d.confidence >= 0 && d.confidence <= 1),
  'every confidence is bounded to [0, 1]');
assert(detected.every((d, i) => i === 0 || detected[i - 1].confidence >= d.confidence),
  'results are sorted by descending confidence');
assert(typeof detected[0].matchedTokens === 'object' && Array.isArray(detected[0].matchedTokens),
  'matchedTokens is always an array');

// ─── 4. planRoutes ───────────────────────────────────────────────────────────
console.log('\n4. planRoutes empty / invalid / boundary input');

const emptyPlan = planRoutes('', leafIndex);
assert(emptyPlan.mode === 'fallback', `empty query falls back (got "${emptyPlan.mode}")`);
assert(emptyPlan.primary === null, 'fallback plan has a null primary domain');
assert(Array.isArray(emptyPlan.ranked), 'fallback plan still returns a ranked list');

const noIndexPlan = planRoutes('laravel', []);
assert(noIndexPlan.mode === 'fallback', 'empty index falls back');
assert(noIndexPlan.ranked.length === 0, 'empty index yields an empty ranking');

const topKZero = planRoutes('laravel eloquent migration', leafIndex, { mode: 'bm25', topK: 0 });
assert(topKZero.ranked.length === 0, 'topK=0 returns no ranked skills');

const topKOne = planRoutes('laravel eloquent migration', leafIndex, { mode: 'bm25', topK: 1 });
assert(topKOne.ranked.length <= 1, 'topK=1 returns at most one ranked skill');

const unknownMode = planRoutes('laravel eloquent migration', leafIndex, { mode: 'not-a-mode' });
assert(['single', 'multi', 'fallback'].includes(unknownMode.mode), `unknown mode still returns a valid plan (got "${unknownMode.mode}")`);
assert(unknownMode.ranked.length > 0, 'unknown mode still ranks skills');

// ─── 5. resolveCollisions ────────────────────────────────────────────────────
console.log('\n5. resolveCollisions empty / same-source / unknown source');

assert(resolveCollisions([]).length === 0, 'empty index returns []');
assert(resolveCollisions([skill('a'), skill('b')]).length === 2, 'distinct names are all kept');

const sameSource = resolveCollisions([
  skill('dup', { source: 'project', path: 'first/SKILL.md' }),
  skill('dup', { source: 'project', path: 'second/SKILL.md' }),
]);
assert(sameSource.length === 1, 'a same-source collision collapses to one entry');
assert(sameSource[0].path === 'first/SKILL.md', 'on equal priority the FIRST entry is kept');

const unknownSource = resolveCollisions([
  skill('dup', { source: 'mystery', path: 'first/SKILL.md' }),
  skill('dup', { source: 'mystery', path: 'second/SKILL.md' }),
]);
assert(unknownSource.length === 1, 'an unknown source value still deduplicates');

const projectBeatsUnknown = resolveCollisions([
  skill('dup', { source: 'mystery', path: 'first/SKILL.md' }),
  skill('dup', { source: 'project', path: 'second/SKILL.md' }),
]);
assert(projectBeatsUnknown[0].source === 'project', 'a known project source outranks an unknown one');

console.log(`\n  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
if (failed > 0) process.exit(1);
