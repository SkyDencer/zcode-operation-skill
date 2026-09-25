/**
 * Shared source resolution for the two index builders.
 *
 * `hooks/build-index.mjs` (install/build entry point) and `src/cli/reindex.mjs`
 * (CLI entry point) both write `data/skill-index.json`. They MUST resolve the
 * same default corpus, otherwise whichever ran last silently changes the
 * deployed index. The canonical project corpus is:
 *
 *   data/skills/     -- 54 leaf skills
 *   router-skills/   --  6 router-* dispatcher skills (explicit $mention path)
 *
 * `router-skills/` is part of the project source (tagged `source: "project"`),
 * not a separate user source. Before this helper existed, `reindex` defaulted to
 * `data/skills` only and dropped all six router entries, which broke the
 * `tests/tuning/optimizer.test.mjs` corpus assertions.
 */
import { resolve } from 'node:path';

/**
 * Resolve the default project source list (leaf skills + router dispatchers).
 *
 * Paths are resolved against the process cwd, matching the historical
 * behaviour of both index builders (which are always invoked from the plugin
 * root). Missing directories are skipped by the callers, so this stays usable
 * in trimmed checkouts.
 *
 * @returns {Array<{path: string, source: 'project'}>} default project sources
 */
export function projectSources() {
  return [
    { path: resolve('data/skills'), source: 'project' },
    { path: resolve('router-skills'), source: 'project' },
  ];
}
