import { readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { rankSkills, readSkillContent } from '../src/retriever.mjs';
import { logDecision } from '../src/logger.mjs';

const INDEX_PATH = resolve('data/skill-index.json');

/**
 * Build the additionalContext string from ranked skills.
 * @param {Array<{name:string, content:string}>} skillsWithContent
 * @returns {string}
 */
function buildContext(skillsWithContent) {
  if (skillsWithContent.length === 0) return '';
  const lines = ['== SKILL CONTEXT ==', ''];
  for (const s of skillsWithContent) {
    lines.push(`# ${s.name}`);
    lines.push('');
    lines.push(s.content.trim());
    lines.push('');
  }
  lines.push('== END SKILL CONTEXT ==');
  return lines.join('\n');
}

/**
 * Main entry point for the route hook.
 * Reads JSON from stdin, ranks skills, applies confidence policy, writes output.
 */
async function main() {
  let input = '';
  const chunks = [];

  // Read all stdin
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  input = Buffer.concat(chunks).toString('utf-8');

  if (!input.trim()) {
    process.exit(0);
  }

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const { prompt, cwd } = payload;

  if (!prompt || String(prompt).trim() === '') {
    process.exit(0);
  }

  const startTime = performance.now();

  let index;
  try {
    const raw = readFileSync(INDEX_PATH, 'utf-8');
    index = JSON.parse(raw);
  } catch {
    // Index not found — fail open
    process.exit(0);
  }

  const ranked = rankSkills(prompt, index);

  if (ranked.length === 0) {
    // No matches at all
    const latency = Math.round(performance.now() - startTime);
    await logDecision({
      timestamp: new Date().toISOString(),
      prompt,
      candidates: [],
      selected: null,
      mode: 'none',
      latency_ms: latency,
    });
    process.exit(0);
  }

  const topScore = ranked[0].score;
  let mode, selected, skillList;

  if (topScore >= 0.85) {
    mode = 'direct';
    selected = ranked[0];
    skillList = ranked.slice(0, 1);
  } else if (topScore >= 0.60) {
    mode = 'top-k';
    selected = ranked[0];
    skillList = ranked.slice(0, 3);
  } else {
    mode = 'none';
    selected = null;
    skillList = [];
  }

  const latency = Math.round(performance.now() - startTime);

  await logDecision({
    timestamp: new Date().toISOString(),
    prompt,
    candidates: ranked.map((r) => ({ name: r.skill.name, score: r.score })),
    selected: selected ? { name: selected.skill.name, score: selected.score } : null,
    mode,
    latency_ms: latency,
  });

  if (mode === 'none' || skillList.length === 0) {
    const output = {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: '',
      },
    };
    writeFileSync('D:/www/local/operation-skill/.zcode/output.json', JSON.stringify(output), 'utf-8');
    process.exit(0);
  }

  const skillsWithContent = await readSkillContent(skillList);
  const additionalContext = buildContext(skillsWithContent);

  const output = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext,
    },
  };

  // ZCode reads from a file in the workflow directory for output
  const outputPath = join(cwd || process.cwd(), '.zcode', 'output.json');
  try {
    const fs = await import('fs/promises');
    await fs.mkdir(join(process.cwd(), '.zcode'), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(output), 'utf-8');
  } catch {
    // Fallback: also write to stdout-compatible location
    writeFileSync('.zcode/output.json', JSON.stringify(output), 'utf-8');
  }

  process.exit(0);
}

// FAIL OPEN: catch everything
main().catch(() => {
  process.exit(0);
});
