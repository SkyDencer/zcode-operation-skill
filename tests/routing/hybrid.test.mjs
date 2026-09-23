/**
 * Tests for src/core/routing/hybrid.mjs — hybrid SLM+BM25 router.
 *
 * Uses a mock Node http server to simulate the SLM endpoint so no real
 * network call is made. Seven test scenarios cover the full pipeline:
 *
 *  1. SLM unavailable  -> pure BM25 fallback
 *  2. SLM returns valid skills -> hybrid tier selected
 *  3. SLM returns invalid names -> filtered out, fallback to BM25
 *  4. SLM returns 10 skills   -> capped at maxSelected (7)
 *  5. SLM timeout             -> fallback to BM25
 *  6. Negative / empty prompt -> tier:none
 *  7. SLM disabled via options -> BM25 only
 *
 * Run:  node --test tests/routing/hybrid.test.mjs
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { routeHybrid } from '../../src/core/routing/hybrid.mjs';
import { rankSkills } from '../../src/core/retriever/bm25.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE = resolve('.');
const INDEX_PATH = resolve(BASE, 'data/skill-index.json');
const index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
const skillList = Object.values(index); // flat array of skill objects

// ─── Mock SLM server helpers ──────────────────────────────────────────────────

/**
 * Start an in-memory mock SLM server that responds on /v1/chat/completions.
 * Returns { port, server }.
 *
 * @param {(body:object) => string} responder — given the parsed request body,
 *        return the raw assistant content string.
 * @returns {Promise<{port:number, server:http.Server}>}
 */
async function startMockServer(responder) {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const parsed = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        const content = typeof responder === 'function' ? responder(parsed) : 'fallback-skill';
        const reply = {
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          model: parsed.model ?? 'qwen2.5',
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(reply));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', () => resolve()); });
  return { port: server.address().port, server };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hybridOpts(port, extra = {}) {
  return {
    topCandidates: 20,
    maxSelected: 7,
    bm25MinThreshold: 0.35,
    slmMinConfidence: 0.5,
    slmTimeoutMs: 2000,
    slmEnabled: true,
    endpoint: `http://127.0.0.1:${port}`,
    ...extra,
  };
}

/**
 * Verify that a RouteDecision has the required shape.
 */
function assertDecisionShape(d) {
  assert.ok(typeof d === 'object' && d !== null, 'decision is an object');
  assert.ok(Array.isArray(d.skills), 'skills is array');
  assert.ok(['hybrid', 'bm25', 'heuristic', 'none'].includes(d.tier), `tier is valid: ${d.tier}`);
  assert.ok(typeof d.confidence === 'number', 'confidence is number');
  assert.ok(Array.isArray(d.candidates), 'candidates is array');
  assert.ok(typeof d.latencyMs === 'object', 'latencyMs is object');
  assert.ok(typeof d.latencyMs.total === 'number', 'latencyMs.total is number');
  assert.ok(typeof d.latencyMs.bm25 === 'number', 'latencyMs.bm25 is number');
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

test('fallback when SLM is unavailable → pure BM25 tier', async () => {
  // Point at a port with no listener — SLM will throw SlmUnavailableError
  const decision = await routeHybrid(
    'Build a Laravel migration for users table',
    skillList,
    { slmEnabled: true, slmTimeoutMs: 100, endpoint: 'http://127.0.0.1:1' },
  );
  assertDecisionShape(decision);
  assert.equal(decision.tier, 'bm25', 'tier should be bm25 when SLM is unreachable');
  assert.ok(decision.skills.length > 0, 'should have BM25 fallback skills');
  assert.ok(decision.latencyMs.slm === undefined, 'slm latency should be absent when SLM failed');
});

test('SLM returns valid skills → hybrid tier with SLM results', async () => {
  const { port, server } = await startMockServer(() =>
    JSON.stringify({
      skills: [
        { name: 'backend-eloquent', score: 0.92, reason: 'Migration focus' },
        { name: 'testing-pest-php', score: 0.75, reason: 'Related testing' },
      ],
      confidence: 0.88,
    }),
  );
  try {
    const decision = await routeHybrid(
      'Build a Laravel migration for users table with soft deletes',
      skillList,
      hybridOpts(port),
    );
    assertDecisionShape(decision);
    assert.equal(decision.tier, 'hybrid', 'tier should be hybrid when SLM responds validly');
    assert.ok(decision.skills.length >= 1, 'should have at least one SLM-selected skill');
    assert.equal(decision.skills[0].name, 'backend-eloquent', 'top SLM skill should be backend-eloquent');
    assert.ok(typeof decision.skills[0].reason === 'string', 'reason should be present');
    assert.ok(typeof decision.latencyMs.slm === 'number', 'slm latency should be recorded');
  } finally {
    server.close();
  }
});

test('SLM returns invalid names → filtered, fallback to BM25', async () => {
  const { port, server } = await startMockServer(() =>
    JSON.stringify({
      skills: [
        { name: 'nonexistent-skill', score: 0.95, reason: 'made up' },
        { name: 'also-missing', score: 0.90, reason: 'not in index' },
      ],
      confidence: 0.9,
    }),
  );
  try {
    const decision = await routeHybrid(
      'Write a PHPUnit test for API auth',
      skillList,
      hybridOpts(port),
    );
    assertDecisionShape(decision);
    assert.equal(decision.tier, 'bm25', 'tier should fall back to bm25 when SLM names are invalid');
    assert.ok(decision.skills.length > 0, 'should still have BM25 fallback skills');
  } finally {
    server.close();
  }
});

test('SLM returns 10 skills → capped at maxSelected (7)', async () => {
  const knownNames = skillList.slice(0, 10).map((s) => s.name);
  const skills = knownNames.map((n, i) => ({ name: n, score: 0.95 - i * 0.01, reason: `r${i}` }));
  const { port, server } = await startMockServer(() =>
    JSON.stringify({ skills, confidence: 0.95 }),
  );
  try {
    const decision = await routeHybrid(
      'Generic task to surface many skills',
      skillList,
      hybridOpts(port, { maxSelected: 7 }),
    );
    assertDecisionShape(decision);
    assert.equal(decision.tier, 'hybrid', 'tier should be hybrid');
    assert.ok(decision.skills.length <= 7, `expected ≤ 7 skills, got ${decision.skills.length}`);
    assert.equal(decision.skills.length, 7, 'should cap at maxSelected=7');
  } finally {
    server.close();
  }
});

test('SLM timeout → fallback to BM25', async () => {
  // Slow server that delays beyond the timeout
  const slowServer = http.createServer((req, res) => {
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'late' } }] }));
      }, 5000);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => { slowServer.listen(0, '127.0.0.1', () => resolve()); });
  const slowPort = slowServer.address().port;
  try {
    const decision = await routeHybrid(
      'Test SLM timeout handling',
      skillList,
      hybridOpts(slowPort, { slmTimeoutMs: 200 }),
    );
    assertDecisionShape(decision);
    assert.equal(decision.tier, 'bm25', 'tier should fall back to bm25 on SLM timeout');
    assert.ok(decision.skills.length > 0, 'should have BM25 fallback skills');
  } finally {
    slowServer.close();
  }
});

test('negative / empty prompt → tier:none', async () => {
  const decision = await routeHybrid('', skillList, { slmEnabled: false });
  assertDecisionShape(decision);
  assert.equal(decision.tier, 'none', 'empty prompt should produce tier:none');
  assert.equal(decision.skills.length, 0, 'no skills should be returned');
});

test('SLM explicitly disabled → BM25 only, no SLM call made', async () => {
  let requestCount = 0;
  const countingServer = http.createServer((req, res) => {
    requestCount++;
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => { countingServer.listen(0, '127.0.0.1', () => resolve()); });
  const cp = countingServer.address().port;
  try {
    const decision = await routeHybrid(
      'Build a full-stack Next.js app',
      skillList,
      hybridOpts(cp, { slmEnabled: false }),
    );
    assertDecisionShape(decision);
    assert.equal(decision.tier, 'bm25', 'tier should be bm25 when SLM is disabled');
    assert.equal(requestCount, 0, 'no HTTP requests should be made to SLM endpoint');
  } finally {
    countingServer.close();
  }
});
