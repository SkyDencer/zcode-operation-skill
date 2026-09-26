/**
 * Set-Recall scoring for the benchmark harness (tests/run-benchmark.mjs).
 *
 * `tests/run-benchmark.mjs` reports Top-1 and Recall@3, which only cover the
 * best position and the first three positions of a ranking. The Phase 6
 * embedding decision (Sub-Phase 6.10) is written against **Set Recall**: the
 * fraction of a prompt's expected skills that the router actually surfaced.
 * This module computes it so every mode in the comparison table is graded the
 * same way.
 *
 * Conventions, matching tests/slm-benchmark/runner.mjs so the two harnesses
 * report comparable numbers:
 *
 *   - The returned set is the top `topK` (default 5) names of the ranking.
 *     `rankSkills()` emits an entry for every indexed skill, so an unbounded
 *     "returned set" would make Set Recall trivially 1.0 for every mode.
 *   - A prompt with no expected skill (a negative prompt: `expected === null`)
 *     has an empty expected set. Its recall is 1 when the router abstained
 *     and 0 when it surfaced skills, i.e. it scores the abstention decision,
 *     not a skill lookup.
 *   - `multi:<domain>,<domain>` expectations expand to every indexed skill in
 *     the named domains, matching the Recall@3 rule in the harness.
 *
 * @module tests/benchmark/metrics
 */

/**
 * Expand an expected value into the set of skill names it stands for.
 *
 * @param {string|null} expected — raw value from tests/expected-routes.json
 * @param {Array<object>} index — the skill index
 * @returns {Set<string>} expected skill names (empty for negative prompts)
 */
export function expectedSetFor(expected, index) {
  if (expected === null || expected === undefined) return new Set();
  const raw = String(expected);
  if (!raw.startsWith('multi:')) return new Set([raw]);
  const names = new Set();
  for (const domain of raw.replace('multi:', '').split(',').map((d) => d.trim())) {
    for (const skill of index) {
      if ((skill.domains || []).includes(domain)) names.add(skill.name);
    }
  }
  return names;
}

/**
 * Grade one prompt.
 *
 * @param {string|null} expected — raw expected value
 * @param {string[]} topNames — names of the returned ranking, best first
 * @param {boolean} abstained — true when the router surfaced nothing
 * @param {Array<object>} index — the skill index (for `multi:` expansion)
 * @param {number} [topK=5] — how many returned names count as "surfaced"
 * @returns {{recall:number, kind:'skill'|'negative', matched:number, expectedCount:number}}
 */
export function gradePrompt(expected, topNames, abstained, index, topK = 5) {
  const expectedSet = expectedSetFor(expected, index);
  const returned = new Set(topNames.slice(0, topK));
  if (expectedSet.size === 0) {
    return {
      recall: abstained ? 1 : 0,
      kind: 'negative',
      matched: 0,
      expectedCount: 0,
    };
  }
  let matched = 0;
  for (const name of expectedSet) {
    if (returned.has(name)) matched++;
  }
  return {
    recall: matched / expectedSet.size,
    kind: 'skill',
    matched,
    expectedCount: expectedSet.size,
  };
}

/**
 * Aggregate per-prompt Set Recall grades.
 *
 * `setRecall` is the mean over all prompts (negative prompts included, as a
 * single 1/0 each). `setRecallSkillPrompts` restricts the mean to the prompts
 * that name a skill, which is the figure the ONNX-vs-FNV-1a decision in
 * Sub-Phase 6.10 is written against.
 *
 * @param {Array<{setRecall:number, setKind:string}>} rows
 * @returns {{setRecall:number, setRecallSkillPrompts:number, skillPrompts:number, skillHits:number, negativePrompts:number, negativeHits:number}}
 */
export function summarizeSetRecall(rows) {
  const total = rows.length;
  const skillRows = rows.filter((r) => r.setKind === 'skill');
  const negRows = rows.filter((r) => r.setKind === 'negative');
  const mean = (arr) => (arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length);
  const skillHits = skillRows.filter((r) => r.setRecall === 1).length;
  const negativeHits = negRows.filter((r) => r.setRecall === 1).length;
  return {
    setRecall: Number(mean(rows.map((r) => r.setRecall)).toFixed(4)),
    setRecallSkillPrompts: Number(mean(skillRows.map((r) => r.setRecall)).toFixed(4)),
    skillPrompts: skillRows.length,
    skillHits,
    negativePrompts: negRows.length,
    negativeHits,
  };
}
