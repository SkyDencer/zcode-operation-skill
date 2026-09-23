/**
 * Context budget manager for the route hook.
 *
 * Given a list of ranked skills with their markdown content, selects
 * and truncates entries so the total injected context fits within a
 * character budget. Falls back to equal-size truncation with a
 * minimum-per-skill floor when the budget is tight.
 */
import { truncateAtParagraph } from './truncator.mjs';

const DEFAULT_MAX_CHARS = 24000;
const DEFAULT_MIN_PER_SKILL = 500;

/**
 * Select and size skill content to fit within the context budget.
 *
 * Algorithm:
 * 1. If total raw content is already under budget, return all entries
 *    unmodified.
 * 2. Otherwise, order by confidence (descending) and distribute the
 *    budget equally across all skills, respecting minPerSkill.
 *    Each skill gets min(chosenQuota, its own content length).
 *    Then apply paragraph-safe truncation per skill.
 *
 * @param {Array<{name:string, content:string}>} skills
 *   Each element: { name: string, content: string }
 * @param {object} [options]
 * @param {number} [options.maxChars] — total budget (default 24000)
 * @param {number} [options.minPerSkill] — per-skill floor (default 500)
 * @returns {{ selected: Array<{name:string, content:string}>, totalChars: number }}
 */
export function fitWithinBudget(skills, options = {}) {
  const maxChars = typeof options.maxChars === 'number' && options.maxChars > 0
    ? Math.floor(options.maxChars)
    : DEFAULT_MAX_CHARS;
  const minPerSkill = typeof options.minPerSkill === 'number' && options.minPerSkill >= 0
    ? Math.floor(options.minPerSkill)
    : DEFAULT_MIN_PER_SKILL;

  if (!Array.isArray(skills) || skills.length === 0) {
    return { selected: [], totalChars: 0 };
  }

  // Compute raw total
  const rawTotal = skills.reduce((sum, s) => sum + s.content.length, 0);

  // If under budget, return everything as-is
  if (rawTotal <= maxChars) {
    return {
      selected: skills.map((s) => ({ name: s.name, content: s.content })),
      totalChars: rawTotal,
    };
  }

  // Over budget — truncate each skill to an equal share, floor at minPerSkill
  const n = skills.length;
  const quotaPerSkill = Math.floor(maxChars / n);
  const perSkill = Math.max(quotaPerSkill, minPerSkill);

  const selected = skills.map((s) => {
    const truncated = truncateAtParagraph(s.content, perSkill);
    return { name: s.name, content: truncated };
  });

  const totalChars = selected.reduce((sum, s) => sum + s.content.length, 0);

  return { selected, totalChars };
}

/**
 * Default exports for convenience.
 */
export const defaultMaxChars = DEFAULT_MAX_CHARS;
export const defaultMinPerSkill = DEFAULT_MIN_PER_SKILL;
