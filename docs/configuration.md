---
title: Project configuration and operating contracts
description: Independent repo customization, command evidence, and trusted execution
---

## One engine, independent projects

Install the engine once globally on your machine. Run it from each project's root. Configuration is loaded only from the current directory.

`pou init` creates missing `pou.config.mjs`, `AGENTS.md`, and `.pou/friction.md`. Use `pou profiles` to list the available profiles, and `pou init <profile>` (for example `pou init dotnet`) to start from that profile's config. Initialization preserves existing files, so `pou init <profile>` does not change a `pou.config.mjs` that already exists. If `AGENTS.md` already exists, `pou init` appends a `# pou` section to it once (if not already present), leaving the existing content untouched.

Edit `pou.config.mjs` to select a profile or add commands. The config tells `pou` which commands and readiness checks to use for this project.


## Start with the generated config

This is the file `pou init` creates:

```javascript
export default {
  profile: 'base',
  verbs: {},
  doctor: [],
  briefings: {},
};
```

`export default` means "this is the configuration pou should load." Empty `{}` and `[]` mean you have not added any entries yet. Every key is optional.

* `profile`: A built-in set of commands and readiness checks. `base` provides the basic pou workflow. See [Profiles](#profiles).
* `verbs`: Your project commands. An entry named `test` creates a `pou test` command.
* `doctor`: Extra readiness checks to run with `pou doctor`.
* `briefings`: Descriptions of your project commands, available through `pou help <command>` and `pou instructions <command>`.

## Add a project command

For example, if your project already runs its tests with `npm test`, change `verbs` to the entry shown below:

```javascript
export default {
  profile: 'base',
  verbs: {
    test: 'npm test',
  },
  doctor: [],
  briefings: {},
};
```

Running `pou test` now runs `npm test` from your project root and reports whether it succeeded. Note that pou does not install or configure the underlying test tool.

Command names are your choice: `build: 'npm run build'` would add `pou build`. An array of command strings runs them in order and stops at the first failure. 

To document a new command for `pou help` and `pou instructions`, add a matching entry under `briefings`; see [Briefings and overrides](#briefings-and-overrides).

## Profiles

A profile is a ready-made set of commands and readiness checks. Select one with `profile` in `pou.config.mjs`. Layers apply in order: `base`, then the selected profile, then your config. Your `doctor` checks add to the inherited ones. A verb with the same name as an inherited verb replaces it.

The `params` key holds settings for the selected profile. Only profiles that take settings need it.

| Profile  | Adds                                                | Settings (`params`) |
|----------|-----------------------------------------------------|---------------------|
| `base`   | Readiness checks for Node, config, and profile      | None                |
| `dotnet` | `build`, `test`; SDK and target checks             | See below           |

### base

The default. It adds no project commands, only the `doctor` checks that confirm Node.js 18+, a present config, and the loaded profile. Add your own commands under `verbs`.

### dotnet

With the .NET SDK installed, select `dotnet` to add build/test commands alongside the base ones:

```javascript
export default {
  profile: 'dotnet',
  params: {
    buildTarget: 'Engine.sln',
    testProject: 'tests/Engine.Tests/Engine.Tests.csproj',
    testFramework: 'net9.0',
  },
};
```

Replace the paths and framework with your own. Paths are relative to your project root.

| Param           | Required for     | Meaning                                                  |
|-----------------|------------------|----------------------------------------------------------|
| `buildTarget`   | build            | One `.csproj`, `.sln`, or `.slnx` to build               |
| `testProject`   | test             | One test `.csproj`                                       |
| `testFramework` | test             | One target framework, for example `net9.0`               |
| `configuration` | Optional         | Build configuration; defaults to `Debug`                 |
| `timeoutMs`     | Optional         | Positive integer time limit for each dotnet command      |

* `pou build` runs `dotnet build` on `buildTarget`.
* `pou test` runs `dotnet test` on `testProject` using `testFramework`, then checks the results.
* `pou doctor` also checks the .NET SDK and that `buildTarget` resolves.

To customize, change `params`, add your own commands or `doctor` checks, or replace a profile command by defining a verb with the same name. A replacement needs its own `briefings` entry, or its briefing is reported unavailable.


## Write a command in JavaScript

Most commands can be strings such as `test: 'npm test'`. Use a JavaScript function instead when you need your own logic. You can skip this section for basic setup.

This example adds `pou location`, which reports the folder pou is running in:

```javascript
export default {
  verbs: {
    location: (context) => {
      return { folder: context.currentDirectory };
    },
  },
};
```

`location` is the command name. Pou calls the function and gives it `context`, an object containing project information and helper functions. `context.currentDirectory` is the folder where you ran pou.

`return` gives the result back to pou, which displays it as a successful result. This example only reports information; it does not run another tool or change files.

## Briefings and overrides

Add `briefings.<verb>` to describe a command. A briefing is optional. If you write one, every field below must be a nonempty string otherwise the config will be rejected. A briefing with no matching verb is rejected. Replacing a verb without replacement metadata invalidates its inherited briefing. 

Read a briefing with `pou instructions <verb>`.

| Field           | What to put in it                                                  |
|-----------------|--------------------------------------------------------------------|
| `summary`       | One line shown in `pou help`                                       |
| `purpose`       | What the command does                                              |
| `inputs`        | Arguments and config it reads, such as `[--json]` or a `params` key |
| `prerequisites` | Tools or setup that must exist before it runs                      |
| `sideEffects`   | What it changes: files written, packages restored, processes run   |
| `outputs`       | What it reports back                                               |
| `recovery`      | What to do when it fails                                           |
| `proofBoundary` | What a success does and does not prove                             |

For example, a briefing for `test: 'npm test'`:

```javascript
briefings: {
  test: {
    summary: 'Run the unit tests',
    purpose: 'Run the project unit tests with npm.',
    inputs: 'None.',
    prerequisites: 'Node.js and installed npm dependencies.',
    sideEffects: 'None beyond whatever the tests write.',
    outputs: 'Pass or fail from the npm exit code.',
    recovery: 'Fix the failing tests, then rerun.',
    proofBoundary: 'Unit tests only; not integration or deployment.',
  },
},
```

## Results and trust boundary

| Status         | Exit | Meaning                                      |
|----------------|------|----------------------------------------------|
| `ok`           | 0    | Completed within the stated proof boundary   |
| `degraded`     | 0    | Optional or explicitly limited evidence      |
| `error`        | 1    | Invalid invocation or failed operation       |
| `unconfigured` | 2    | Missing required configuration/prerequisites |

Non-`ok` results include `error.code`, `error.message`, and `next_action`. Inspect targets, stages, and skips. A degraded result or zero exit alone does not satisfy a required gate. An interrupted run without a final envelope is incomplete.

Project modules, shell scripts, readiness checks, and function commands are trusted executable code, not sandboxed. They must not write directly to standard output, block the event loop, or create unmanaged child processes. Use `context.log` and the process helpers provided by pou. Helper time limits cannot forcefully terminate arbitrary synchronous JavaScript. Never treat this command-line tool as a permission boundary for deployment or other mutations.

## Agent guidance and friction

The recommended working order for humans and agents (discover, doctor, smallest check, observe, review) is in the `AGENTS.md` that `pou init` creates or extends, and in `pou instructions`.

`init` never overwrites existing config or logs, and only appends a `# pou` section to an existing `AGENTS.md`. Guidance is not an installed automatic hook. Friction capture is not proof that a lesson was implemented.
