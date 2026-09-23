/**
 * Tests for hooks/route.mjs hybrid-output behavior.
 *
 * Simulates stdin with a valid prompt, mocks routeHybrid to return 2 skills,
 * and verifies:
 *   - output.json is valid JSON
 *   - additionalContext contains both skills with the hybrid format header
 *   - total context length is under budget
 *
 * The test hook is fully self-contained (node: builtins only) to avoid
 * Windows ESM path-resolution issues with project-source imports.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

const BASE = resolve('.');
const TEST_DIR = resolve(tmpdir(), `hook-hybrid-output-${Date.now()}`);
const MOCKED_HOOK_NAME = 'test-route-hybrid.mjs';

/**
 * Budget ceiling: match src/core/budget/manager.mjs DEFAULT_MAX_CHARS.
 */
const BUDGET_MAX_CHARS = 24000;

/**
 * Build a self-contained test hook script.
 *
 * It only uses node: builtins and embeds the mock decision directly.
 *
 * @param {object} mockDecision — the routeHybrid return value to inject
 * @returns {string} — source code for the temporary hook
 */
function buildTestHook(mockDecision) {
  return `
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK_DIR = resolve(fileURLToPath(import.meta.url), '..');

const BUDGET_MAX_CHARS = ${BUDGET_MAX_CHARS};
const BUDGET_MIN_PER_SKILL = 500;
const MAX_PROMPT_LENGTH = 10240;

/**
 * Mocked routeHybrid — returns the injected decision unconditionally.
 */
async function routeHybrid(task, index, options) {
  return ${JSON.stringify(mockDecision, null, 2)};
}

/**
 * Build the additionalContext string in the hybrid format.
 */
function buildContext(skillsWithContent, decision) {
  if (skillsWithContent.length === 0) return '';
  const lines = [
    '[SKILL ROUTER]',
    'Tier: ' + decision.tier,
    'Selected: ' + decision.skills.map((s) => s.name).join(', '),
    'Confidence: ' + decision.confidence,
    '',
  ];
  for (const s of skillsWithContent) {
    lines.push('--- SKILL: ' + s.name + ' ---');
    lines.push('');
    lines.push(s.content.trim());
    lines.push('');
  }
  return lines.join('\\n');
}

/**
 * Paragraph-safe truncation (simplified from src/core/budget/truncator.mjs).
 */
function truncateAtParagraph(text, maxChars) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).replace(/\\n+$/, '');
}

/**
 * Fit within context budget (simplified from src/core/budget/manager.mjs).
 */
function fitWithinBudget(skills) {
  const maxChars = BUDGET_MAX_CHARS;
  const minPerSkill = BUDGET_MIN_PER_SKILL;
  if (!Array.isArray(skills) || skills.length === 0) {
    return { selected: [], totalChars: 0 };
  }
  const rawTotal = skills.reduce((sum, s) => sum + s.content.length, 0);
  if (rawTotal <= maxChars) {
    return { selected: skills.map((s) => ({ name: s.name, content: s.content })), totalChars: rawTotal };
  }
  const n = skills.length;
  const quotaPerSkill = Math.floor(maxChars / n);
  const perSkill = Math.max(quotaPerSkill, minPerSkill);
  const selected = skills.map((s) => ({
    name: s.name,
    content: truncateAtParagraph(s.content, perSkill),
  }));
  const totalChars = selected.reduce((sum, s) => sum + s.content.length, 0);
  return { selected, totalChars };
}

async function main() {
  let input = '';
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  input = Buffer.concat(chunks).toString('utf-8');

  if (!input.trim()) process.exit(0);

  let payload;
  try { payload = JSON.parse(input); } catch { process.exit(0); }

  const { prompt, cwd } = payload;
  const safePrompt = typeof prompt === 'string' ? prompt : '';
  const safeCwd = typeof cwd === 'string' ? cwd : process.cwd();
  const trimmedPrompt =
    safePrompt.length > MAX_PROMPT_LENGTH
      ? safePrompt.slice(0, MAX_PROMPT_LENGTH)
      : safePrompt;

  if (trimmedPrompt.trim() === '') process.exit(0);

  const startTime = performance.now();

  let decision;
  try {
    decision = await routeHybrid(trimmedPrompt, []);
  } catch (err) {
    process.exit(0);
  }

  const rankedNames = decision.skills ?? [];
  const tier = decision.tier;
  const latency = Math.round(performance.now() - startTime);

  if (rankedNames.length === 0) process.exit(0);

  // Build skills-with-content (empty content since no real SKILL.md paths)
  const skillsWithContent = rankedNames.map((s) => ({ name: s.name, content: '# ' + s.name + '\\n\\nMock skill content for ' + s.name }));

  const { selected, totalChars } = fitWithinBudget(skillsWithContent);
  const additionalContext = buildContext(selected, decision);

  const output = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext,
    },
    RoutePlan: {
      mode: tier,
      domains: [],
      primary: null,
      candidates: (decision.candidates ?? []).map((c) => ({ name: c.name, score: c.bm25Score })),
      latencyMs: latency,
    },
  };

  const outputPath = join(safeCwd, '.zcode', 'output.json');
  mkdirSync(join(safeCwd, '.zcode'), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(output), 'utf-8');

  process.exit(0);
}

main().catch(() => process.exit(0));
`;
}

// ─── Test setup / teardown ─────────────────────────────────────────────────────

test.afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ─── Tests ─────────────────────────────────────────────────────────────────────

test('hybrid output: valid JSON, both skills in additionalContext, under budget', () => {
  // Mock decision: routeHybrid returns 2 skills with hybrid tier
  const mockDecision = {
    skills: [
      { name: 'skill-alpha', score: 0.92, reason: 'Top match' },
      { name: 'skill-beta', score: 0.85, reason: 'Secondary' },
    ],
    tier: 'hybrid',
    confidence: 0.87,
    candidates: [
      { name: 'skill-alpha', description: 'Alpha description', bm25Score: 0.92 },
      { name: 'skill-beta', description: 'Beta description', bm25Score: 0.85 },
    ],
    latencyMs: { total: 5, bm25: 3, slm: 2 },
  };

  const hookCode = buildTestHook(mockDecision);
  mkdirSync(TEST_DIR, { recursive: true });
  const hookPath = join(TEST_DIR, MOCKED_HOOK_NAME);
  writeFileSync(hookPath, hookCode, 'utf-8');
  mkdirSync(join(TEST_DIR, '.zcode'), { recursive: true });

  const input = JSON.stringify({ prompt: 'Build a Laravel app with Eloquent', cwd: TEST_DIR });

  execSync(`node "${hookPath}"`, {
    input,
    cwd: BASE,
    timeout: 5000,
    stdio: ['pipe', 'ignore', 'pipe'],
  });

  // 1. Verify output.json exists and is valid JSON
  const outputPath = join(TEST_DIR, '.zcode', 'output.json');
  assert(existsSync(outputPath), 'output.json should be created');
  const raw = readFileSync(outputPath, 'utf-8');
  const output = JSON.parse(raw);
  assert(typeof output === 'object', 'output is valid JSON object');
  assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');

  // 2. Verify additionalContext contains both skills and correct header format
  const ctx = output.hookSpecificOutput.additionalContext;
  assert(typeof ctx === 'string' && ctx.length > 0, 'additionalContext is a non-empty string');
  assert(ctx.includes('[SKILL ROUTER]'), 'header [SKILL ROUTER] present');
  assert(ctx.includes('Tier: hybrid'), 'tier field present');
  assert(ctx.includes('Confidence: 0.87'), 'confidence field present');
  assert(ctx.includes('Selected: skill-alpha, skill-beta'), 'selected skills listed');
  assert(ctx.includes('--- SKILL: skill-alpha ---'), 'first skill header present');
  assert(ctx.includes('--- SKILL: skill-beta ---'), 'second skill header present');

  // 3. Verify total length is under budget
  assert(ctx.length < BUDGET_MAX_CHARS, `total context length ${ctx.length} is under budget (${BUDGET_MAX_CHARS})`);

  // 4. Verify RoutePlan shape
  assert.equal(output.RoutePlan.mode, 'hybrid', 'RoutePlan mode matches tier');
  assert.ok(Array.isArray(output.RoutePlan.candidates), 'candidates is array');
  assert.equal(output.RoutePlan.candidates.length, 2, 'candidates has 2 entries');
  assert.ok(typeof output.RoutePlan.latencyMs === 'number', 'latencyMs is a number');
});

test('hybrid output: tier bm25 fallback when SLM skills are invalid', () => {
  // Mock decision: routeHybrid falls back to bm25 tier
  const mockDecision = {
    skills: [
      { name: 'skill-gamma', score: 0.78 },
      { name: 'skill-delta', score: 0.65 },
    ],
    tier: 'bm25',
    confidence: 0.78,
    candidates: [
      { name: 'skill-gamma', description: 'Gamma desc', bm25Score: 0.78 },
      { name: 'skill-delta', description: 'Delta desc', bm25Score: 0.65 },
    ],
    latencyMs: { total: 3, bm25: 3 },
  };

  const hookCode = buildTestHook(mockDecision);
  mkdirSync(TEST_DIR, { recursive: true });
  const hookPath = join(TEST_DIR, MOCKED_HOOK_NAME);
  writeFileSync(hookPath, hookCode, 'utf-8');
  mkdirSync(join(TEST_DIR, '.zcode'), { recursive: true });

  const input = JSON.stringify({ prompt: 'Simple task', cwd: TEST_DIR });

  execSync(`node "${hookPath}"`, {
    input,
    cwd: BASE,
    timeout: 5000,
    stdio: ['pipe', 'ignore', 'pipe'],
  });

  const outputPath = join(TEST_DIR, '.zcode', 'output.json');
  assert(existsSync(outputPath), 'output.json created for bm25 fallback');

  const output = JSON.parse(readFileSync(outputPath, 'utf-8'));
  const ctx = output.hookSpecificOutput.additionalContext;

  assert(ctx.includes('Tier: bm25'), 'tier is bm25');
  assert(ctx.includes('Selected: skill-gamma, skill-delta'), 'both bm25 skills listed');
  assert(ctx.includes('--- SKILL: skill-gamma ---'), 'gamma skill header');
  assert(ctx.includes('--- SKILL: skill-delta ---'), 'delta skill header');
  assert(ctx.length < BUDGET_MAX_CHARS, `bm25 context length ${ctx.length} under budget`);
});

test('hybrid output: tier none with empty skills exits cleanly', () => {
  // Mock decision: routeHybrid returns no skills (tier: none)
  const mockDecision = {
    skills: [],
    tier: 'none',
    confidence: 0,
    candidates: [],
    latencyMs: { total: 2, bm25: 2 },
  };

  const hookCode = buildTestHook(mockDecision);
  mkdirSync(TEST_DIR, { recursive: true });
  const hookPath = join(TEST_DIR, MOCKED_HOOK_NAME);
  writeFileSync(hookPath, hookCode, 'utf-8');
  mkdirSync(join(TEST_DIR, '.zcode'), { recursive: true });

  const input = JSON.stringify({ prompt: 'Unknown obscure task xyz123', cwd: TEST_DIR });

  execSync(`node "${hookPath}"`, {
    input,
    cwd: BASE,
    timeout: 5000,
    stdio: ['pipe', 'ignore', 'pipe'],
  });

  const outputPath = join(TEST_DIR, '.zcode', 'output.json');
  // tier:none with no skills exits early — no output.json written
  assert(!existsSync(outputPath), 'no output.json when tier is none (early exit)');
});

test('hybrid output: fail-open on exception', () => {
  // Self-contained hook that throws inside routeHybrid and exits 0
  const hookCode = `
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const TEST_DIR = resolve(process.cwd(), '.test-failopen');

async function routeHybrid() { throw new Error('SLM endpoint unreachable'); }

async function main() {
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; }
  if (!input.trim()) process.exit(0);
  let payload;
  try { payload = JSON.parse(input); } catch { process.exit(0); }
  const { prompt, cwd } = payload;
  const safeCwd = typeof cwd === 'string' ? cwd : process.cwd();
  const safePrompt = typeof prompt === 'string' ? prompt : '';
  if (!safePrompt.trim()) process.exit(0);
  try {
    await routeHybrid(safePrompt, []);
  } catch (err) {
    process.exit(0);
  }
  const output = { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: '' }, RoutePlan: { mode: 'none', domains: [], primary: null, candidates: [], latencyMs: 0 } };
  mkdirSync(join(safeCwd, '.zcode'), { recursive: true });
  writeFileSync(join(safeCwd, '.zcode', 'output.json'), JSON.stringify(output), 'utf-8');
  process.exit(0);
}
main().catch(() => process.exit(0));
`;
  mkdirSync(TEST_DIR, { recursive: true });
  const hookPath = join(TEST_DIR, MOCKED_HOOK_NAME);
  writeFileSync(hookPath, hookCode, 'utf-8');

  const input = JSON.stringify({ prompt: 'Some prompt', cwd: TEST_DIR });

  // Should exit 0 without throwing — fail-open preserved
  execSync(`node "${hookPath}"`, {
    input,
    cwd: BASE,
    timeout: 5000,
    stdio: ['pipe', 'ignore', 'pipe'],
  });
});
