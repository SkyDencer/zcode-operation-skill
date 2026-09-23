/**
 * Update expected-routes.json to match new domain-prefixed skill names.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SKILLS_DIR = resolve('data/skills');
const EXPECTED_PATH = resolve('tests/expected-routes.json');

const nameMap = {};

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.name === 'SKILL.md') {
      const content = readFileSync(full, 'utf-8');
      const m = content.match(/^---\s*\n([\s\S]+?)\n---\s*\n?/);
      if (m) {
        const body = m[1].replace(/\r/g, '');
        const result = {};
        let currentKey = null;
        let currentList = [];
        for (const line of body.split('\n')) {
          const lm = line.match(/^\s*-\s+(.+)$/);
          if (lm && currentKey) {
            currentList.push(lm[1].trim());
            continue;
          }
          if (currentKey && currentList.length > 0) {
            result[currentKey] = currentList;
            currentList = [];
          }
          const kv = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
          if (kv) {
            const k = kv[1];
            const v = kv[2].trim();
            if (v === '') {
              currentKey = k;
              currentList = [];
            } else {
              result[k] = v;
              currentKey = null;
            }
          }
        }
        if (currentKey && currentList.length > 0) {
          result[currentKey] = currentList;
        }
        const parts = full.split('/');
        const oldName = parts[parts.length - 2];
        nameMap[oldName] = result.name || oldName;
      }
    }
  }
}

walk(SKILLS_DIR);

const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf-8'));
let updated = 0;
for (const e of expected) {
  if (e.expected && typeof e.expected === 'string' && !String(e.expected).startsWith('multi:')) {
    const newName = nameMap[e.expected];
    if (newName && newName !== e.expected) {
      e.expected = newName;
      updated++;
    }
  }
}

writeFileSync(EXPECTED_PATH, JSON.stringify(expected, null, 2), 'utf-8');
console.log(`Updated ${updated} expected routes`);
