import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PouError } from './output.mjs';
import { BRIEFINGS } from './verbs.mjs';

const PROFILES_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), 'profiles');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function invalid(message) {
  throw new PouError('CONFIG_INVALID', message, 'Correct the configuration in this directory; use pou help and pou instructions for supported shapes.', 'unconfigured');
}

function validateLayer(layer) {
  if (!object(layer)) invalid('Configuration/profile must be an object');
  for (const key of ['verbs', 'briefings', 'params']) {
    if (layer[key] !== undefined && !object(layer[key])) invalid(`${key} must be an object`);
  }
  if (layer.doctor !== undefined && !Array.isArray(layer.doctor)) invalid('doctor must be an array');
  for (const [name, value] of Object.entries(layer.verbs ?? {})) {
    if (!/^[a-z][a-z0-9-]*$/.test(name) || Object.hasOwn(BRIEFINGS, name)) invalid(`Invalid or reserved verb name: ${name}`);
    const command = (item) => typeof item === 'string' && item.trim().length > 0;
    if (!(typeof value === 'function' || command(value) ||
          (Array.isArray(value) && value.length > 0 && value.every(command)))) invalid(`Invalid verb definition: ${name}`);
  }
  for (const probe of layer.doctor ?? []) {
    if (!object(probe) || typeof probe.name !== 'string' || !probe.name.trim() ||
        (typeof probe.check !== 'function' && (typeof probe.run !== 'string' || !probe.run.trim())) ||
        (probe.optional !== undefined && typeof probe.optional !== 'boolean')) invalid('Invalid doctor probe');
  }
  for (const [name, briefing] of Object.entries(layer.briefings ?? {})) {
    if (!/^[a-z][a-z0-9-]*$/.test(name) || Object.hasOwn(BRIEFINGS, name)) invalid(`Invalid briefing name: ${name}`);
    for (const key of ['summary', 'purpose', 'inputs', 'prerequisites', 'sideEffects', 'outputs', 'recovery', 'proofBoundary']) {
      if (!object(briefing) || typeof briefing[key] !== 'string' || !briefing[key].trim()) invalid(`Briefing ${name} requires nonempty ${key}`);
    }
  }
  return { verbs: layer.verbs ?? {}, doctor: layer.doctor ?? [], briefings: layer.briefings ?? {} };
}

function merge(a, b) {
  const briefings = { ...a.briefings };
  for (const name of Object.keys(b.verbs)) delete briefings[name];
  return {
    verbs: { ...a.verbs, ...b.verbs },
    doctor: [...a.doctor, ...b.doctor],
    briefings: { ...briefings, ...b.briefings },
  };
}

export async function loadConfiguration(currentDirectory, { skipConfiguration = false } = {}) {
  const file = join(currentDirectory, 'pou.config.mjs');
  const configurationPath = !skipConfiguration && existsSync(file) ? file : null;
  let config = {};
  if (configurationPath) {
    try {
      config = (await import(pathToFileURL(configurationPath).href)).default;
    } catch (error) {
      invalid(`Could not load ${configurationPath}: ${error.message}`);
    }
  }
  const repo = validateLayer(config);
  const profile = config.profile ?? 'base';
  if (typeof profile !== 'string' || !/^[a-z][a-z0-9-]*$/.test(profile)) invalid('Invalid profile name');
  const params = config.params ?? {};
  let merged = await loadProfile('base', params);
  if (profile !== 'base') merged = merge(merged, await loadProfile(profile, params));
  merged = merge(merged, repo);
  for (const name of Object.keys(merged.briefings)) {
    if (!Object.hasOwn(merged.verbs, name)) invalid(`Briefing has no matching verb: ${name}`);
  }
  return { ...merged, profile, params, hasConfiguration: configurationPath !== null, configurationPath };
}

async function loadProfile(name, params) {
  const file = join(PROFILES_DIRECTORY, `${name}.mjs`);
  if (!existsSync(file)) invalid(`Unknown profile: ${name}`);
  try {
    const module = await import(pathToFileURL(file).href);
    if (typeof module.default !== 'function') invalid(`Profile ${name} must export a function`);
    return validateLayer(module.default(params));
  } catch (error) {
    if (error instanceof PouError) throw error;
    invalid(`Profile ${name} failed: ${error.message}`);
  }
}
