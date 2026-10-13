---
title: pou
description: A dependency-free project operations CLI for Windows and WSL
---

`pou` is deterministic project tooling for humans and agents. Install one engine, configure each project independently, and use the same commands to obtain readiness and execution evidence. 

## Requirements and capabilities

The base runtime requires only Node.js 18 or newer and uses no third-party packages. Installation from GitHub requires npm, Git, and repository access.

| Command        | Capability                                               |
|----------------|----------------------------------------------------------|
| `help`         | Discover commands without running them |
| `instructions` | Read core or per-command operating contracts              |
| `version`      | Identify the installed engine/runtime                     |
| `init`         | Create missing project-local configuration and guidance; `init <profile>` picks the starter |
| `profiles`     | List available profiles and the one this directory selects |
| `doctor`       | Measure required and optional readiness probes            |
| `observe`      | Persist one friction observation in the configured repo   |

Base is the generic default, with no build/test/boot commands. One optional `dotnet` profile supplies explicit build/test operations. Commands can be extended, added, or overridden. 

## Install

Install directly from a local clone:

```text
npm install -g "C:/path/to/pou"
pou version
```

With npm's default local-folder installation, the global command links to that folder. Source edits take effect immediately, and the clone must stay in place.

Alternatively, install from GitHub:

```text
npm install -g "git+https://github.com/Calvnhd/pou.git"
pou version --json
```

A global install lives under npm's global prefix, not the consuming repo. Find it with `npm prefix -g` and `npm root -g`. 


## Adopt a project

Navigate to the intended project root, then:

```text
pou profiles
pou init [optional-profile]
pou help
pou instructions
pou doctor
pou observe "Describe a symptom and consequence"
```

Each repo has its own configuration (`pou.config.mjs`) and friction log (`.pou/friction.md`), created during `pou init`. `AGENTS.md` with a `# pou` section is created, or appended if the file already exists. Existing files are otherwise left untouched. Edit `pou.config.mjs` to select a profile or add project commands. The engine selects only the current directory's configuration. Consult [the configuration docs](./docs/configuration.md) for more information.

## Development

Run the core checks from this folder after changing pou:

```text
npm run smoke
npm test
```

When changing the .NET profile, also run `npm run test:integration`. It requires a .NET SDK 8 or newer, the xUnit template, and access to restore its test dependencies using your configured NuGet sources.

## Maintenance

Improve the engine or add profiles when actual use identifies repeated friction. Global engine changes affect all repos using that installation, but do not replace their local configuration, guidance, or friction logs.
