/**
 * help — Show usage information.
 *
 * Usage: node bin/skill-router.mjs help
 */
export function main() {
  console.log(`skill-router — Skill Router management CLI
============================================

Usage:
  node bin/skill-router.mjs <subcommand> [options]

Subcommands:
  list       List all skills grouped by domain with quality scores
  add        Add a new skill from a SKILL.md file
  remove     Remove a skill by name
  validate   Run the quality validator on all skills
  reindex    Rebuild the BM25 index and embeddings
  benchmark  Run the benchmark suite
  stats      Show corpus statistics (counts, domains, keywords)
  analytics  Show usage analytics from routing logs
  import     Bulk import skills from a directory
  sync       Sync project skills to the ZCode mirror
  deploy     Deploy router skills to the ZCode mirror
  sources    List current sources and skill counts
  verify     Health check: sync drift, orphans, index integrity, thresholds
  doctor     Diagnostic report: environment, corpus, benchmarks, overrides
  help       Show this help message

Examples:
  node bin/skill-router.mjs list
  node bin/skill-router.mjs validate
  node bin/skill-router.mjs reindex
  node bin/skill-router.mjs add ./my-new-skill/SKILL.md
  node bin/skill-router.mjs remove backend-my-skill
  node bin/skill-router.mjs stats
  node bin/skill-router.mjs benchmark --mode bm25
  node bin/skill-router.mjs verify
  node bin/skill-router.mjs doctor

Options:
  --skills-dir <dir>   Override the default skills directory (default: data/skills)
  --dry-run            Preview changes without applying them
  --json               Output results as JSON (validate command)

Skills directory structure:
  data/skills/<domain>/<subdomain>/<skill-name>/SKILL.md
`);
}
