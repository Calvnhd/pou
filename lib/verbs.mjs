import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeEnvelope, failure, PouError } from './output.mjs';

const brief = (summary, purpose, inputs, sideEffects, proofBoundary) => ({
  summary, purpose, inputs, sideEffects, proofBoundary,
  prerequisites: 'Node.js 18+. Project operations require configuration in the current directory.',
  outputs: 'One result envelope; --json selects machine output. ok/degraded exit 0, error 1, unconfigured 2.',
  recovery: 'Follow next_action; missing or limited measurements are not passing required proof.',
});

export const BRIEFINGS = {
  help: brief('Discover available commands', 'List actual built-in and configured verbs.', '[verb] [--json]', 'None.', 'Discovery does not execute checks.'),
  instructions: brief('Read command operating contracts', 'Explain prerequisites, inputs, effects, and proof limits.', '[verb] [--json]', 'None.', 'Instructions are guidance, not execution evidence or installed automation.'),
  version: brief('Identify installed release', 'Report the version and resolved runtime.', '[--json]', 'None.', 'Version identity is not a readiness check.'),
  doctor: brief('Check project readiness', 'Measure required and optional readiness probes.', '[--json]', 'Configured probes may execute commands; review repo configuration.', 'Readiness is not product correctness; repo JavaScript is trusted, not sandboxed.'),
  init: brief('Initialize this directory', 'Create missing config, guidance, and friction files.', '[--json]', 'Writes only missing project-local files. No Git-repo detection; select your directory deliberately.', 'Initialization does not create build/test/boot capabilities.'),
  observe: brief('Record project friction', 'Persist an observation in this project.', '"message" [--json]; use -- before a message starting with a dash', 'Appends .pou/friction.md; do not include secrets.', 'Captured friction is not an encoded or verified improvement.'),
};

export const builtins = {
  help(context, requested) {
    if (requested) {
      const briefing = BRIEFINGS[requested] ?? context.briefings[requested];
      if (!briefing && !Object.hasOwn(context.verbs, requested)) throw unknown(requested);
      return makeEnvelope('help', 'ok', { verb: requested, briefing: briefing ?? { note: 'Briefing unavailable for this repo-defined verb. Review its implementation before execution.' } });
    }
    return makeEnvelope('help', 'ok', {
      profile: context.profile, currentDirectory: context.currentDirectory, hasConfiguration: context.hasConfiguration,
      configurationError: context.configurationError?.message,
      commands: [...Object.keys(BRIEFINGS), ...Object.keys(context.verbs)].map((name) => ({
        name, summary: (BRIEFINGS[name] ?? context.briefings[name])?.summary ?? 'Repo-defined command',
        hasInstructions: !!(BRIEFINGS[name] ?? context.briefings[name]),
      })),
    });
  },

  instructions(context) {
    if (context.commandArguments.length > 1) throw new PouError('ARGUMENTS_INVALID', 'instructions accepts at most one verb', 'Use pou instructions [verb].');
    const name = context.commandArguments[0];
    if (!name) return makeEnvelope('instructions', 'ok', {
      purpose: 'Operate the configured project from its root using the same evidence-driven commands as a human or agent.',
      workflow: 'help -> instructions <verb> -> doctor -> smallest adequate check -> observe friction -> review and offer an encoded improvement',
      trust: 'Repo modules/functions are trusted code: no direct stdout, no event-loop blocking, and use managed helpers. No sandbox or automatic hooks.',
      proofBoundary: 'Inspect status, targets, completed/skipped stages, and next_action. A zero exit or degraded result alone is not required proof.',
      profiles: 'base (default, generic), dotnet (optional, explicit targets and VSTest/TRX contract)',
    });
    const briefing = BRIEFINGS[name] ?? context.briefings[name];
    if (!briefing) {
      if (!Object.hasOwn(context.verbs, name)) throw unknown(name);
      throw new PouError('BRIEFING_UNAVAILABLE', `No current briefing for ${name}`, 'Review the repo verb and add matching briefings metadata; do not infer inherited proof claims.', 'unconfigured');
    }
    return makeEnvelope('instructions', 'ok', { verb: name, briefing });
  },

  async doctor(context) {
    const probes = [];
    for (const probe of context.doctorProbes) {
      try {
        const result = typeof probe.check === 'function'
          ? await probe.check(context)
          : await context.run(probe.run);
        if (!result || typeof result.ok !== 'boolean') throw new Error(`Probe ${probe.name} must return { ok: boolean }`);
        probes.push({
          name: probe.name, ok: result.ok, optional: probe.optional ?? false,
          detail: result.detail ?? result.stdout?.trim() ?? '',
          fix: result.fix ?? probe.fix, evidence: result.evidence,
        });
      } catch (error) {
        probes.push({ name: probe.name, ok: false, optional: probe.optional ?? false,
          detail: error.message, fix: probe.fix ?? 'Fix the probe or its prerequisite before retrying.' });
      }
    }
    const required = probes.filter((probe) => !probe.ok && !probe.optional);
    const optional = probes.filter((probe) => !probe.ok && probe.optional);
    const data = { currentDirectory: context.currentDirectory, profile: context.profile, probes, proofBoundary: 'Configured environment readiness only; no product checks are implied.' };
    if (required.length || optional.length) {
      return failure('doctor', new PouError('READINESS_INCOMPLETE', 'Some readiness probes did not pass',
        required[0]?.fix ?? optional[0]?.fix ?? 'Resolve the listed readiness limitations.',
        required.length ? 'unconfigured' : 'degraded', data));
    }
    return makeEnvelope('doctor', 'ok', data);
  },

  init(context) {
    const created = [];
    const create = (relative, content) => {
      const file = join(context.currentDirectory, relative);
      if (!existsSync(file)) {
        writeFileSync(file, content, { encoding: 'utf8', flag: 'wx' });
        created.push(relative);
      }
    };
    if (!context.hasConfiguration) create('pou.config.mjs', STARTER_CONFIG);
    mkdirSync(join(context.currentDirectory, '.pou'), { recursive: true });
    create(join('.pou', 'friction.md'), '# Friction log\n\nRecord symptoms and consequences, not secrets. Review recurring items for a tested improvement.\n\n');
    create('AGENTS.md', AGENTS_STUB);
    return makeEnvelope('init', 'ok', { created, currentDirectory: context.currentDirectory,
      note: 'Existing files were preserved. Discover commands with pou help; base has no build/test/boot verbs.' });
  },

  observe(context) {
    if (!context.hasConfiguration) throw new PouError('CONFIG_MISSING', 'This directory is not configured', 'Run pou init from the intended project root first.', 'unconfigured');
    const message = context.commandArguments.join(' ').trim();
    if (!message || /[\r\n\0]/.test(message)) throw new PouError('OBSERVATION_INVALID', 'Observation must be one nonempty line', 'Use pou observe \"symptom and consequence\"; omit secrets and full logs.');
    const directory = join(context.currentDirectory, '.pou');
    mkdirSync(directory, { recursive: true });
    const file = join(directory, 'friction.md');
    appendFileSync(file, `- ${new Date().toISOString()} ${message}\n`, 'utf8');
    return makeEnvelope('observe', 'ok', { recorded: message, file, proofBoundary: 'Observation persisted; no improvement is implied.' });
  },
};

export function unknown(name) {
  return new PouError('VERB_UNKNOWN', `Unknown verb: ${name}`, 'Run pou help from the configured project root.');
}

const STARTER_CONFIG = `export default {
  profile: 'base',
  params: {},
  verbs: {},
  doctor: [],
  briefings: {},
};
`;

const AGENTS_STUB = `---
title: Project pou guidance
description: Operating the project through pou
---

## Pou workflow

Run from the project root. Discover commands with \`pou help\` and read
\`pou instructions <verb>\` before using an unfamiliar command.

Run \`pou doctor\`, then the smallest configured check that proves the change.
Base does not provide build, test, or boot commands. Inspect actual targets,
skipped stages, status, and recovery guidance rather than treating exit zero
as universal proof.

Record friction with \`pou observe "symptom and consequence"\`. At closeout,
review recurring friction and offer a tested improvement for human acceptance.
Do not log secrets. These are agent instructions, not automatic hooks.
`;
