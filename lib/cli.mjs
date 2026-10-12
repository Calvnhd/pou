import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfiguration } from './config.mjs';
import { runCommand, runCommandAsynchronously, spawnBackground, killTree, resolveExecutable } from './exec.mjs';
import { probeHttp } from './http.mjs';
import { EXIT_CODES, makeEnvelope, normalizeResult, failure, renderEnvelope, PouError } from './output.mjs';
import { builtins, unknown } from './verbs.mjs';

const VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;

export async function main(commandLineArguments) {
  const flagArguments = commandLineArguments.slice(0, commandLineArguments.indexOf('--') < 0 ? commandLineArguments.length : commandLineArguments.indexOf('--'));
  let json = flagArguments.includes('--json') && flagArguments.lastIndexOf('--json') > flagArguments.lastIndexOf('--no-json');
  let name = 'pou';
  try {
    const parsed = parseArguments(commandLineArguments);
    json = parsed.json;
    name = parsed.verb;
    if (name === 'version') {
      if (parsed.commandArguments.length) throw invalidArguments('version takes no arguments');
      return emit(makeEnvelope('version', 'ok', { version: VERSION, executable: process.execPath, platform: process.platform }), parsed.json);
    }
    const currentDirectory = process.cwd();
    let loaded;
    let configurationError;
    try {
      loaded = await loadConfiguration(currentDirectory);
    } catch (error) {
      if (!['help', 'instructions'].includes(name)) throw error;
      configurationError = error;
      loaded = await loadConfiguration(currentDirectory, { skipConfiguration: true });
    }
    const context = {
      ...loaded, currentDirectory, commandArguments: parsed.commandArguments, flags: { json: parsed.json },
      configurationError, doctorProbes: loaded.doctor,
      executeSynchronously: (command, commandArguments = null, options = {}) => runCommand(command, currentDirectory, commandArguments, options),
      run: (command, commandArguments = null, options = {}) => runCommandAsynchronously(command, currentDirectory, commandArguments, options),
      resolveExecutable: (command) => resolveExecutable(command, currentDirectory),
      spawnBackground: (command, commandArguments = null) => spawnBackground(command, currentDirectory, commandArguments),
      killTree, probeHttp,
      log: (...values) => { if (!parsed.json) console.error(...values); },
    };
    let result;
    if (parsed.help || name === 'help') {
      const requested = parsed.help && name !== 'help' ? name : parsed.commandArguments[0];
      if (parsed.commandArguments.length > (name === 'help' ? 1 : 0)) throw invalidArguments('Per-verb help takes no execution arguments');
      result = builtins.help(context, requested);
    } else if (Object.hasOwn(builtins, name)) {
      if (['init', 'doctor'].includes(name) && parsed.commandArguments.length) throw invalidArguments(`${name} takes no arguments`);
      result = await builtins[name](context);
    } else {
      if (!loaded.hasConfiguration) throw new PouError('CONFIG_MISSING', 'No configuration in the current directory', 'Run from the project root, or initialize the intended directory with pou init.', 'unconfigured');
      if (!Object.hasOwn(context.verbs, name)) throw unknown(name);
      if (typeof context.verbs[name] !== 'function' && parsed.commandArguments.length) throw invalidArguments('Shell-backed verbs do not accept implicit arguments; configure the command or use a function verb with context.commandArguments');
      result = await runVerb(name, context.verbs[name], context);
    }
    if (configurationError) {
      result = { ...failure(result.command, new PouError('CONFIG_INVALID', configurationError.message,
        configurationError.nextAction ?? 'Repair the project configuration before execution.', 'degraded', result.data)) };
    }
    return emit(result, parsed.json);
  } catch (error) {
    return emit(failure(name, error), json);
  }
}

function invalidArguments(message) {
  return new PouError('ARGUMENTS_INVALID', message, 'Use pou help [verb] for syntax; use -- to pass dash-prefixed positional values to function verbs.');
}

function parseArguments(commandLineArguments) {
  let json = false;
  let help = false;
  let version = false;
  let literal = false;
  const positional = [];
  for (const argument of commandLineArguments) {
    if (literal) positional.push(argument);
    else if (argument === '--') literal = true;
    else if (argument === '--json') json = true;
    else if (argument === '--no-json') json = false;
    else if (argument === '--help' || argument === '-h') help = true;
    else if (argument === '--version' || argument === '-v') version = true;
    else if (argument.startsWith('-')) throw invalidArguments(`Unknown option: ${argument}`);
    else positional.push(argument);
  }
  if (version && positional.length) throw invalidArguments('--version cannot be combined with a command');
  return { verb: version ? 'version' : positional[0] ?? 'help', commandArguments: positional.slice(1), json, help };
}

async function runVerb(name, definition, context) {
  if (typeof definition === 'function') return normalizeResult(name, await definition(context));
  const steps = [];
  for (const command of Array.isArray(definition) ? definition : [definition]) {
    context.log(`$ ${command}`);
    const result = await context.run(command);
    steps.push(result);
    if (!result.ok) {
      const missing = result.error?.code === 'ENOENT';
      return failure(name, new PouError(missing ? 'TOOL_MISSING' : result.timedOut ? 'COMMAND_TIMEOUT' : 'COMMAND_FAILED',
        `Command did not complete successfully: ${command}`, 'Inspect stage diagnostics and the selected environment before retrying.',
        missing ? 'unconfigured' : 'error', { currentDirectory: context.currentDirectory, steps, failed: command }));
    }
  }
  return makeEnvelope(name, 'ok', { currentDirectory: context.currentDirectory, steps, proofBoundary: 'Configured command exit outcomes only; arbitrary scripts own their assertions and test discovery.' });
}

function emit(envelope, json) {
  renderEnvelope(envelope, json);
  return EXIT_CODES[envelope.status];
}
