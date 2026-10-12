---
title: Project configuration and operating contracts
description: Independent repo customization, command evidence, and trusted execution
---

## One engine, independent projects

Install the engine once. Run it from each project's root. Configuration is loaded only from the current directory.

Use `pou.config.mjs`, which `pou init` creates in your project root. Edit that file to select a profile or add commands. It is the only supported configuration filename. The examples below use `export default` to provide the configuration pou loads.

`pou init` creates missing `pou.config.mjs`, `AGENTS.md`, and `.pou/friction.md`. `pou observe` appends to that project-local friction log.

Initialization preserves existing files. If your repo already has agent guidance, add the pou workflow there yourself; initialization does not merge it.

The config tells pou which commands and readiness checks to use for this project. Editing it does not run anything; pou reads it when you invoke a command.

## Start with the generated config

This is the file `pou init` creates:

```javascript
export default {
  profile: 'base',
  params: {},
  verbs: {},
  doctor: [],
  briefings: {},
};
```

`export default` means "this is the configuration pou should load." Empty `{}` and `[]` mean you have not added any entries yet.

* `profile`: A built-in set of commands and readiness checks. `base` provides the basic pou workflow, with no build or test commands.
* `params`: Settings for the selected profile. Leave this empty for `base`.
* `verbs`: Your project commands. An entry named `test` creates a `pou test` command.
* `doctor`: Extra readiness checks to run with `pou doctor`, such as checking that a required tool is available.
* `briefings`: Descriptions of your project commands, available through `pou help <command>` and `pou instructions <command>`.

You can leave the generated config unchanged while trying `help`, `instructions`, `doctor`, and `observe`. It does not build or test your project yet.

## Add a project command

For example, if your project already runs its tests with `npm test`, change `verbs` from `{}` to the entry shown below. Everything else stays the same:

```javascript
export default {
  profile: 'base',
  params: {},
  verbs: {
    test: 'npm test',
  },
  doctor: [],
  briefings: {},
};
```

Now running `pou test` runs `npm test` from your project root and reports whether it succeeded. Replace `npm test` with your project's actual test command. Pou does not install or configure the underlying test tool.

Command names are your choice: `build: 'npm run build'` would add `pou build`. An array of command strings runs them in order and stops at the first failure. Add only commands you actually need.

## Use pou with a .NET project

With the .NET SDK installed, select `dotnet` to add build/test commands alongside the basic pou commands:

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

* `pou build` runs `dotnet build` on `buildTarget`.
* `pou test` runs `dotnet test` on `testProject` using `testFramework`, then checks the results.
* `pou checks` builds, then tests; it stops if the build fails.


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

Add `briefings.<verb>` with nonempty strings for `summary`, `purpose`, `inputs`, `prerequisites`, `sideEffects`, `outputs`, `recovery`, and `proofBoundary`. Read it with `pou instructions <verb>`.

Replacing a verb without replacement metadata invalidates its inherited briefing. It remains runnable, but instructions report the briefing unavailable. Do not inherit a profile's proof claims for an unrelated replacement command.

## Results and trust boundary

| Status         | Exit | Meaning                                      |
|----------------|------|----------------------------------------------|
| `ok`           | 0    | Completed within the stated proof boundary   |
| `degraded`     | 0    | Optional or explicitly limited evidence      |
| `error`        | 1    | Invalid invocation or failed operation       |
| `unconfigured` | 2    | Missing required configuration/prerequisites |

Non-`ok` results include `error.code`, `error.message`, and `next_action`. Inspect targets, stages, and skips. A degraded result or zero exit alone does not satisfy a required gate. An interrupted run without a final envelope is incomplete.

Project modules, shell scripts, readiness checks, and function commands are trusted executable code, not sandboxed. They must not write directly to standard output, block the event loop, or create unmanaged child processes. Use `context.log` and the process helpers provided by pou. Helper time limits cannot forcefully terminate arbitrary synchronous JavaScript. Never treat this command-line tool as a permission boundary for deployment or other mutations.

## Cold-session workflow

1. Run `pou help` and `pou instructions`.
2. Read the relevant command briefing and run `pou doctor`.
3. Map the requested change to the smallest adequate check.
4. Run it and inspect measured scope and limitations.
5. Record symptoms and consequences with `pou observe`.
6. Review recurring friction and offer a tested improvement for human acceptance.

`init` never overwrites existing config, guidance, or logs. If your repo already has agent guidance, add the discovery/readiness workflow there yourself. Guidance is not an installed automatic hook. Friction capture is not proof that a lesson was implemented.
