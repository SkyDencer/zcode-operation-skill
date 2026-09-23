/**
 * Prompt builders for the SLM (small language model) skill router.
 *
 * Constructs system + user messages for single-best and multi-skill routing
 * tasks. Caps candidates at 30 and truncates descriptions to 200 chars so
 * the prompt fits comfortably within small-model context windows.
 */

const MAX_CANDIDATES = 30;
const MAX_DESC_LENGTH = 200;

/**
 * Thrown when buildSelectorPrompt receives an empty task string.
 */
export class EmptyTaskError extends Error {
  constructor(message = 'Task must not be empty') {
    super(message);
    this.name = 'EmptyTaskError';
  }
}

/**
 * Thrown when buildSelectorPrompt receives an empty candidates array.
 */
export class EmptyCandidatesError extends Error {
  constructor(message = 'Candidates must not be empty') {
    super(message);
    this.name = 'EmptyCandidatesError';
  }
}

/**
 * Sanitise a candidate description to at most MAX_DESC_LENGTH characters.
 *
 * @param {string} desc
 * @returns {string}
 */
function truncateDesc(desc) {
  if (typeof desc !== 'string') return '';
  return desc.length > MAX_DESC_LENGTH ? desc.slice(0, MAX_DESC_LENGTH) + '…' : desc;
}

/**
 * Build a single-best selector prompt.
 *
 * The model is asked to reply with only the exact name of the one best
 * matching skill. No punctuation. No explanation.
 *
 * @param {string} task — user's authoring prompt / task description
 * @param {Array<{name:string, description?:string}>} candidates
 * @param {object} [options]
 * @returns {{system:string, user:string}}
 */
export function buildSelectorPrompt(task, candidates, options = {}) {
  if (!task || typeof task !== 'string' || task.trim() === '') {
    throw new EmptyTaskError('Task must not be empty');
  }
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new EmptyCandidatesError('Candidates must not be empty');
  }

  const truncated = candidates.slice(0, MAX_CANDIDATES).map((c) => ({
    name: c.name,
    description: truncateDesc(c.description ?? ''),
  }));

  const system =
    'You are a skill router. Reply with ONLY the exact name of the single best matching skill. No punctuation. No explanation.';

  const skillsList = truncated
    .map((c) => `- ${c.name}: ${c.description}`)
    .join('\n');

  const user = `Available skills:\n${skillsList}\n\nTask: "${task}"\n\nBest skill:`;

  return { system, user };
}

/**
 * Build a multi-skill selector prompt.
 *
 * The model returns a JSON object (no fences) with a skills array and a
 * confidence score. Only skills with score >= 0.5 should be included.
 *
 * @param {string} task
 * @param {Array<{name:string, description?:string}>} candidates
 * @param {object} [options]
 * @returns {{system:string, user:string}}
 */
export function buildMultiSelectorPrompt(task, candidates, options = {}) {
  if (!task || typeof task !== 'string' || task.trim() === '') {
    throw new EmptyTaskError('Task must not be empty');
  }
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new EmptyCandidatesError('Candidates must not be empty');
  }

  const truncated = candidates.slice(0, MAX_CANDIDATES).map((c) => ({
    name: c.name,
    description: truncateDesc(c.description ?? ''),
  }));

  const system =
    'You are a skill router. Return ONLY a JSON object: {"skills": [{"name": "...", "score": 0.0-1.0, "reason": "..."}], "confidence": 0.0-1.0}. Include 1-7 skills. Only include skills with score >= 0.5. No markdown fences.';

  const skillsList = truncated
    .map((c) => `- ${c.name}: ${c.description}`)
    .join('\n');

  const user = `Available skills:\n${skillsList}\n\nTask: "${task}"\n\nBest skills (JSON):`;

  return { system, user };
}
