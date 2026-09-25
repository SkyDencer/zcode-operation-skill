/**
 * CLI reindex command tests.
 *
 * Regression coverage for the Sub-Phase 6.4-repair-1 failure:
 * `node bin/skill-router.mjs reindex` used to default to `data/skills` only,
 * so it rewrote `data/skill-index.json` with 54 leaf entries and dropped the
 * 6 `router-*` dispatchers. `hooks/build-index.mjs` always included
 * `router-skills/`, so the generated index depended on which builder ran last.
 * `tests/tuning/optimizer.test.mjs` then failed its corpus assertions
 * ("full index has 60 entries ... got 54", "leaf-only top1 0.9077 >
 * full-index top1 0.9077").
 *
 * Tests:
 *   1. default reindex includes router-* entries (54 leaf + 6 router = 60)
 *   2. `reindex --sources project` includes router-* entries
 *   3. `reindex --sources all` includes router-* entries
 *   4. reindexed index matches the build-index corpus (same skill names)
 *   5. router entries are tagged source: "project" and carry a valid path
 *
 * The generated artifacts (data/skill-index.json, data/skill-embeddings.json)
 * are backed up and restored in `finally`, so the test is non-destructive.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const CLI = resolve(ROOT, 'bin', 'skill-router.mjs');
const INDEX_PATH = resolve(ROOT, 'data', 'skill-index.json');
const EMBEDDINGS_PATH = resolve(ROOT, 'data', 'skill-embeddings.json');

const ROUTER_COUNT = 6;
const LEAF_COUNT = 54;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertContains(output, substring, message) {
  assert(output.includes(substring), `${message} (output: ${output.slice(0, 300).replace(/\n/g, ' | ')})`);
}

function readIndex() {
  return JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
}

function routers(idx) {
  return idx.filter((s) => s.name.startsWith('router-'));
}

function runReindex(extraArgs = []) {
  return execSync(`node "${CLI}" reindex ${extraArgs.join(' ')}`.trim(), {
    encoding: 'utf-8',
    cwd: ROOT,
    stdio: 'pipe',
  });
}

const backups = new Map();
for (const p of [INDEX_PATH, EMBEDDINGS_PATH]) {
  backups.set(p, existsSync(p) ? readFileSync(p, 'utf-8') : null);
}

/** Run a block with the generated artifacts restored afterwards. */
function withRestoredArtifacts(fn) {
  try {
    fn();
  } finally {
    for (const [p, content] of backups) {
      if (content === null) continue;
      writeFileSync(p, content, 'utf-8');
    }
  }
}

// ── 1-3. reindex corpus under each source selection ───────────────────────────

console.log('\n=== 1. Default Reindex Includes Router Skills ===');

withRestoredArtifacts(() => {
  try {
    const output = runReindex();
    assertContains(output, 'Indexed', 'reindex reports the indexed count');

    const idx = readIndex();
    assert(Array.isArray(idx), 'index is a JSON array');
    assert(idx.length === LEAF_COUNT + ROUTER_COUNT, `index has ${LEAF_COUNT + ROUTER_COUNT} entries (${LEAF_COUNT} leaf + ${ROUTER_COUNT} router), got ${idx.length}`);
    assert(routers(idx).length === ROUTER_COUNT, `index has ${ROUTER_COUNT} router-* entries, got ${routers(idx).length}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ default reindex failed: ${err.message}`);
  }
});

console.log('\n=== 2. Reindex --sources project Includes Router Skills ===');

withRestoredArtifacts(() => {
  try {
    runReindex(['--sources', 'project']);
    const idx = readIndex();
    assert(idx.length === LEAF_COUNT + ROUTER_COUNT, `--sources project yields ${LEAF_COUNT + ROUTER_COUNT} entries, got ${idx.length}`);
    assert(routers(idx).length === ROUTER_COUNT, `--sources project yields ${ROUTER_COUNT} router-* entries, got ${routers(idx).length}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ reindex --sources project failed: ${err.message}`);
  }
});

console.log('\n=== 3. Reindex --sources all Includes Router Skills ===');

withRestoredArtifacts(() => {
  try {
    runReindex(['--sources', 'all']);
    const idx = readIndex();
    assert(idx.length >= LEAF_COUNT + ROUTER_COUNT, `--sources all yields at least ${LEAF_COUNT + ROUTER_COUNT} entries, got ${idx.length}`);
    assert(routers(idx).length === ROUTER_COUNT, `--sources all yields ${ROUTER_COUNT} router-* entries, got ${routers(idx).length}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ reindex --sources all failed: ${err.message}`);
  }
});

// ── 4-5. reindex agrees with build-index, and router entries are well-formed ──

console.log('\n=== 4. Reindex And Build-Index Produce The Same Corpus ===');

withRestoredArtifacts(() => {
  try {
    runReindex();
    const reindexNames = readIndex().map((s) => s.name).sort();
    execSync('node hooks/build-index.mjs', { encoding: 'utf-8', cwd: ROOT, stdio: 'pipe' });
    const buildNames = readIndex().map((s) => s.name).sort();
    assert(
      JSON.stringify(reindexNames) === JSON.stringify(buildNames),
      `reindex corpus (${reindexNames.length} names) matches build-index corpus (${buildNames.length} names)`
    );
  } catch (err) {
    failed++;
    console.error(`  ✗ build-index comparison failed: ${err.message}`);
  }
});

console.log('\n=== 5. Router Entries Are Well-Formed ===');

withRestoredArtifacts(() => {
  try {
    runReindex();
    const idx = readIndex();
    const routerEntries = routers(idx);
    assert(
      routerEntries.every((s) => s.source === 'project'),
      'every router-* entry is tagged source: "project"'
    );
    assert(
      routerEntries.every((s) => typeof s.path === 'string' && /router-skills/.test(s.path)),
      'every router-* entry path points into router-skills/'
    );
    assert(
      routerEntries.every((s) => typeof s.description === 'string' && s.description.length > 0),
      'every router-* entry has a non-empty description'
    );
  } catch (err) {
    failed++;
    console.error(`  ✗ router entry validation failed: ${err.message}`);
  }
});

// ── Summary ────────────────────────────────────────────────────────────────────

console.log('\n=== Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
