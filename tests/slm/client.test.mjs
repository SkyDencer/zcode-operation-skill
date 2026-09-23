/**
 * Tests for src/core/slm/client.mjs against a mock HTTP server.
 *
 * Uses Node's built-in --test runner. No external dependencies.
 *
 * Run: node --test tests/slm/client.test.mjs
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { SlmClient, SlmError, SlmTimeoutError } from '../../src/core/slm/index.mjs';

let server;
let port;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        // Slow-response path: delay beyond any reasonable timeout.
        if (req.headers['x-slow'] === 'true') {
          return;
        }

        // 500-error path (handled by a separate server for clean isolation).
        const parsed = (() => {
          try { return JSON.parse(body); } catch { return {}; }
        })();

        const reply = {
          id: 'chatcmpl-test',
          object: 'chat.completion',
          model: parsed.model || 'qwen2.5',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'testing-pest' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(reply));
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    });
  });
});

after(() => {
  if (server) server.close();
});

function clientForPort(opts = {}) {
  return new SlmClient({
    endpoint: `http://127.0.0.1:${port}`,
    timeoutMs: 2000,
    ...opts,
  });
}

test('isAlive() returns true against mock server', async () => {
  const c = clientForPort();
  const alive = await c.isAlive();
  assert.equal(alive, true);
});

test('chat() parses valid response', async () => {
  const c = clientForPort();
  const result = await c.chat([{ role: 'user', content: 'Write a test' }]);
  assert.equal(result.content, 'testing-pest');
  assert.ok(typeof result.latencyMs === 'number' && result.latencyMs >= 0);
  assert.ok(result.raw != null);
  assert.ok(result.raw.choices != null);
});

test('chat() throws SlmError on 500', async () => {
  const errServer = http.createServer((req, res) => {
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'boom' } }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => {
    errServer.listen(0, '127.0.0.1', () => resolve());
  });
  const errPort = errServer.address().port;

  const c = new SlmClient({
    endpoint: `http://127.0.0.1:${errPort}`,
    timeoutMs: 2000,
  });

  try {
    await c.chat([{ role: 'user', content: 'hi' }]);
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof SlmError);
    assert.equal(err.name, 'SlmError');
    assert.equal(err.status, 500);
    assert.ok(err.body != null);
  } finally {
    errServer.close();
  }
});

test('chat() throws SlmTimeoutError on slow response', async () => {
  const slowServer = http.createServer((req, res) => {
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'late' } }] }));
      }, 3000);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => {
    slowServer.listen(0, '127.0.0.1', () => resolve());
  });
  const slowPort = slowServer.address().port;

  const c = new SlmClient({
    endpoint: `http://127.0.0.1:${slowPort}`,
    timeoutMs: 500,
  });

  try {
    await c.chat([{ role: 'user', content: 'hi' }]);
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof SlmTimeoutError);
    assert.equal(err.name, 'SlmTimeoutError');
  } finally {
    slowServer.close();
  }
});

test('timeout is respected — abort fires before server responds', async () => {
  const ctrlServer = http.createServer((req, res) => {
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      setTimeout(() => {
        res.writeHead(200);
        res.end('OK');
      }, 5000);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => {
    ctrlServer.listen(0, '127.0.0.1', () => resolve());
  });
  const ctrlPort = ctrlServer.address().port;

  const c = new SlmClient({
    endpoint: `http://127.0.0.1:${ctrlPort}`,
    timeoutMs: 300,
  });

  const start = performance.now();
  try {
    await c.chat([{ role: 'user', content: 'hi' }]);
    assert.fail('should have thrown');
  } catch (err) {
    const elapsed = performance.now() - start;
    assert.ok(err instanceof SlmTimeoutError);
    assert.ok(elapsed < 1000, `expected ~300 ms, got ${Math.round(elapsed)} ms`);
  } finally {
    ctrlServer.close();
  }
});

test('complete() is a convenience wrapper around chat()', async () => {
  const c = clientForPort();
  const result = await c.complete('Write a test');
  assert.equal(result.content, 'testing-pest');
});

test('isAlive() returns false when server is down', async () => {
  const c = new SlmClient({
    endpoint: 'http://127.0.0.1:1',
    timeoutMs: 500,
  });
  const alive = await c.isAlive();
  assert.equal(alive, false);
});
