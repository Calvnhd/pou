#!/usr/bin/env node
// Entry point for the `pou` project operations engine.
// Kept thin on purpose: all logic lives in ../lib so it is testable/importable.
import { main } from '../lib/cli.mjs';
import { failure, renderEnvelope } from '../lib/output.mjs';

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error) => {
    renderEnvelope(failure('pou', error), process.argv.includes('--json'));
    process.exit(1);
  });
