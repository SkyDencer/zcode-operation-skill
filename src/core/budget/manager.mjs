/**
 * Context budget manager for the route hook.
 *
 * Given a list of ranked skills with their markdown content, selects
 * entries so the total injected context fits within a hard character
 * budget. P6-H-002: when the budget is tight, skills are DROPPED whole,
 * never truncated — the highest-scoring skills are kept first, and the
 * total of the selected content is guaranteed ≤ maxChars (the old
 * truncate-to-quota path could exceed the budget because the per-skill
 * floor multiplied by the skill count was never checked against the
 * total).
 */
const DEFAULT_MAX_CHARS = 24000;

/**
 * Select skill content to fit within the context budget.
 *
 * Algorithm:
 * 1. If total raw content is already under the budget, return all entries
 *    unmodified (original order).
 * 2. Otherwise, order by score (descending; items without a score sort
 *    last, stable) and greedily include whole skills while the running
 *    total fits under maxChars. The first skill that does not fit — and
 *    everything after it — is dropped. Nothing is ever truncated.
 *
 * `rejected` is true when even the highest-scoring skill alone exceeds
 * the budget: in that case nothing is selected and the caller (the hook)
 * stays fail-open with an empty context.
 *
 * @param {Array<{name:string, content:string, score?:number}>} skills
 *   Each element: { name: string, content: string, score?: number }
 * @param {object} [options]
 * @param {number} [options.maxChars] — hard total budget (default 24000)
 * @returns {{ selected: Array<{name:string, content:string}>, totalChars: number, droppedCount: number, rejected: boolean }}
 */
export function fitWithinBudget(skills, options = {}) {
  const maxChars = typeof options.maxChars === 'number' && options.maxChars > 0
    ? Math.floor(options.maxChars)
    : DEFAULT_MAX_CHARS;

  if (!Array.isArray(skills) || skills.length === 0) {
    return { selected: [], totalChars: 0, droppedCount: 0, rejected: false };
  }

  // Compute raw total
  const rawTotal = skills.reduce((sum, s) => sum + s.content.length, 0);

  // If under budget, return everything as-is
  if (rawTotal <= maxChars) {
    return {
      selected: skills.map((s) => ({ name: s.name, content: s.content })),
      totalChars: rawTotal,
      droppedCount: 0,
      rejected: false,
    };
  }

  // P6-H-002: over budget — greedy drop, highest score first. Sort is
  // stable, so tied scores keep the caller's (ranking) order.
  const ranked = [...skills].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const selected = [];
  let totalChars = 0;
  for (const s of ranked) {
    if (totalChars + s.content.length > maxChars) break;
    selected.push({ name: s.name, content: s.content });
    totalChars += s.content.length;
  }

  return {
    selected,
    totalChars,
    droppedCount: skills.length - selected.length,
    rejected: selected.length === 0,
  };
}

/**
 * Default exports for convenience.
 */
export const defaultMaxChars = DEFAULT_MAX_CHARS;
