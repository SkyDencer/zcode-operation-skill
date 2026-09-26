# Corpus Licenses and Attribution

Every third-party `SKILL.md` under `data/skills/` came from one of the
repositories below. The machine-readable form of this file is
`data/corpus-sources.json`, which records the URL, the commit each fetch
actually cloned, the licence, the attribution and the exact number of skills
imported per source. The commit is recorded so a corpus can be rebuilt: the
fetch manifests under `tmp/src-*/corpus-fetch.json` are the fetch of record
and are only valid for the commit they were taken from.

The skills this project wrote itself — the 54 leaves under `data/skills/` from
`scripts/generate-skills.mjs` and the 6 `router-*` dispatchers under
`router-skills/` — carry the repository's own licence and are **not** listed
here. They are first-party, not third-party.

Every third-party source imported by Sub-Phase 7.3 is MIT. The MIT licence
permits redistribution provided the copyright notice and the permission
notice travel with the copies, which is why the notice is reproduced in full
at the end of this file.

## Sources imported

| Source | Commit | Licence | Copyright holder | Skills imported |
|---|---|---|---|---|
| [wshobson/agents](https://github.com/wshobson/agents) | `6161de4da816` | MIT | Copyright (c) 2024 Seth Hobson | 26 |
| [rshankras/claude-code-apple-skills](https://github.com/rshankras/claude-code-apple-skills) | `9ffb83138209` | MIT | Copyright (c) 2025 Ravishankar | 154 |
| [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills) | `19392f7a0826` | MIT | Copyright (c) 2025 Alireza Rezvani | 145 |
| [daymade/claude-code-skills](https://github.com/daymade/claude-code-skills) | `263842c7786f` | MIT | Copyright (c) 2025 daymade | 23 |
| [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills) | `882ef55e377d` | MIT | Copyright (c) 2025 Jeff Allan | 23 |
| [jezweb/claude-skills](https://github.com/jezweb/claude-skills) | `176df0f01dfb` | MIT | Copyright (c) 2025 Jeremy Dawes (Jezweb) | 32 |
| [mattpocock/skills](https://github.com/mattpocock/skills) | `c55ee46073ed` | MIT | Copyright (c) 2026 Matt Pocock | 24 |
| [Security-Phoenix-demo/security-skills-claude-code](https://github.com/Security-Phoenix-demo/security-skills-claude-code) | `40ace4aa7101` | MIT | Copyright (c) 2026 Security Skills Contributors | 2 |
| [zLanqing/codex-claude-academic-skills](https://github.com/zLanqing/codex-claude-academic-skills) | `7ed6377f0efb` | MIT | Copyright (c) 2026 zLanqing | 5 |
| [obra/superpowers](https://github.com/obra/superpowers) | `8ca22dba9a94` | MIT | Copyright (c) 2025 Jesse Vincent | 14 |
| [ab604/claude-code-r-skills](https://github.com/ab604/claude-code-r-skills) | `529de4fcfe68` | MIT | Copyright (c) 2025 ab604 | 8 |
| [EpicGames/unreal-engine-skills-for-claude-code-plugin](https://github.com/EpicGames/unreal-engine-skills-for-claude-code-plugin) | `a6aa73ada02a` | MIT | Copyright (c) 2026 Epic Games, Inc. | 0 |

`EpicGames/unreal-engine-skills-for-claude-code-plugin` contributed **0**
skills. All three of its `SKILL.md` files were fetched, inspected and dropped
because their descriptions fall outside the 40-400 character band the corpus
validator enforces. It is listed because it was fetched, not because it is
used.

The `skills imported` column counts what `corpus import` wrote after name
collisions were resolved: 592 skills were staged and 587 were written, because
five names exist in more than one source (`app-planner`,
`architecture-patterns`, `coding-best-practices`, `grill-me`,
`grill-with-docs`) and the first occurrence wins.

## Source fetched and deliberately NOT imported

| Source | Licence | Why it is excluded |
|---|---|---|
| [anthropics/skills](https://github.com/anthropics/skills) @ `33375500bcea` | **Proprietary.** (c) 2025 Anthropic, PBC. All rights reserved. | Not open source. Each skill's `LICENSE.txt` says use of the materials is governed by an agreement with Anthropic and, absent one, by the Anthropic Consumer or Commercial Terms of Service. Neither grants a right to redistribute. The repository has no top-level `LICENSE` and the GitHub API reports `license: null`. Its 20 skills were fetched and inspected, then excluded. Nothing from it is redistributed by this project, so no Anthropic attribution is owed. |

## What was changed in the imported files

Only one transformation was applied, and it is mechanical: a skill whose
frontmatter `name` did not match the router's `{domain}-{specific}` shape was
lowercased and had every run of non-alphanumeric characters collapsed to a
single hyphen. 127 of the 145 imported `alirezarezvani/claude-skills` skills
needed it, and every one of those 127 was a name that was merely
double-quoted (`name: "a11y-audit"` -> `name: a11y-audit`). No description was
written, no description was truncated, and no body was touched. Skills that
still failed `node bin/skill-router.mjs corpus validate` after that were
dropped rather than repaired — 987 in total, itemised in
`data/corpus-sources.json` under `skills_dropped_by`.

## Locally generated skills

None. Sub-Phase 7.3's fallback — extending the existing corpus with
`scripts/generate-skills.mjs` or `tests/scale/generate-synthetic.mjs` output —
was **not** used, because the network was available and the real sources
supplied 587 usable skills. Every skill under `data/skills/` that is not
listed in the table above is first-party work of this repository and carries
this repository's own licence, not a third-party one.

## The MIT licence, as the sources state it

Reproduced once; it covers all twelve imported sources.

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Note that the sources' own notice text uses the word "Software". The imported
material is Markdown skill definitions, not software, but the notice is
reproduced unaltered because the licence asks for it and changing it would
change the licence.

## Caveat this file does not resolve

The MIT notice above is reproduced once, here, rather than copied into each
of the 587 imported `SKILL.md` files. The MIT condition is normally read as
per-copy, and a reviewer may reasonably require the notice to travel with each
file. This pass did not do that: adding it would mean editing 587 third-party
files with content the upstream repositories did not put there, which the
Sub-Phase 7.3 brief forbids for fetched skills. Resolving it needs a decision
from the project owner — a bulk notice prepend, a `THIRD_PARTY_NOTICES`
convention, or an explicit acceptance of the single-copy reading above.
