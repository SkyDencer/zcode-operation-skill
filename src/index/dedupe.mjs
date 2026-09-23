/**
 * Deduplication for two-source skill indexing.
 *
 * When skills are loaded from both the project source and a ZCode user source,
 * name collisions can occur. This module resolves them with a priority rule:
 * project-sourced skills always win over zcode-user-sourced skills.
 */

const SOURCE_PRIORITY = {
  project: 2,
  'zcode-user': 1,
};

/**
 * Resolve name collisions across multi-source index entries.
 *
 * If the same skill name appears in both sources, the entry from the
 * higher-priority source is kept. Collision counts are logged to console.
 *
 * @param {Array<{name:string, description:string, keywords:string[], domains:string[], path:string, source:string}>} indexEntries
 * @returns {Array<{name:string, description:string, keywords:string[], domains:string[], path:string, source:string}>} deduplicatedIndex
 */
export function resolveCollisions(indexEntries) {
  const byName = new Map();
  const collisions = [];

  for (const entry of indexEntries) {
    const existing = byName.get(entry.name);
    if (!existing) {
      byName.set(entry.name, entry);
      continue;
    }

    // Collision detected — keep the higher-priority source
    const existingPriority = SOURCE_PRIORITY[existing.source] ?? 0;
    const newPriority = SOURCE_PRIORITY[entry.source] ?? 0;

    if (newPriority > existingPriority) {
      // New entry wins (e.g. project over zcode-user)
      collisions.push({
        name: entry.name,
        kept: entry.source,
        removed: existing.source,
        keptPath: entry.path,
        removedPath: existing.path,
      });
      byName.set(entry.name, entry);
    } else {
      // Existing entry wins (e.g. project already stored, new is lower priority)
      collisions.push({
        name: entry.name,
        kept: existing.source,
        removed: entry.source,
        keptPath: existing.path,
        removedPath: entry.path,
      });
    }
  }

  // Log collisions
  if (collisions.length > 0) {
    console.log(`\n[skill-router] Found ${collisions.length} name collision(s):`);
    for (const c of collisions) {
      console.log(`  "${c.name}": kept="${c.kept}" (${c.keptPath}), removed="${c.removed}" (${c.removedPath})`);
    }
    console.log('');
  }

  return Array.from(byName.values());
}
