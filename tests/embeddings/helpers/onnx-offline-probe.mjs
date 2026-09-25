/**
 * Offline probe for OnnxProvider, executed as a child process.
 *
 * Both scenarios below must fail without touching the network:
 *
 *   1. "local-only"  — `env.allowRemoteModels = false`, so the library never
 *      attempts a remote fetch and reports the model as missing.
 *   2. "fetch-mock"  — `env.fetch` is replaced with a function that always
 *      throws, simulating an offline machine. The library still tries to
 *      download, so the failure comes from the fetch layer.
 *
 * The provider is pointed at an empty temporary cache directory in both cases
 * so the machine-wide model cache (if the real model was ever downloaded) is
 * never read, and nothing is ever written to the real cache.
 *
 * Output: one `RESULT:<scenario>:<ok|error>:<name>:<message>` line per scenario.
 * Exits 0 when both scenarios failed as expected, 1 otherwise.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROVIDER_URL = pathToFileURL(
  resolve('src/core/embeddings/providers/onnx.mjs')
).href;

const transformers = await import('@huggingface/transformers');
const { OnnxProvider } = await import(PROVIDER_URL);
const { ProviderNotAvailableError } = await import(
  pathToFileURL(resolve('src/core/embeddings/errors.mjs')).href
);

const scenarios = ['local-only', 'fetch-mock'];
let failures = 0;

for (const scenario of scenarios) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'onnx-offline-'));
  transformers.env.allowRemoteModels = scenario === 'local-only' ? false : true;
  transformers.env.fetch =
    scenario === 'fetch-mock'
      ? async () => {
          throw new TypeError('fetch failed: simulated offline');
        }
      : transformers.env.fetch;

  const provider = new OnnxProvider({ cacheDir });
  try {
    await provider.downloadModel();
    console.log(`RESULT:${scenario}:ok:no-error:`);
    failures++;
  } catch (err) {
    const isProviderError = err instanceof ProviderNotAvailableError;
    if (!isProviderError) failures++;
    console.log(
      `RESULT:${scenario}:${isProviderError ? 'error' : 'wrong-error'}:` +
        `${err?.name ?? 'none'}:${err?.message ?? err}`
    );
  }
  rmSync(cacheDir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
