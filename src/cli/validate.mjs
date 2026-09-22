/**
 * validate — Run the quality validator on all skills.
 *
 * Usage: node bin/skill-router.mjs validate [--skills-dir <dir>] [--json]
 */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { validateSkillsDir } from '../quality/validator.mjs';
import { reportValidation } from '../quality/reporter.mjs';

const SKILLS_DIR = resolve('data/skills');

export function main(argv) {
  let skillsDir = SKILLS_DIR;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--skills-dir' && argv[i + 1]) {
      skillsDir = resolve(argv[++i]);
    } else if (argv[i] === '--json') {
      json = true;
    }
  }

  if (!existsSync(skillsDir)) {
    console.error(`Skills directory not found: ${skillsDir}`);
    process.exit(1);
  }

  const results = validateSkillsDir(skillsDir);
  const valid = results.filter((r) => r.result.valid).length;
  const invalid = results.length - valid;

  if (json) {
    console.log(JSON.stringify({
      total: results.length,
      valid,
      invalid,
      results: results.map((r) => ({
        path: r.path.replace(skillsDir + '/', '').replace(/\\/g, '/'),
        valid: r.result.valid,
        score: r.result.score,
        issues: r.result.issues,
      })),
    }, null, 2));
    return;
  }

  console.log(`Validating skills in: ${skillsDir}`);
  console.log('');

  const report = reportValidation(results);
  console.log(report);

  console.log('');
  console.log('── Summary ─────────────────────────────────────────────────────────');
  console.log(`  Total skills: ${results.length}`);
  console.log(`  Valid:        ${valid}`);
  console.log(`  Issues:       ${invalid}`);
  console.log(`  Avg score:    ${Math.round(results.reduce((s, r) => s + r.result.score, 0) / results.length)}/100`);

  process.exit(invalid > 0 ? 1 : 0);
}
