# AGENTS.md

`pou` is a small, dependency-free Node.js CLI that gives humans and agents the same deterministic project commands (`help`, `doctor`, `build`, `test`, and so on). A core engine plus per-language profiles (`base`, `dotnet`) is configured per project. 

## Project context

- Personal tool, unlikely to be used by anyone else. Skip broad-audience concerns: no deprecation periods, migration guides, backward-compatibility shims, or release ceremony. Breaking changes are fine.
- Platforms are Windows and WSL only. No macOS support or testing.
- Primary Windows shell is Cmder (not PowerShell) to stay consistent with WSL. Give commands in bash-style syntax, and avoid PowerShell-specific idioms in docs, scripts, and examples.
- Paths in docs and examples should work in both Windows and WSL (forward slashes where possible).

## Code conventions

- Node.js 18+, ES modules (`.mjs`), no third-party runtime dependencies.
- Tests use the built-in `node:test` runner. `npm test` runs unit tests. `npm run test:integration` needs a real .NET SDK.
- Test files live in `test/` and are named `<area>.test.mjs`. Shared helpers go in `test/helpers.mjs`.
- Every non-ok result must carry an error code, message, and `next_action`.
- A zero exit code alone is never proof. Do not report success without measured evidence.

## Output conventions

- Human-readable output is column aligned: pad labels, names, and verbs to the longest entry and separate columns with two spaces. Apply this to any new tabular or key/value output.
- Do not use `name: value` pairs where a list of aligned columns would read better.
- `--json` output is machine-readable, unpadded, and single-line. Human formatting changes must not alter it.
- Exit codes: ok/degraded 0, error 1, unconfigured 2.

## Change hygiene

- Keep changes minimal and focused. No speculative features or abstractions.
- Update [docs/configuration.md](docs/configuration.md) and [README.md](README.md) when behavior or contracts change.
- Add or adjust tests for behavior changes. Run `npm test` before finishing.
- Comments state only what the code cannot show, in one short line.
