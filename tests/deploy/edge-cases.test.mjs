/**
 * Edge-case tests for the sync, deploy and hook-registration write paths.
 *
 * Fills the gaps listed in docs/reports/phase-6-test-audit.md section 4:
 * applySync, applyDeploy and registerHook/unregisterHook had happy-path tests
 * but no empty-input, malformed-input or boundary cases.
 *
 * Covered here:
 *   1. applySync           — empty plan, unresolvable source path, path
 *                            traversal in entry.path (Phase 6.4 C4 regression
 *                            at this call site), dry-run with an empty plan.
 *   2. applyDeploy         — empty plan (dry-run and live), missing source
 *                            router, snapshot dir under a temp root.
 *   3. verifySnapshotIntegrity — missing file, malformed JSON, missing fields,
 *                            a valid fresh snapshot.
 *   4. registerHook        — malformed existing config.json, missing
 *                            hooks.events key, non-array events entry,
 *                            idempotence, unregister round-trip.
 */
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, rmSync,
} from 'node:fs';
import { applySync } from '../../src/sync/writer.mjs';
import { applyDeploy, verifySnapshotIntegrity } from '../../src/deploy/writer.mjs';
import { registerHook, unregisterHook, isHookRegistered } from '../../src/deploy/hook-registrar.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, 'tmp-edge');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log(`  \u2713 ${message}`); }
  else { failed++; console.error(`  \u2717 ${message}`); }
}

function fresh(name) {
  const dir = resolve(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function emptyPlan(mirrorPath) {
  return { add: [], update: [], remove: [], unchanged: [], disabled: [], mirrorPath };
}

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

console.log('\n=== Sync / deploy / registrar edge cases ===\n');

// ─── 1. applySync ────────────────────────────────────────────────────────────
console.log('1. applySync empty plan / unresolvable source / traversal');

const syncMirror = fresh('sync-mirror');
const syncProject = fresh('sync-project');

const emptyResult = applySync(emptyPlan(syncMirror), syncProject, { quiet: true });
assert(emptyResult.added === 0 && emptyResult.updated === 0 && emptyResult.removed === 0,
  'an empty plan changes nothing');
assert(emptyResult.errors.length === 0, `an empty plan produces no errors (got ${emptyResult.errors.length})`);
assert(existsSync(syncMirror), 'applySync still ensures the mirror root exists');

const dryEmpty = applySync(emptyPlan(syncMirror), syncProject, { dryRun: true, quiet: true });
assert(dryEmpty.errors.length === 0 && dryEmpty.added === 0, 'a dry-run over an empty plan is a no-op');

const missingResult = applySync(
  { ...emptyPlan(syncMirror), add: [{ name: 'ghost', path: 'ghost', hash: 'x' }] },
  syncProject,
  { quiet: true }
);
assert(missingResult.errors.length === 1, `an add whose source is missing is an error (got ${missingResult.errors.length})`);
assert(/Source not found/.test(missingResult.errors[0] ?? ''), 'the error names the missing source');
assert(missingResult.added === 0, 'a failed add is not counted as added');

// Path traversal must be refused by the writer, not merely by the CLI.
const escapeName = 'evil';
const escapeResult = applySync(
  { ...emptyPlan(syncMirror), add: [{ name: escapeName, path: '../../../escaped', hash: 'x' }] },
  syncProject,
  { quiet: true }
);
assert(escapeResult.errors.length > 0, 'a traversing add path is rejected');
assert(!existsSync(resolve(syncProject, '..', '..', 'escaped')), 'nothing was written outside the project root');

// ─── 2. applyDeploy ──────────────────────────────────────────────────────────
console.log('\n2. applyDeploy empty plan / missing source');

const deployMirror = fresh('deploy-mirror');
const deployProject = fresh('deploy-project');
const deployRouters = resolve(deployProject, 'router-skills');
mkdirSync(deployRouters, { recursive: true });

const emptyDeployPlan = {
  routers: { add: [], update: [], unchanged: [], remove: [] },
  leaves: { disable: [], alreadyDisabled: [] },
  warnings: [],
};

const dryDeploy = applyDeploy(emptyDeployPlan, deployProject, deployMirror, {
  dryRun: true, quiet: true, snapshotDir: resolve(TMP, 'snapshots-dry'),
});
assert(dryDeploy.added === 0 && dryDeploy.errors.length === 0, 'a dry-run over an empty deploy plan is a no-op');
assert(dryDeploy.snapshotPath === null, 'a dry-run writes no snapshot');

const liveDeploy = applyDeploy(emptyDeployPlan, deployProject, deployMirror, {
  quiet: true, snapshotDir: resolve(TMP, 'snapshots-live'),
});
assert(liveDeploy.added === 0 && liveDeploy.updated === 0 && liveDeploy.errors.length === 0,
  'a live run over an empty deploy plan succeeds');
assert(typeof liveDeploy.snapshotPath === 'string' && existsSync(liveDeploy.snapshotPath),
  'a live run still snapshots the mirror first');

const missingRouter = applyDeploy(
  {
    ...emptyDeployPlan,
    routers: { add: [{ name: 'router-ghost', path: 'router-ghost', hash: 'h' }], update: [], unchanged: [], remove: [] },
  },
  deployProject,
  deployMirror,
  { quiet: true, snapshotDir: resolve(TMP, 'snapshots-missing') }
);
assert(missingRouter.errors.length === 1, `a deploy entry with no source router is an error (got ${missingRouter.errors.length})`);
assert(missingRouter.added === 0, 'the failed router was not counted as added');

// ─── 3. verifySnapshotIntegrity ──────────────────────────────────────────────
console.log('\n3. verifySnapshotIntegrity invalid / boundary input');

assert(verifySnapshotIntegrity(null).valid === false, 'a null path is invalid');
assert(verifySnapshotIntegrity(resolve(TMP, 'no-such-snapshot.json')).valid === false,
  'a missing snapshot file is invalid');

const malformed = resolve(TMP, 'malformed.json');
writeFileSync(malformed, '{ not json');
const malformedResult = verifySnapshotIntegrity(malformed);
assert(malformedResult.valid === false && /invalid JSON/.test(malformedResult.errors[0]),
  'malformed JSON is reported as invalid JSON');

const incomplete = resolve(TMP, 'incomplete.json');
writeFileSync(incomplete, JSON.stringify({ timestamp: new Date().toISOString(), operations: [{ action: 'add' }], files: [{ path: 'p' }] }));
const incompleteResult = verifySnapshotIntegrity(incomplete);
assert(incompleteResult.valid === false, 'an operation without a path and a file without a hash is invalid');
assert(incompleteResult.errors.length >= 2, `each missing field is reported separately (got ${incompleteResult.errors.length})`);

const missingFields = resolve(TMP, 'missing-fields.json');
writeFileSync(missingFields, JSON.stringify({}));
const noFieldsResult = verifySnapshotIntegrity(missingFields);
assert(noFieldsResult.errors.length >= 3, `a snapshot with no fields reports every missing one (got ${noFieldsResult.errors.length})`);

const freshSnapshot = resolve(TMP, 'fresh.json');
writeFileSync(freshSnapshot, JSON.stringify({
  timestamp: new Date().toISOString(),
  mirrorRoot: syncMirror,
  operations: [{ action: 'add', path: 'a/SKILL.md' }],
  files: [{ path: 'a/SKILL.md', hash: 'abc' }],
}));
assert(verifySnapshotIntegrity(freshSnapshot).valid === true, 'a complete, fresh snapshot verifies');

const staleSnapshot = resolve(TMP, 'stale.json');
writeFileSync(staleSnapshot, JSON.stringify({
  timestamp: '2000-01-01T00:00:00.000Z',
  mirrorRoot: syncMirror,
  operations: [],
  files: [],
}));
const staleResult = verifySnapshotIntegrity(staleSnapshot);
assert(staleResult.valid === false && /old/.test(staleResult.errors.join(' ')),
  'a snapshot older than the age limit is rejected');

// ─── 4. registerHook / unregisterHook ────────────────────────────────────────
console.log('\n4. registerHook / unregisterHook malformed config');

const cfgMissing = resolve(fresh('cfg-missing'), 'config.json');

const created = registerHook(cfgMissing);
assert(created.changed === true, 'a missing config.json is created and the hook registered');
assert(isHookRegistered(cfgMissing) === true, 'isHookRegistered sees the new registration');

const again = registerHook(cfgMissing);
assert(again.changed === false, 'registering twice is idempotent (changed=false)');
const afterTwice = JSON.parse(readFileSync(cfgMissing, 'utf-8'));
const groups = afterTwice.hooks.events.UserPromptSubmit;
assert(groups.length === 1, `exactly one hook group exists after two registrations (got ${groups.length})`);

const unregistered = unregisterHook(cfgMissing);
assert(unregistered.changed === true, 'unregister removes the hook');
assert(isHookRegistered(cfgMissing) === false, 'isHookRegistered no longer sees it');
assert(unregisterHook(cfgMissing).changed === false, 'unregistering twice is a no-op');

// Malformed JSON: readConfigSafe returns null, so a fresh config is written.
const cfgMalformed = resolve(fresh('cfg-malformed'), 'config.json');
writeFileSync(cfgMalformed, 'not json at all {{{');
const overMalformed = registerHook(cfgMalformed);
assert(overMalformed.changed === true, 'a malformed config.json is replaced, not left broken');
assert(isHookRegistered(cfgMalformed) === true, 'the hook is registered into the rewritten config');
const rewritten = JSON.parse(readFileSync(cfgMalformed, 'utf-8'));
assert(typeof rewritten === 'object' && !Array.isArray(rewritten), 'the rewritten config is a JSON object');

// Missing hooks.events: the registrar must create the whole structure.
const cfgNoEvents = resolve(fresh('cfg-no-events'), 'config.json');
writeFileSync(cfgNoEvents, JSON.stringify({ theme: 'dark' }));
registerHook(cfgNoEvents);
const built = JSON.parse(readFileSync(cfgNoEvents, 'utf-8'));
assert(built.hooks?.enabled === true, 'a missing hooks object is created with enabled=true');
assert(Array.isArray(built.hooks?.events?.UserPromptSubmit), 'a missing events map is created');
assert(built.theme === 'dark', 'unrelated config keys are preserved');

// hooks.events present but UserPromptSubmit is the wrong type.
const cfgWrongType = resolve(fresh('cfg-wrong-type'), 'config.json');
writeFileSync(cfgWrongType, JSON.stringify({ hooks: { enabled: true, events: { UserPromptSubmit: 'oops' } } }));
const fixedType = registerHook(cfgWrongType);
assert(fixedType.changed === true, 'a non-array UserPromptSubmit entry is replaced with an array');
const typed = JSON.parse(readFileSync(cfgWrongType, 'utf-8'));
assert(Array.isArray(typed.hooks.events.UserPromptSubmit) && typed.hooks.events.UserPromptSubmit.length === 1,
  'exactly one hook group is written after the type fix');

// Other hooks survive registration and removal.
const cfgForeign = resolve(fresh('cfg-foreign'), 'config.json');
writeFileSync(cfgForeign, JSON.stringify({
  hooks: { enabled: true, events: { UserPromptSubmit: [{ hooks: [{ type: 'process', command: 'other', args: ['node', 'other.mjs'] }] }] } },
}));
registerHook(cfgForeign);
unregisterHook(cfgForeign);
const pruned = JSON.parse(readFileSync(cfgForeign, 'utf-8'));
const remaining = pruned.hooks.events.UserPromptSubmit.flatMap((g) => g.hooks);
assert(remaining.length === 1, `the foreign hook survives unregister (got ${remaining.length})`);
assert(remaining[0].args[1] === 'other.mjs', 'and it is still the original one');

console.log(`\n  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
rmSync(TMP, { recursive: true, force: true });
if (failed > 0) process.exit(1);
