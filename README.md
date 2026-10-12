---
title: pou
description: A dependency-free project operations CLI for Windows and WSL
---

`pou` is deterministic project tooling for humans and agents. Install one engine, configure each project independently, and use the same commands to obtain readiness and execution evidence. 

## Requirements and capabilities

The base runtime requires only Node.js 18 or newer and uses no third-party packages. Installation from GitHub requires npm, Git, and repository access.

| Command        | Capability                                               |
|----------------|----------------------------------------------------------|
| `help`         | Discover actual commands; `help <verb>` does not run them |
| `instructions` | Read core or per-command operating contracts              |
| `version`      | Identify the installed engine/runtime                     |
| `init`         | Create missing project-local configuration and guidance   |
| `doctor`       | Measure required and optional readiness probes            |
| `observe`      | Persist one friction observation in the configured repo   |

Base is the generic default, with no build/test/boot commands. One optional `dotnet` profile supplies explicit build/test/checks operations. 

Read [configuration and proof contracts](./docs/configuration.md) before adding commands.

## Install

Install directly from a local clone:

```text
npm install -g "C:/path/to/pou"
pou version --json
```

With npm's default local-folder installation, the global command links to that folder. Source edits take effect immediately, and the clone must stay in place.

Alternatively, install from GitHub:

```text
npm install -g "git+https://github.com/Calvnhd/pou.git"
pou version --json
```

A global install lives under npm's global prefix, not the consuming repo. Find it with `npm prefix -g` and `npm root -g`. 


## Adopt a project

Change to the intended project root using your shell, then:

```text
pou init
pou help
pou instructions
pou doctor --json
pou observe "Describe a symptom and consequence"
```

Edit `pou.config.mjs` to select a profile or add project commands. Initialization also creates missing `AGENTS.md` and `.pou/friction.md`; it does not merge existing agent guidance. Each repo has its own configuration and friction log. The engine selects only the current directory's configuration.

`init` intentionally initializes the selected directory even without Git, so check your location first. It never overwrites existing config, guidance, or logs. General discovery works outside configured projects; project operations cannot fall back to another repo.

## Development

Run the core checks from this folder after changing pou:

```text
npm run smoke
npm test
```

When changing or piloting the .NET profile, also run `npm run test:integration`. It requires a .NET SDK 8 or newer, the xUnit template, and access to restore its test dependencies using your configured NuGet sources.

## Maintenance

Improve the engine or add profiles when actual use identifies repeated friction. Global engine changes affect all repos using that installation, but do not replace their local configuration, guidance, or friction logs.
