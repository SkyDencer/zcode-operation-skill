#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const BASE = resolve('.');
const TESTS_DIR = resolve(BASE, 'tests');

function findTestFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { recursive: true })) {
    if (typeof entry === 'string' && entry.endsWith('.mjs')) {
      files.push(join(dir, entry));
    }
  }
  return files.sort();
}

const testFiles = findTestFiles(TESTS_DIR);
let passed = 0, failed = 0;

console.log('Running ' + testFiles.length + ' .mjs file(s) under tests/\n');

for (const tf of testFiles) {
  const rel = tf.replace(BASE + '/', '');
  try {
    const out = execFileSync('node', [tf], { encoding: 'utf8', maxBuffer: 10*1024*1024, timeout: 120000 });
    let m = out.match(/Passed:\s*(\d+)\s*\n\s*Failed:\s*(\d+)/);
    if (!m) m = out.match(/Tests passed:\s*(\d+)\s*Tests failed:\s*(\d+)/);
    if (m) {
      const p = parseInt(m[1]), f = parseInt(m[2]);
      passed += p; failed += f;
      console.log((f > 0 ? 'FAIL ' : 'OK   ') + rel + ': ' + p + ' passed, ' + f + ' failed');
    } else {
      console.log('SKIP ' + rel + ' (no summary found)');
    }
  } catch(e) {
    failed++;
    console.log('ERR  ' + rel + ': ' + e.message.slice(0, 80));
  }
}

console.log('\n---');
console.log('Total: passed=' + passed + ', failed=' + failed);
process.exit(failed > 0 ? 1 : 0);
