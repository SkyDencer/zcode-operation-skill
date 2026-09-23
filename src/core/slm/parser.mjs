/**
 * Response parsers for the SLM (small language model) skill router.
 *
 * parseSingleSelection   — extracts one skill name from freeform text.
 * parseMultiSelection    — extracts a JSON multi-skill array, validates,
 *                          deduplicates, sorts, and caps at 7 results.
 */

/**
 * Parse a single best-match skill name from the model's raw response.
 *
 * Flow: trim whitespace, take first whitespace-delimited token, optionally
 * cross-check against knownSkills (but do NOT drop unknown names — the model
 * may use aliases). Return confidence 1.0 for any non-empty result.
 *
 * @param {string} raw — raw model response text
 * @param {string[]} knownSkills — list of valid skill names
 * @returns {{skill:string, confidence:number, raw:string}}
 */
export function parseSingleSelection(raw, knownSkills) {
  if (typeof raw !== 'string') return { skill: null, confidence: 0, raw: '' };

  const cleaned = raw.trim();
  if (cleaned === '') return { skill: null, confidence: 0, raw: cleaned };

  // Take the first whitespace-delimited token, strip trailing punctuation.
  const firstToken = cleaned.split(/\s+/)[0].replace(/[.,;:!?)\]>}]+$/, '');
  const skill = firstToken.replace(/[^a-zA-Z0-9\-_.]/g, '');

  if (!skill) return { skill: null, confidence: 0, raw: cleaned };

  return { skill, confidence: 1.0, raw: cleaned };
}

/**
 * Parse a multi-skill JSON response from the model.
 *
 * Flow:
 *  1. JSON.parse the raw text (try/catch returns empty on failure).
 *  2. Strip leading ```json / ``` fences if present.
 *  3. Extract the first { … } block via regex (ignores trailing commas).
 *  4. Validate skill names against knownSkills — drop unknowns.
 *  5. Drop entries with score < 0.5.
 *  6. Deduplicate by name, keeping the entry with the highest score.
 *  7. Sort descending by score.
 *  8. Cap at 7 entries.
 *  9. If nothing remains, return empty array.
 *
 * @param {string} raw — raw model response text
 * @param {string[]} knownSkills — list of valid skill names
 * @returns {{skills:Array<{name:string,score:number,reason:string}>, confidence:number, raw:string}}
 */
export function parseMultiSelection(raw, knownSkills) {
  const knownSet = new Set(knownSkills);

  if (typeof raw !== 'string') {
    return { skills: [], confidence: 0, raw: '' };
  }

  let text = raw.trim();
  if (text === '') return { skills: [], confidence: 0, raw: text };

  // Strip markdown JSON fences if present.
  text = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '');

  // Try direct JSON parse first.
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    // Fallback: extract first { … } block using regex.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { skills: [], confidence: 0, raw: text };
    try {
      obj = JSON.parse(match[0]);
    } catch {
      return { skills: [], confidence: 0, raw: text };
    }
  }

  const skills = Array.isArray(obj.skills) ? obj.skills : [];
  const confidence = typeof obj.confidence === 'number' ? obj.confidence : 0;

  // Validate names against known skills, drop unknowns and low-score entries.
  const valid = skills
    .filter((s) => s && typeof s === 'object')
    .filter((s) => knownSet.has(s.name))
    .filter((s) => typeof s.score === 'number' && s.score >= 0.5);

  // Deduplicate by name, keeping highest score.
  const bestBy = new Map();
  for (const s of valid) {
    const existing = bestBy.get(s.name);
    if (!existing || s.score > existing.score) {
      bestBy.set(s.name, s);
    }
  }

  // Sort descending by score.
  const sorted = [...bestBy.values()].sort((a, b) => b.score - a.score);

  // Cap at 7.
  const capped = sorted.slice(0, 7);

  // Shape the result.
  const result = capped.map((s) => ({
    name: s.name,
    score: Math.round(s.score * 100) / 100,
    reason: s.reason ?? '',
  }));

  return { skills: result, confidence, raw: text };
}
