/**
 * doctor — Diagnostic report for the Skill Router installation.
 *
 * Usage: node bin/skill-router.mjs doctor
 *
 * Reports:
 *   - Detected ZCode directory and writability
 *   - Node version and OS
 *   - Corpus size, index size, thresholds
 *   - Last sync timestamp
 *   - Benchmark baseline numbers
 *   - Override environment variables
 *
 * This command is READ-ONLY — it never modifies any files.
 */
import { resolve, join } from 'node:path';
import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { getDefaults } from '../config/defaults.mjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

function section(title) {
  console.log('');
  console.log(`── ${title} ───────────────────────────────────────────────────────────`);
}

function row(label, value) {
  const padded = label.padEnd(28);
  console.log(`  ${padded} ${value}`);
}

function countSkillFiles(dir) {
  if (!existsSync(dir)) return 0;
  let count = 0;
  function walk(d, depth) {
    if (depth > 6) return;
    try {
      const entries = readdirSync(d, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (entry.isFile() && entry.name === 'SKILL.md') {
          count++;
        }
      }
    } catch {
      // skip
    }
  }
  walk(resolve(dir), 0);
  return count;
}

function isWritable(dir) {
  if (!existsSync(dir)) return 'N/A (does not exist)';
  try {
    const testPath = join(dir, '.doctor-write-test.tmp');
    writeFileSync(testPath, '', 'utf-8');
    unlinkSync(testPath);
    return 'yes';
  } catch {
    return 'no';
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function main() {
  console.log('');
  console.log('  skill-router — Diagnostic Report');
  console.log('  Generated: ' + new Date().toISOString());

  // ── Environment ────────────────────────────────────────────────────────────
  section('Environment');

  row('Node version', process.version);
  row('Platform', `${process.platform} ${process.arch}`);
  row('OS version', process.version);
  row('Process cwd', process.cwd());

  // ── ZCode directory ────────────────────────────────────────────────────────
  section('ZCode Integration');

  const zcodeDir = process.env.SKILL_ROUTER_ZCODE_DIR
    ? resolve(process.env.SKILL_ROUTER_ZCODE_DIR)
    : join(homedir(), '.zcode', 'skills');

  row('ZCode skills dir', zcodeDir);
  row('Exists', existsSync(zcodeDir) ? 'yes' : 'no');
  row('Writable', isWritable(zcodeDir));

  // ── Corpus ─────────────────────────────────────────────────────────────────
  section('Corpus');

  const skillsDir = resolve('data/skills');
  const corpusCount = countSkillFiles(skillsDir);
  row('Skills directory', skillsDir);
  row('SKILL.md count', String(corpusCount));

  // Index size
  const indexPath = resolve('data/skill-index.json');
  if (existsSync(indexPath)) {
    try {
      const idxContent = readFileSync(indexPath, 'utf-8');
      const index = JSON.parse(idxContent);
      const indexCount = Array.isArray(index) ? index.length : 0;
      row('Index entries', String(indexCount));
      row('Index file size', `${Math.round(idxContent.length / 1024)} KB`);
    } catch {
      row('Index entries', '(malformed)');
    }
  } else {
    row('Index file', 'not found');
  }

  // ── Thresholds ─────────────────────────────────────────────────────────────
  section('Thresholds');

  const thresholdsPath = resolve('data/thresholds.json');
  if (existsSync(thresholdsPath)) {
    try {
      const raw = readFileSync(thresholdsPath, 'utf-8');
      const data = JSON.parse(raw);
      row('High threshold', String(data.high));
      row('Medium threshold', String(data.medium));
      if (data.benchmark) {
        row('Benchmark Top-1', `${(data.benchmark.top1 * 100).toFixed(1)}%`);
        row('Benchmark fallback', `${(data.benchmark.fallbackRate * 100).toFixed(1)}%`);
      }
      if (data.optimizedAt) {
        row('Optimized at', data.optimizedAt);
      }
    } catch {
      row('Thresholds', '(malformed JSON)');
    }
  } else {
    const defaults = getDefaults();
    row('High threshold', 'NOT SET (default: 0.85)');
    row('Medium threshold', 'NOT SET (default: 0.60)');
  }

  // ── Sync state ─────────────────────────────────────────────────────────────
  section('Sync State');

  const statePath = join(process.cwd(), '.skill-router-sync-state.json');
  if (existsSync(statePath)) {
    try {
      const stateContent = readFileSync(statePath, 'utf-8');
      const state = JSON.parse(stateContent);
      row('Last sync', state.lastSyncAt ?? 'never');
      row('Mirror path', state.mirrorPath ?? '(none recorded)');
      row('Tracked skills', Object.keys(state.skills || {}).length);
    } catch {
      row('Sync state', '(malformed)');
    }
  } else {
    row('Last sync', 'never (no state file)');
    row('Mirror path', '(not yet synced)');
  }

  // ── Benchmark baseline ─────────────────────────────────────────────────────
  section('Benchmark Baseline');

  if (existsSync(thresholdsPath)) {
    try {
      const raw = readFileSync(thresholdsPath, 'utf-8');
      const data = JSON.parse(raw);
      if (data.benchmark) {
        row('Top-1 accuracy', `${(data.benchmark.top1 * 100).toFixed(1)}%`);
        row('Fallback rate', `${(data.benchmark.fallbackRate * 100).toFixed(1)}%`);
        row('Grid evaluations', String(data.benchmark.gridEvaluated));
        row('Optimization time', `${data.benchmark.elapsedMs} ms`);
      } else {
        row('Top-1 accuracy', 'no benchmark data in thresholds.json');
      }
    } catch {
      row('Benchmark', '(could not read)');
    }
  } else {
    row('Top-1 accuracy', 'unknown (no thresholds.json)');
  }

  // ── Environment overrides ──────────────────────────────────────────────────
  section('Environment Overrides');

  const skEnvVars = Object.entries(process.env)
    .filter(([key]) => key.startsWith('SKILL_ROUTER_'))
    .sort(([a], [b]) => a.localeCompare(b));

  if (skEnvVars.length === 0) {
    row('SKILL_ROUTER_* vars', '(none set)');
  } else {
    for (const [key, value] of skEnvVars) {
      // Mask anything that looks like a path with secrets
      const display = value.includes('zcode') || value.includes('.zcode')
        ? value.replace(/[^/\\]*zcode[^/\\]*/g, '***')
        : value;
      row(key, display);
    }
  }

  // ── Default config values ──────────────────────────────────────────────────
  section('Config Defaults');

  const defaults = getDefaults();
  row('BM25 k1', String(defaults.bm25.k1));
  row('BM25 b', String(defaults.bm25.b));
  row('Embedding dims', String(defaults.embeddings.dimensions));
  row('RRF k', String(defaults.rrf.k));
  row('Timeout ms', String(defaults.hook.timeoutMs));
  row('Max prompt length', String(defaults.hook.maxPromptLength));
  row('Budget max chars', String(defaults.budget.maxChars));
  row('Budget min/skill', String(defaults.budget.minPerSkill));

  console.log('');
}
