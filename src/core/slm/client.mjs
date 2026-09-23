/**
 * Zero-dependency SLM (small language model) HTTP client.
 *
 * Implements a subset of the OpenAI-compatible Chat Completions API that the
 * local llama-server instance exposes at /v1/chat/completions and /health.
 *
 * Design decisions:
 * - Single AbortController per call, cleared in finally — prevents leaks on
 *   slow responses and ensures the fetch signal is always cancelled.
 * - Never logs full prompt content — only length and first few chars as a
 *   diagnostic hint when errors surface.
 * - Throws SlmError subclasses so callers can distinguish timeout from
 *   server-unavailable vs generic HTTP errors.
 */

import {
  SlmError,
  SlmTimeoutError,
  SlmUnavailableError,
} from './errors.mjs';

const DEFAULTS = {
  endpoint: 'http://127.0.0.1:8080',
  model: 'qwen2.5',
  timeoutMs: 2000,
  temperature: 0,
  max_tokens: 64,
};

/**
 * @param {number} ms
 * @returns {AbortController}
 */
function abortAfter(ms) {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), ms);
  return ac;
}

/**
 * @param {Response} res
 * @returns {Promise<unknown>} Parsed JSON body
 */
async function parseBody(res) {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return await res.text();
}

/**
 * Sanitise a prompt for error logging: never expose more than the first 40
 * printable characters.
 * @param {string} prompt
 * @returns {string}
 */
function hint(prompt) {
  const stripped = prompt.replace(/\s+/g, ' ').trim();
  return stripped.length > 40 ? stripped.slice(0, 40) + '…' : stripped;
}

export class SlmClient {
  /**
   * @param {object} [options]
   * @param {string} [options.endpoint]
   * @param {string} [options.model]
   * @param {number} [options.timeoutMs]
   * @param {number} [options.temperature]
   * @param {number} [options.max_tokens]
   */
  constructor(options = {}) {
    this.endpoint = options.endpoint ?? DEFAULTS.endpoint;
    this.model = options.model ?? DEFAULTS.model;
    this.timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
    this.temperature = options.temperature ?? DEFAULTS.temperature;
    this.maxTokens = options.max_tokens ?? DEFAULTS.max_tokens;
  }

  /**
   * Health check. Returns true within 500 ms; false otherwise.
   * @returns {Promise<boolean>}
   */
  async isAlive() {
    try {
      const url = new URL('/health', this.endpoint);
      const signal = abortAfter(500).signal;
      const res = await fetch(url, { signal });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Chat completion.
   *
   * @param {Array<{role:string,content:string}>} messages
   * @param {object} [options]
   * @param {number} [options.temperature]
   * @param {number} [options.max_tokens]
   * @returns {Promise<{content:string, latencyMs:number, raw:unknown}>}
   */
  async chat(messages, options = {}) {
    const url = new URL('/v1/chat/completions', this.endpoint);
    const temperature = options.temperature ?? this.temperature;
    const maxTokens = options.max_tokens ?? this.maxTokens;

    const body = {
      model: this.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const start = performance.now();

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const errBody = await parseBody(res);
        throw new SlmError(
          `SLM HTTP ${res.status}: ${JSON.stringify(errBody)}`,
          res.status,
          errBody,
        );
      }

      const raw = await res.json();
      const content = raw?.choices?.[0]?.message?.content ?? '';
      const latencyMs = Math.round(performance.now() - start);

      return { content, latencyMs, raw };
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError' || err.code === 'ABORT_ERROR') {
        throw new SlmTimeoutError(
          `SLM timed out after ${this.timeoutMs}ms (hint: ${hint(messages[messages.length - 1]?.content ?? '')})`,
        );
      }
      if (err instanceof SlmError) throw err;
      throw new SlmUnavailableError(
        `SLM unavailable: ${err.message} (hint: ${hint(messages[messages.length - 1]?.content ?? '')})`,
      );
    } finally {
      // Ensure signal is aborted if the timer fired but fetch hasn't resolved.
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }
  }

  /**
   * Convenience wrapper for a single-turn completion.
   *
   * @param {string} prompt
   * @param {object} [options]
   * @returns {Promise<{content:string, latencyMs:number, raw:unknown}>}
   */
  async complete(prompt, options = {}) {
    return this.chat(
      [{ role: 'user', content: prompt }],
      options,
    );
  }
}

export { SlmClient as default };
