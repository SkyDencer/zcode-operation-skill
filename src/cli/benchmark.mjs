/**
 * benchmark — Run the benchmark suite.
 *
 * Usage: node bin/skill-router.mjs benchmark [--mode <bm25|hybrid>] [--corpus <real|synthetic>] [--count <n>]
 */
import { resolve } from 'node:path';

export function main(argv) {
  const benchmarkScript = resolve('tests', 'run-benchmark.mjs');
  const args = ['--', benchmarkScript, ...argv];

  // Re-run benchmark with forwarded args
  // We spawn a new process since run-benchmark.mjs is a standalone script
  import('node:child_process').then(({ spawn }) => {
    const child = spawn(process.execPath, [benchmarkScript, ...argv], {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    child.on('close', (code) => {
      process.exit(code ?? 0);
    });
  }).catch((err) => {
    console.error(`Error running benchmark: ${err.message}`);
    process.exit(1);
  });
}
