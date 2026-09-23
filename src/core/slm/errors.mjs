/**
 * SLM client error classes.
 *
 * All errors extend SlmError so callers can catch the whole hierarchy with a
 * single try/catch while still distinguishing timeout from availability failures.
 */

class SlmError extends Error {
  /**
   * @param {string} message
   * @param {number} [status] HTTP status code if applicable
   * @param {string|object} [body] Response body if applicable
   */
  constructor(message, status, body) {
    super(message);
    this.name = 'SlmError';
    this.status = status;
    this.body = body;
  }
}

class SlmTimeoutError extends SlmError {
  /**
   * @param {string} [message]
   */
  constructor(message = 'SLM request timed out') {
    super(message);
    this.name = 'SlmTimeoutError';
  }
}

class SlmUnavailableError extends SlmError {
  /**
   * @param {string} [message]
   */
  constructor(message = 'SLM endpoint is unavailable') {
    super(message);
    this.name = 'SlmUnavailableError';
  }
}

export { SlmError, SlmTimeoutError, SlmUnavailableError };
