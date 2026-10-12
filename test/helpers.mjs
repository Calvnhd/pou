import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const cli = process.env.POU_TEST_CLI ?? join(root, 'bin', 'pou.mjs');

export function workspace(t) {
  const currentDirectory = mkdtempSync(join(tmpdir(), 'pou-test-'));
  t.after(() => rmSync(currentDirectory, { recursive: true, force: true }));
  return currentDirectory;
}

export function config(currentDirectory, source) {
  writeFileSync(join(currentDirectory, 'pou.config.mjs'), source);
}

export function invoke(currentDirectory, commandArguments, options = {}) {
  const result = spawnSync(process.execPath, [cli, '--json', ...commandArguments], {
    cwd: currentDirectory, encoding: 'utf8', timeout: 30_000, ...options,
  });
  if (result.error) throw result.error;
  return { ...result, envelope: JSON.parse(result.stdout) };
}
