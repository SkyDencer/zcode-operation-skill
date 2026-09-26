/**
 * Corpus importer tests (Sub-Phase 7.2).
 *
 * The property that matters for a 200-skill import is re-runnability: a second
 * import of the same source must not damage the tree that is already there.
 * This file pins that behaviour in both directions --
 *
 *   1. without --force an existing skill is SKIPPED, byte for byte
 *   2. with --force it is OVERWRITTEN
 *   3. invalid skills are REJECTED and nothing is written for them
 *   4. a JSON report is written to logs/corpus-import-<date>.json
 *   5. an unsafe skill name cannot escape the target directory
 *
 * Under test: src/corpus/importer.mjs
 */
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { importSkills, dateStamp, resolveTargetDir, DEFAULT_TARGET_DIR } from '../../src/corpus/importer.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, 'fixtures');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  + ${message}`);
  } else {
    failed++;
    console.error(`  x ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

const tmp = mkdtempSync(join(tmpdir(), 'corpus-importer-'));
const DATE = '2026-01-02';

try {
  // ── Section 1: first import ────────────────────────────────────────────────

  console.log('\n=== Section 1: first import ===');

  const target = join(tmp, 'skills');
  const reportDir = join(tmp, 'reports');
  const source = { type: 'local', path: FIXTURES };

  const first = await importSkills([source], target, { reportDir, date: DATE });
  assertEqual(first.total, 8, 'the report counts all 8 fixture skills');
  assertEqual(first.imported, 5, '5 valid skills are imported');
  assertEqual(first.rejected, 3, '3 invalid skills are rejected');
  assertEqual(first.skipped, 0, 'nothing is skipped on a first import into an empty tree');
  assertEqual(first.overwritten, 0, 'nothing is overwritten on a first import');
  assertEqual(first.targetDir, resolve(target), 'the report records the resolved target directory');
  assertEqual(first.force, false, 'the report records that force was off');

  const cachePriming = join(target, 'backend', 'cache-priming', 'SKILL.md');
  assert(existsSync(cachePriming), 'backend-cache-priming lands in <target>/backend/cache-priming/SKILL.md');
  const routerPython = join(target, 'router', 'python', 'SKILL.md');
  assert(existsSync(routerPython), 'router-python lands in <target>/router/python/SKILL.md (name split on the first hyphen)');
  assert(
    !existsSync(join(target, 'broken')),
    'no directory is created for a rejected skill',
  );
  assert(
    readFileSync(cachePriming, 'utf-8') ===
      readFileSync(join(FIXTURES, 'backend', 'cache-priming', 'SKILL.md'), 'utf-8'),
    'the imported SKILL.md is byte-identical to the source',
  );

  // Rejected entries carry the reason, not just a status.
  const rejectedItem = first.items.find((i) => i.status === 'rejected');
  assertEqual(rejectedItem?.sourcePath.includes('broken'), true, 'a rejected item names its source path');
  assert((rejectedItem?.issues?.length ?? 0) > 0, 'a rejected item carries the validation issues');

  // The report file.
  const reportPath = join(reportDir, `corpus-import-${DATE}.json`);
  assert(existsSync(reportPath), 'a report is written to <reportDir>/corpus-import-<date>.json');
  const written = JSON.parse(readFileSync(reportPath, 'utf-8'));
  assertEqual(written.imported, 5, 'the written report agrees with the returned report');
  assertEqual(written.rejected, 3, 'the written report records the rejected count');
  assertEqual(written.date, DATE, 'the written report carries the date stamp');
  assert(Array.isArray(written.items) && written.items.length === 8, 'the written report lists every item');
  assert(Array.isArray(written.warnings), 'the written report carries a warnings array');

  // ── Section 2: second import refuses to overwrite ──────────────────────────

  console.log('\n=== Section 2: re-import without force ===');

  // A local edit stands in for a curated skill the operator has already fixed.
  const edited = '---\nname: backend-cache-priming\ndescription: Locally edited description that must survive a re-import without --force because the operator changed it on purpose and the corpus tool must never clobber that silently\n---\n\nlocal edit\n';
  writeFileSync(cachePriming, edited, 'utf-8');

  const second = await importSkills([source], target, { reportDir, date: DATE });
  assertEqual(second.total, 8, 'the second import still sees all 8 source skills');
  assertEqual(second.imported, 0, 'a second import imports nothing new');
  assertEqual(second.skipped, 5, 'all 5 already-present skills are skipped');
  assertEqual(second.rejected, 3, 'the 3 invalid skills are still rejected');
  assertEqual(second.overwritten, 0, 'nothing is overwritten without force');
  assert(
    readFileSync(cachePriming, 'utf-8') === edited,
    'the existing SKILL.md is untouched when --force is not given',
  );
  assertEqual(
    second.items.filter((i) => i.status === 'skipped').every((i) => typeof i.targetPath === 'string'),
    true,
    'a skipped item records where the existing skill lives',
  );

  // ── Section 3: third import with force ────────────────────────────────────

  console.log('\n=== Section 3: re-import with force ===');

  const third = await importSkills([source], target, { reportDir, date: DATE, force: true });
  assertEqual(third.force, true, 'the report records that force was on');
  assertEqual(third.overwritten, 5, 'all 5 existing skills are overwritten with force');
  assertEqual(third.skipped, 0, 'nothing is skipped with force');
  assertEqual(third.imported, 0, 'nothing is reported as newly imported with force');
  assertEqual(third.rejected, 3, 'force does not import an invalid skill either');
  assert(
    readFileSync(cachePriming, 'utf-8') ===
      readFileSync(join(FIXTURES, 'backend', 'cache-priming', 'SKILL.md'), 'utf-8'),
    'with force the local edit is replaced by the source copy',
  );
  const forcedReport = JSON.parse(readFileSync(join(reportDir, `corpus-import-${DATE}.json`), 'utf-8'));
  assertEqual(forcedReport.overwritten, 5, 'the forced run overwrote the same report file for the same date');

  // ── Section 4: a non-existent target is created ────────────────────────────

  console.log('\n=== Section 4: target creation and the default target ===');

  const fresh = join(tmp, 'fresh-target');
  assertEqual(existsSync(fresh), false, 'the target does not exist beforehand');
  const freshReport = await importSkills([source], fresh, { reportDir, date: DATE });
  assertEqual(freshReport.imported, 5, 'a non-existent target directory is created and populated');
  assert(
    freshReport.warnings.some((w) => w.includes('did not exist and was created')),
    'creating the target is recorded in the report warnings',
  );
  assertEqual(DEFAULT_TARGET_DIR, 'data/skills', 'the default target is data/skills');

  // ── Section 5: an unsafe name cannot escape the target ─────────────────────

  console.log('\n=== Section 5: target containment ===');

  const evil = join(tmp, 'evil');
  mkdirSync(join(evil, 'escape'), { recursive: true });
  writeFileSync(
    join(evil, 'escape', 'SKILL.md'),
    '---\nname: ..\\..\\escaped\ndescription: A name carrying traversal segments that must be refused before anything is written outside the target directory, no matter how the path joins are computed downstream\n---\n\nbody\n',
    'utf-8',
  );
  const escapeTarget = join(tmp, 'escape-target');
  const escapeReport = await importSkills([evil], escapeTarget, { reportDir, date: DATE });
  assertEqual(escapeReport.imported, 0, 'a traversal-shaped name is not imported');
  assertEqual(escapeReport.rejected, 1, 'a traversal-shaped name is rejected');
  // The name-shape rule refuses it first, so containment is never reached from
  // a validated name; resolveTargetDir() below pins the second line of defence.
  assertEqual(
    escapeReport.items[0]?.issues?.[0]?.field,
    'name',
    'the rejection is reported on the name rule, before any path is built',
  );
  assertEqual(existsSync(join(tmp, 'escaped')), false, 'nothing was written outside the target directory');

  assertEqual(resolveTargetDir('backend-eloquent', resolve(target)), join(resolve(target), 'backend', 'eloquent'), 'resolveTargetDir splits on the first hyphen');
  assertEqual(resolveTargetDir('../evil', resolve(target)), null, 'resolveTargetDir refuses a traversal name');
  assertEqual(resolveTargetDir('back\\slash', resolve(target)), null, 'resolveTargetDir refuses a backslash in the name');
  assertEqual(resolveTargetDir('a/b', resolve(target)), null, 'resolveTargetDir refuses a separator in the name');

  // ── Section 6: dateStamp ───────────────────────────────────────────────────

  console.log('\n=== Section 6: dateStamp ===');

  assertEqual(dateStamp(new Date(2026, 8, 26)), '2026-09-26', 'dateStamp formats a local date as YYYY-MM-DD');
  assertEqual(dateStamp(new Date(2026, 11, 5)), '2026-12-05', 'dateStamp zero-pads the day');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(dateStamp()), 'dateStamp output matches YYYY-MM-DD');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n=== Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) process.exit(1);
