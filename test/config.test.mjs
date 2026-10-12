import test from 'node:test';
import assert from 'node:assert/strict';
import { config, invoke, workspace } from './helpers.mjs';

test('invalid configuration shapes and empty commands cannot pass', (t) => {
  for (const source of [
    'export default null;', 'export default {verbs: []};',
    'export default {verbs: {empty: []}};',
    'export default {verbs: {help: "echo hijacked"}};',
    'export default {doctor: [{name: "broken"}]};',
    'export default {briefings: {x: {summary: "incomplete"}}};',
  ]) {
    const currentDirectory = workspace(t);
    config(currentDirectory, source);
    const result = invoke(currentDirectory, ['doctor']);
    assert.equal(result.status, 2, source);
    assert.equal(result.envelope.error.code, 'CONFIG_INVALID');
  }
});

test('required and optional probes have distinct status and recovery', (t) => {
  const currentDirectory = workspace(t);
  config(currentDirectory, 'export default {doctor: [{name: "optional", optional: true, check: () => ({ok:false, detail:"not measured", fix:"Configure optional tool"})}]};');
  assert.equal(invoke(currentDirectory, ['doctor']).envelope.status, 'degraded');
  const required = workspace(t);
  config(required, 'export default {doctor: [{name: "required", check: () => {throw new Error("missing tool")}}]};');
  const result = invoke(required, ['doctor']);
  assert.equal(result.status, 2);
  assert.match(result.envelope.data.probes.at(-1).detail, /missing tool/);
});

test('instructions expose side effects and unknown briefings fail', (t) => {
  const currentDirectory = workspace(t);
  assert.match(invoke(currentDirectory, ['instructions', 'init']).envelope.data.briefing.sideEffects, /Writes/);
  assert.equal(invoke(currentDirectory, ['instructions', 'unknown']).status, 1);
});
