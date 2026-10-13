---
title: Agent guidance
description: Guidance for agents working in this repository
---

# pou

`pou` is a project operations CLI that gives humans and agents a shared way to run this repo's commands, check readiness, and record friction. Always use `pou` commands instead of raw toolchain commands wherever possible. If additional commands are commonly needed during development, extend `pou.config.mjs` to include them.

## Base commands

* `pou version`: Report the installed pou version and Node runtime.
* `pou init [profile]`: Create `pou.config.mjs` (for the named profile, default `base`), `AGENTS.md`, and `.pou/friction.md` in the current directory. Preserve existing config and logs; append a pou section to existing `AGENTS.md` if absent.
* `pou profiles`: List the available profiles and which one this directory selects.
* `pou help [command]`: List available commands or describe one without executing it.
* `pou instructions [command]`: Read the general workflow, prerequisites, effects, limitations etc. for the specified command.
* `pou doctor`: Run configured readiness checks. These are not a substitute for project build or test checks.
* `pou observe "message"`: Append a one-line friction observation to `.pou/friction.md`.

Arguments in brackets are optional. Add `--json` for machine-readable results, or `--help` to read command help without running it.

## Use pou

Run from the repo root. Pou loads only that directory's `pou.config.mjs`. At the start of a work session:

* Discover commands with `pou help`.
* Read `pou instructions <command>` before using an unfamiliar command.
* Run `pou doctor` to check the repo's configured prerequisites. Resolve failures before running project checks.

When using commands during your work session:

* In pou's result, check `status`, reported targets, and skipped steps. Follow `next_action` when present. Success applies only to the checks that command actually ran.
* Exit codes: `ok` and `degraded` exit 0, `error` exits 1, and `unconfigured` exits 2. A zero exit or a `degraded` result alone is not proof.
* Whenever something slows you down or is harder than it should be, record it to the friction log with `pou observe "symptom and consequence"`.

When you finish a task:

* Review `.pou/friction.md` for recurring issues. Propose a small, tested improvement for human approval before changing shared tooling.

## Extend pou

* Add repo-specific commands under `verbs` in `pou.config.mjs`: shell command strings, arrays of commands, or JavaScript functions.
* Select a `profile` and configure its `params`. The `dotnet` profile adds `build` and `test` for explicitly selected targets.
* Add readiness checks under `doctor` and command descriptions under `briefings`.
* Layers merge in order: `base`, then the selected profile, then `pou.config.mjs`. Repo `doctor` checks add to the base and profile probes; they never replace them.
* A repo verb with the same name as a profile or base verb replaces it and its inherited briefing is dropped. Supply a matching `briefings` entry for all overridden verbs.
