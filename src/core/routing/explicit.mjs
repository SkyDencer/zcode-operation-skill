/**
 * Explicit $-mention skill detection.
 *
 * Scans a prompt for `$` mentions such as `$next`, `$laravel`, or
 * `$router-next` and resolves them to a concrete router skill name.
 *
 * Resolution order:
 *  1. Full router name (e.g. `$router-next`) — accepted if present in knownSkills.
 *  2. Short alias (e.g. `$next`) — resolved via ROUTER_ALIASES, then checked
 *     against knownSkills.
 *  3. Unknown or missing — returns null (no explicit match).
 *
 * Matching on the alias portion is case-insensitive (`$NEXT` → `router-next`).
 * The matched `$mention` is stripped from cleanedPrompt so downstream routing
 * only sees the remaining task description.
 *
 * @module src/core/routing/explicit
 */

import { ROUTER_ALIASES } from '../../config/aliases.mjs';

/**
 * Maps each router skill name to the domain(s) of leaf skills it dispatches to.
 * Used by routeWithExplicit to scope BM25 retrieval to the relevant subset.
 *
 * @type {Record<string, string[]>}
 */
export const ROUTER_DOMAINS = {
  'router-next': ['frontend'],
  'router-react': ['frontend'],
  'router-laravel': ['backend'],
  'router-design': ['design'],
  'router-test': ['testing'],
  'router-meta': ['meta'],
};

/**
 * Result shape returned by detectExplicitSkill when a match is found.
 *
 * @typedef {object} ExplicitSkillResult
 * @property {string} skill — full router skill name (e.g. "router-next")
 * @property {string} matchedText — the raw `$` mention text (e.g. "$next")
 * @property {string} cleanedPrompt — prompt with the mention stripped
 */

/**
 * Detect an explicit `$` mention in the prompt and resolve it to a router skill.
 *
 * @param {string} prompt — raw user prompt (may contain $-mentions)
 * @param {Array<{name:string}>} knownSkills — skill index entries (used to validate targets)
 * @returns {ExplicitSkillResult|null} null when no valid explicit mention is found
 */
export function detectExplicitSkill(prompt, knownSkills) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return null;
  }

  // Build a Set of known skill names for O(1) lookup.
  const knownNames = new Set(knownSkills.map((s) => s.name));

  // Match $word tokens anywhere in the prompt.
  // Groups: $mention itself, then rest of line after it.
  const mentionRegex = /\$([a-zA-Z_][a-zA-Z0-9_-]*)/;
  const match = prompt.match(mentionRegex);
  if (!match) {
    return null;
  }

  const rawMention = match[0]; // e.g. "$next" or "$ROUTER-NEXT"
  const token = match[1];      // e.g. "next" or "ROUTER-NEXT"

  // Normalise to lowercase for alias lookup (case-insensitive).
  const lowerToken = token.toLowerCase();

  // Try direct router name first (e.g. "$router-next" → "router-next").
  let resolvedSkill = null;
  if (lowerToken.startsWith('router-') && knownNames.has(lowerToken)) {
    resolvedSkill = lowerToken;
  } else if (knownNames.has(`router-${lowerToken}`)) {
    resolvedSkill = `router-${lowerToken}`;
  } else if (ROUTER_ALIASES[lowerToken]) {
    resolvedSkill = ROUTER_ALIASES[lowerToken];
  }

  // Reject if the resolved router is not in the known skill set.
  if (!resolvedSkill || !knownNames.has(resolvedSkill)) {
    return null;
  }

  // Strip the $mention from the prompt to produce cleanedPrompt.
  const cleanedPrompt = prompt.replace(rawMention, '').trim();

  return {
    skill: resolvedSkill,
    matchedText: rawMention,
    cleanedPrompt,
  };
}
