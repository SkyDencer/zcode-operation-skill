/**
 * Scale benchmark tests for the Skill Router.
 *
 * Tests:
 *  1. Generator determinism — run twice with same seed, compare all SKILL.md hashes
 *  2. Each scale (100, 200, 300, 500) runs without error
 *  3. All generated skills are unique (no duplicate names)
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';
import { rankSkills } from '../../src/index.mjs';

const BASE = resolve('.');
const GENERATOR_PATH = resolve(BASE, 'tests/scale/generate-synthetic.mjs');
const SEED = 42;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

// ── Helper: collect all SKILL.md content hashes from a directory ──────────────
function collectSkillHashes(dir) {
  const hashes = new Map();
  function walk(d) {
    const entries = readdirSync(d, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'SKILL.md') {
        const content = readFileSync(full, 'utf-8');
        const nameMatch = content.match(/^name:\s*(\S+)/m);
        const name = nameMatch ? nameMatch[1] : 'unknown';
        hashes.set(name, content);
      }
    }
  }
  walk(dir);
  return hashes;
}

// ── Helper: load skills from directory ───────────────────────────────────────
function loadSkills(dir) {
  const skills = [];
  function walk(d) {
    const entries = readdirSync(d, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'SKILL.md') {
        const content = readFileSync(full, 'utf-8');
        const fmMatch = content.match(/^---\s*\n([\s\S]+?)\n---/m);
        if (fmMatch) {
          const body = fmMatch[1];
          const nameMatch = body.match(/^name:\s*(\S+)/m);
          const descMatch = body.match(/^description:\s*(.+)$/m);
          const kwLines = body.match(/^\s*-\s+(.+)$/gm) || [];
          const keywords = kwLines.map((l) => l.replace(/^\s*-\s+/, '').trim());
          skills.push({
            name: nameMatch ? nameMatch[1] : 'unknown',
            description: descMatch ? descMatch[1].trim() : '',
            keywords,
            domains: [],
            path: full,
            version: '0.1.0',
          });
        }
      }
    }
  }
  walk(dir);
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

// ── Test 1: Determinism ──────────────────────────────────────────────────────
console.log('');
console.log('Test 1: Generator determinism');
console.log('-'.repeat(60));

const tmpDir1 = resolve(BASE, 'data/skills-synthetic-test1');
const tmpDir2 = resolve(BASE, 'data/skills-synthetic-test2');

// Run 1
try { rmSync(tmpDir1, { recursive: true, force: true }); } catch {}
execSync(`node "${GENERATOR_PATH}" 100 --seed ${SEED} --out "${tmpDir1}"`, { cwd: BASE, stdio: 'pipe' });
const hashes1 = collectSkillHashes(tmpDir1);

// Run 2
try { rmSync(tmpDir2, { recursive: true, force: true }); } catch {}
execSync(`node "${GENERATOR_PATH}" 100 --seed ${SEED} --out "${tmpDir2}"`, { cwd: BASE, stdio: 'pipe' });
const hashes2 = collectSkillHashes(tmpDir2);

assert(hashes1.size === hashes2.size, `Same skill count: ${hashes1.size} === ${hashes2.size}`);

const nameSets1 = new Set([...hashes1.keys()]);
const nameSets2 = new Set([...hashes2.keys()]);
assert(
  nameSets1.size === nameSets2.size && [...nameSets1].every((n) => nameSets2.has(n)),
  'Same skill names in both runs'
);

// Compare content hashes for each name
let contentMatch = true;
for (const [name, content] of hashes1) {
  if (hashes2.get(name) !== content) {
    contentMatch = false;
    break;
  }
}
assert(contentMatch, 'All SKILL.md contents are identical across runs');

// Cleanup
try { rmSync(tmpDir1, { recursive: true, force: true }); } catch {}
try { rmSync(tmpDir2, { recursive: true, force: true }); } catch {}

console.log('');
console.log('Test 1 result: ' + (failed === 0 ? 'PASSED' : 'FAILED'));

// ── Test 2: Each scale runs without error and produces correct count ─────────
console.log('');
console.log('Test 2: Scale generation correctness');
console.log('-'.repeat(60));

const scales = [100, 200, 300, 500];

for (const scale of scales) {
  console.log(`\n  Scale: ${scale}`);
  const tmpDir = resolve(BASE, `data/skills-synthetic-scale-${scale}`);
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  const start = performance.now();
  execSync(`node "${GENERATOR_PATH}" ${scale} --seed ${SEED} --out "${tmpDir}"`, { cwd: BASE, stdio: 'pipe' });
  const elapsed = Math.round(performance.now() - start);

  const skills = loadSkills(tmpDir);
  const nameSet = new Set(skills.map((s) => s.name));

  assert(skills.length === scale, `Generated ${scale} skills (got ${skills.length})`);
  assert(nameSet.size === skills.length, `All names unique (${nameSet.size} unique of ${skills.length})`);

  // Verify BM25 retrieval works
  try {
    const prompt = 'How do I write unit tests?';
    const results = rankSkills(prompt, skills);
    assert(results.length > 0, `BM25 ranking returns results for ${scale} skills`);
    assert(results[0].skill.name.length > 0, 'Top result has a valid name');
  } catch (err) {
    assert(false, `BM25 ranking threw: ${err.message}`);
  }

  console.log(`    Completed in ${elapsed} ms`);

  // Cleanup
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

console.log('');
console.log('Test 2 result: ' + (failed === 0 ? 'PASSED' : 'FAILED'));

// ── Test 3: Quality distribution ─────────────────────────────────────────────
console.log('');
console.log('Test 3: Quality mix validation');
console.log('-'.repeat(60));

const tmpDir = resolve(BASE, 'data/skills-synthetic-quality');
try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
execSync(`node "${GENERATOR_PATH}" 100 --seed ${SEED} --out "${tmpDir}"`, { cwd: BASE, stdio: 'pipe' });
const skills100 = loadSkills(tmpDir);
try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}

let goodCount = 0;
let medCount = 0;
let weakCount = 0;
for (const skill of skills100) {
  const kwCount = skill.keywords.length;
  if (kwCount >= 4) goodCount++;
  else if (kwCount >= 2) medCount++;
  else weakCount++;
}

console.log(`  Good (4+ keywords):   ${goodCount}/100 (${goodCount}%)`);
console.log(`  Mediocre (2-3 kws):   ${medCount}/100 (${medCount}%)`);
console.log(`  Weak (1 keyword):     ${weakCount}/100 (${weakCount}%)`);

assert(goodCount >= 50 && goodCount <= 85, `Good quality ~70%: got ${goodCount}% (expected 50-85%)`);
assert(medCount >= 5 && medCount <= 45, `Mediocre quality ~20%: got ${medCount}% (expected 5-45%)`);

// ── Final summary ─────────────────────────────────────────────────────────────
console.log('');
console.log('='.repeat(60));
console.log(`Tests passed: ${passed}`);
console.log(`Tests failed: ${failed}`);
console.log(`Total:        ${passed + failed}`);
console.log('='.repeat(60));

process.exit(failed > 0 ? 1 : 0);
