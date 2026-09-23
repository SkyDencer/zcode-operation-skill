/**
 * Router alias mappings.
 *
 * Maps short user-facing aliases (e.g. `$next`) to their full router skill
 * names (e.g. `router-next`). Used by src/core/routing/explicit.mjs to
 * resolve `$-mentions` into concrete router skill identifiers.
 *
 * Only aliases whose target router skill exists in the deployed corpus are
 * valid; unknown aliases are silently ignored by detectExplicitSkill.
 *
 * @module src/config/aliases
 */

/**
 * Alias → full router-skill-name mapping.
 *
 * | Alias    | Router Skill  | Domain             |
 * |----------|---------------|--------------------|
 * | `next`   | `router-next` | frontend / Next.js |
 * | `react`  | `router-react`| frontend / React   |
 * | `laravel`| `router-laravel`| backend / Laravel  |
 * | `design` | `router-design` | design           |
 * | `test`   | `router-test` | testing            |
 * | `meta`   | `router-meta` | meta               |
 *
 * @type {Record<string, string>}
 */
export const ROUTER_ALIASES = {
  next: 'router-next',
  react: 'router-react',
  laravel: 'router-laravel',
  design: 'router-design',
  test: 'router-test',
  meta: 'router-meta',
};
