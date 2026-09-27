/**
 * Build the 1000-skill test fixture used by tests/hooks/perf.test.mjs.
 *
 * Two artefacts, one committable and one regenerable:
 *
 *   1. data/skills-synthetic-1000/  — a 1000-skill SKILL.md corpus produced by
 *      the seeded scale-corpus generator (tests/scale/generate-synthetic.mjs,
 *      seed 42, count 1000). The corpus lives under the gitignored
 *      data/skills-synthetic-* pattern (see .gitignore), so it is a build
 *      prerequisite, not a committed fixture.
 *   2. tests/fixtures/large-index/skill-index-1000.json — the 1000-entry
 *      skill index the hook is measured against. This file is committed: it
 *      is plain JSON, machine-independent (paths are repo-root-relative), and
 *      the perf test loads it without rebuilding anything per run.
 *
 * Because the generator unconditionally refreshes the canonical prompt files
 * under tests/scale/ (generate-synthetic.mjs), this script snapshots and
 * restores those two files around the generator run so a fixture build never
 * churns tracked test data.
 *
 * Usage:
 *   node tests/fixtures/large-index/build.mjs [--force]
 *
 * --force regenerates the corpus even when it already holds 1000 skills.
 * Without the flag, the corpus is generated only when it is missing or
 * short of 1000 SKILL.md files, and the index JSON is rewritten every run
 * (it is cheap and deterministic).
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrebuiltIndex } from '../../../src/core/retriever/prebuilt.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const CORPUS_DIR = join(ROOT, 'data', 'skills-synthetic-1000');
const FIXTURE_PATH = join(HERE, 'skill-index-1000.json');
const PREBUILT_PATH = join(HERE, 'skill-index-1000.prebuilt.json');
const GENERATOR = join(ROOT, 'tests', 'scale', 'generate-synthetic.mjs');
// Canonical files the generator overwrites (generate-synthetic.mjs:598-601)
// and that other suites read. Snapshot + restore around the generator run.
const CANONICAL_FILES = [
  join(ROOT, 'tests', 'scale', 'synthetic-prompts.json'),
  join(ROOT, 'tests', 'scale', 'synthetic-expected.json'),
];

/**
 * Recursively count SKILL.md files under a directory.
 *
 * @param {string} dir
 * @returns {number}
 */
function countSkillFiles(dir) {
  if (!existsSync(dir)) return 0;
  let count = 0;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'SKILL.md') count++;
    }
  };
  walk(dir);
  return count;
}

/**
 * Parse the frontmatter of one SKILL.md the same way the project loader does
 * (src/loader.mjs), so the fixture entries match the shape build-index.mjs
 * emits for real corpora.
 *
 * @param {string} filePath
 * @returns {{name:string, description:string, keywords:string[], domains:string[], version:string}}
 */
function parseSkillFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const match = content.match(/^---\s*\n([\s\S]+?)\n---\s*\n?/);
  const result = {};
  if (!match) return null;
  let currentKey = null;
  let currentList = [];
  for (const line of match[1].replace(/\r/g, '').split('\n')) {
    const listMatch = line.match(/^\s*-\s+(.+)$/);
    if (listMatch && currentKey) {
      currentList.push(listMatch[1].trim());
      continue;
    }
    if (currentKey && currentList.length > 0) {
      result[currentKey] = currentList;
      currentList = [];
    }
    const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const value = kvMatch[2].trim();
      if (value === '') {
        currentKey = key;
        currentList = [];
      } else {
        result[key] = value;
        currentKey = null;
      }
    }
  }
  if (currentKey && currentList.length > 0) result[currentKey] = currentList;
  if (!result.name) return null;
  return {
    name: result.name,
    description: result.description || '',
    keywords: Array.isArray(result.keywords) ? result.keywords : [],
    domains: Array.isArray(result.domains) ? result.domains : [],
    version: result.version || '0.1.0',
  };
}

/**
 * Run the seeded generator to (re)create the 1000-skill corpus.
 *
 * @returns {number} number of SKILL.md files on disk afterwards
 */
function generateCorpus() {
  console.log(`Generating 1000-skill corpus at ${CORPUS_DIR} (seed 42, count 1000)`);
  const snapshots = CANONICAL_FILES.map((file) =>
    existsSync(file) ? readFileSync(file, 'utf-8') : null
  );
  let generator;
  try {
    generator = execFileSync(
      process.execPath,
      [GENERATOR, '1000', '--seed', '42', '--out', CORPUS_DIR],
      { encoding: 'utf8', cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }
    );
  } finally {
    // Always restore, even on a failed generation: the generator may have
    // rewritten the canonical files before dying.
    CANONICAL_FILES.forEach((file, i) => {
      if (snapshots[i] === null) return;
      if (existsSync(file)) writeFileSync(file, snapshots[i], 'utf-8');
      else if (existsSync(dirname(file))) {
        // Generator deleted the file: restore it from the snapshot.
        writeFileSync(file, snapshots[i], 'utf-8');
      }
    });
  }
  if (generator) console.log(generator.trim());
  return countSkillFiles(CORPUS_DIR);
}

/**
 * Build the 1000-entry index JSON from the corpus on disk.
 *
 * Entries carry repo-root-relative paths so the fixture is committable and
 * machine-independent: the hook resolves `path` against its working
 * directory, which the perf test fixes to the project root.
 *
 * Also writes the matching parsed-index cache
 * (tests/fixtures/large-index/skill-index-1000.prebuilt.json) via
 * buildPrebuiltIndex(), so the perf test can exercise the hook's prebuilt
 * fast path exactly like production (builder writes both files, the hook
 * loads both).
 *
 * @returns {{index:object[], entries:number}}
 */
function buildIndex() {
  const entries = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === 'SKILL.md') {
        const parsed = parseSkillFile(full);
        if (!parsed) {
          throw new Error(`fixture build: ${full} has no valid frontmatter name`);
        }
        entries.push({
          ...parsed,
          path: relative(ROOT, full).split('\\').join('/'),
        });
      }
    }
  };
  walk(CORPUS_DIR);
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const names = new Set(entries.map((e) => e.name));
  if (entries.length !== 1000) {
    throw new Error(`fixture build: expected 1000 entries, found ${entries.length}`);
  }
  if (names.size !== 1000) {
    throw new Error(
      `fixture build: duplicate names detected (${1000 - names.size} duplicates)`
    );
  }
  mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
  writeFileSync(FIXTURE_PATH, JSON.stringify(entries), 'utf-8');
  // The parsed-index cache the hook loads next to the index (Sub-Phase 7.6).
  const prebuilt = buildPrebuiltIndex(entries);
  writeFileSync(PREBUILT_PATH, JSON.stringify(prebuilt), 'utf-8');
  return { index: entries, entries: entries.length };
}

/**
 * Main build: ensure the corpus, then write the fixture index.
 *
 * @param {boolean} [force] — regenerate the corpus even when it is complete
 */
export function buildLargeIndex(force = false) {
  let corpusCount = countSkillFiles(CORPUS_DIR);
  if (force || corpusCount < 1000) {
    corpusCount = generateCorpus();
  }
  if (corpusCount !== 1000) {
    throw new Error(
      `fixture build: corpus holds ${corpusCount} SKILL.md files, expected 1000`
    );
  }
  const { index, entries } = buildIndex();
  console.log(
    `Wrote ${entries}-entry fixture index at ${relative(ROOT, FIXTURE_PATH)} ` +
      `(+ parsed-index cache at ${relative(ROOT, PREBUILT_PATH)})`
  );
  return index;
}

// Windows-safe CLI gate: resolve() on both sides (the import.meta.url string
// compare used by some other scripts is false on Windows and silently no-ops).
const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    buildLargeIndex(process.argv.includes('--force'));
  } catch (err) {
    console.error(`[large-index build] ${err.message}`);
    process.exit(1);
  }
}
