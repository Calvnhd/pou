import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cli, root, invoke, workspace, config } from './helpers.mjs';

test('help and version work in an unconfigured directory', (t) => {
  const currentDirectory = workspace(t);
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(invoke(currentDirectory, ['help']).envelope.status, 'ok');
  const version = invoke(currentDirectory, ['version']);
  assert.equal(version.status, 0);
  assert.equal(version.envelope.data.version, manifest.version);
});

test('text help displays command briefings without executing custom verbs', (t) => {
  const currentDirectory = workspace(t);
  config(currentDirectory, 'export default {verbs: {dangerous: () => {throw new Error("executed");}}};');
  for (const commandArguments of [['help', 'init'], ['init', '--help'], ['help', 'dangerous'], ['dangerous', '--help']]) {
    const result = spawnSync(process.execPath, [cli, ...commandArguments], { cwd: currentDirectory, encoding: 'utf8', timeout: 30_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(result.stdout, /undefined/);
    assert.match(result.stdout, commandArguments.includes('init') ? /sideEffects:\s+Creates missing files and appends a pou section/ : /Briefing unavailable/);
  }
});

test('unknown command fails instead of reporting success', (t) => {
  const currentDirectory = workspace(t);
  invoke(currentDirectory, ['init']);
  const result = invoke(currentDirectory, ['does-not-exist']);
  assert.equal(result.status, 1);
  assert.equal(result.envelope.status, 'error');
  assert.equal(result.envelope.error.code, 'VERB_UNKNOWN');
  assert.ok(result.envelope.next_action);
});

test('init is repeatable and doctor detects missing configuration', (t) => {
  const currentDirectory = workspace(t);
  assert.equal(invoke(currentDirectory, ['doctor']).status, 2);
  assert.equal(invoke(currentDirectory, ['observe', 'not yet']).status, 2);
  assert.equal(invoke(currentDirectory, ['checks']).status, 2);
  const files = ['pou.config.mjs', join('.pou', 'friction.md'), 'AGENTS.md'];
  assert.deepEqual(invoke(currentDirectory, ['init']).envelope.data.created, files);
  assert.equal(invoke(currentDirectory, ['doctor']).status, 0);
  const guidance = readFileSync(join(currentDirectory, 'AGENTS.md'), 'utf8');
  assert.match(guidance, /^# pou$/m);
  assert.match(guidance, /project operations CLI/);
  assert.match(guidance, /pou instructions <command>/);
  assert.match(guidance, /verbs.*pou\.config\.mjs/);
  assert.match(guidance, /briefings/);
  for (const { name } of invoke(currentDirectory, ['help']).envelope.data.commands) {
    assert.ok(guidance.includes(`* \`pou ${name}`), `Generated guidance must list ${name}`);
  }
  const before = files.map((name) => readFileSync(join(currentDirectory, name)));
  assert.deepEqual(invoke(currentDirectory, ['init']).envelope.data.created, []);
  files.forEach((name, index) => assert.deepEqual(readFileSync(join(currentDirectory, name)), before[index]));
});

test('init appends a pou section to existing guidance once and preserves configuration', (t) => {
  const currentDirectory = workspace(t);
  const content = 'export default {profile:"base"};';
  config(currentDirectory, content);
  writeFileSync(join(currentDirectory, 'AGENTS.md'), 'Team guidance');
  assert.equal(invoke(currentDirectory, ['help']).envelope.data.hasConfiguration, true);
  assert.equal(invoke(currentDirectory, ['init']).status, 0);
  assert.equal(readFileSync(join(currentDirectory, 'pou.config.mjs'), 'utf8'), content);
  const guidance = readFileSync(join(currentDirectory, 'AGENTS.md'), 'utf8');
  assert.ok(guidance.startsWith('Team guidance\n'));
  assert.match(guidance, /^# pou$/m);
  assert.doesNotMatch(guidance, /^---$/m);
  assert.equal(invoke(currentDirectory, ['init']).envelope.data.updated.length, 0);
  assert.equal(readFileSync(join(currentDirectory, 'AGENTS.md'), 'utf8'), guidance);
  assert.equal(invoke(currentDirectory, ['doctor']).status, 0);
});

test('profiles lists available profiles and the selected one', (t) => {
  const currentDirectory = workspace(t);
  const unconfigured = invoke(currentDirectory, ['profiles']).envelope.data;
  assert.deepEqual(unconfigured.profiles.map((profile) => profile.name), ['base', 'dotnet']);
  assert.ok(unconfigured.profiles.every((profile) => profile.description));
  assert.equal(unconfigured.selected, 'base');
  config(currentDirectory, 'export default {profile: "dotnet"};');
  assert.equal(invoke(currentDirectory, ['profiles']).envelope.data.selected, 'dotnet');
  assert.equal(invoke(currentDirectory, ['profiles', 'extra']).status, 1);
});

test('profiles remains discoverable with broken configuration without claiming a selection', (t) => {
  for (const source of ['export default {profile: "dotnett"};', 'export default {']) {
    const currentDirectory = workspace(t);
    config(currentDirectory, source);
    const json = invoke(currentDirectory, ['profiles']);
    assert.equal(json.status, 0);
    assert.equal(json.envelope.status, 'degraded');
    assert.equal(json.envelope.error.code, 'CONFIG_INVALID');
    assert.ok(json.envelope.error.message);
    assert.ok(json.envelope.next_action);
    assert.equal(json.envelope.data.selected, null);
    assert.deepEqual(json.envelope.data.profiles.map((profile) => profile.name), ['base', 'dotnet']);
    const text = spawnSync(process.execPath, [cli, 'profiles'], { cwd: currentDirectory, encoding: 'utf8', timeout: 30_000 });
    assert.ifError(text.error);
    assert.equal(text.status, 0, text.stdout);
    assert.match(text.stdout, /profiles: degraded/);
    assert.match(text.stdout, /CONFIG_INVALID/);
    assert.match(text.stdout, /^     base\s+/m);
    assert.match(text.stdout, /^     dotnet\s+/m);
    assert.doesNotMatch(text.stdout, /^  \*/m);
    assert.equal(invoke(currentDirectory, ['doctor']).status, 2);
    assert.equal(invoke(currentDirectory, ['profiles', 'extra']).status, 1);
  }
});

test('init with a profile writes that starter and rejects unknown profiles', (t) => {
  const currentDirectory = workspace(t);
  const unknown = invoke(currentDirectory, ['init', 'nope']);
  assert.equal(unknown.status, 1);
  assert.equal(unknown.envelope.error.code, 'PROFILE_UNKNOWN');
  assert.match(unknown.envelope.next_action, /base, dotnet/);
  assert.equal(existsSync(join(currentDirectory, 'pou.config.mjs')), false);
  assert.equal(invoke(currentDirectory, ['init', 'dotnet']).status, 0);
  assert.match(readFileSync(join(currentDirectory, 'pou.config.mjs'), 'utf8'), /profile: 'dotnet'/);
  assert.equal(invoke(currentDirectory, ['profiles']).envelope.data.selected, 'dotnet');
  assert.notEqual(invoke(currentDirectory, ['doctor']).status, 0);
});

test('init with a profile does not change an existing configuration', (t) => {
  const currentDirectory = workspace(t);
  const content = 'export default {profile:"base"};';
  config(currentDirectory, content);
  const result = invoke(currentDirectory, ['init', 'dotnet']);
  assert.equal(result.status, 0);
  assert.match(result.envelope.data.note, /was not applied/);
  assert.equal(readFileSync(join(currentDirectory, 'pou.config.mjs'), 'utf8'), content);
});

test('project configuration follows the current directory independently', (t) => {
  const a = workspace(t);
  const b = workspace(t);
  config(a, 'export default { verbs: { who: (context) => ({ project: "A", currentDirectory: context.currentDirectory }) } };');
  config(b, 'export default { verbs: { who: (context) => ({ project: "B", currentDirectory: context.currentDirectory }) } };');
  assert.deepEqual(invoke(a, ['who']).envelope.data, { project: 'A', currentDirectory: a });
  assert.deepEqual(invoke(b, ['who']).envelope.data, { project: 'B', currentDirectory: b });
  invoke(a, ['observe', 'only in A']);
  assert.equal(existsSync(join(b, '.pou')), false);
});

test('observations persist one line and reject invalid inputs', (t) => {
  const currentDirectory = workspace(t);
  invoke(currentDirectory, ['init']);
  assert.equal(invoke(currentDirectory, ['observe', '--', '-a rough edge']).status, 0);
  assert.match(readFileSync(join(currentDirectory, '.pou', 'friction.md'), 'utf8'), /-a rough edge/);
  assert.equal(invoke(currentDirectory, ['observe']).status, 1);
  assert.equal(invoke(currentDirectory, ['observe', 'line\ninjection']).status, 1);
});

test('managed noisy shell output does not contaminate JSON and failures short-circuit', (t) => {
  const currentDirectory = workspace(t);
  const noisy = `"${process.execPath}" -e "console.log('noise');console.error('warning')"`;
  config(currentDirectory, `export default { verbs: { noisy: ${JSON.stringify(noisy)}, checks: ["${process.platform === 'win32' ? 'exit /b 3' : 'exit 3'}", "echo MUST_NOT_RUN"] } };`);
  const result = invoke(currentDirectory, ['noisy']);
  assert.equal(result.status, 0);
  assert.match(result.envelope.data.steps[0].stdout, /noise/);
  const failed = invoke(currentDirectory, ['checks']);
  assert.equal(failed.status, 1);
  assert.equal(failed.envelope.data.steps.length, 1);
});

test('successful shell steps display stdout and stderr without changing JSON', (t) => {
  const currentDirectory = workspace(t);
  const noisy = `"${process.execPath}" -e "console.log('measured output');console.error('tool warning')"`;
  const silent = `"${process.execPath}" -e "process.exit(0)"`;
  config(currentDirectory, `export default {verbs: {report: ${JSON.stringify([noisy, silent])}}};`);
  const text = spawnSync(process.execPath, [cli, 'report'], { cwd: currentDirectory, encoding: 'utf8', timeout: 30_000 });
  assert.ifError(text.error);
  assert.equal(text.status, 0, text.stdout);
  assert.match(text.stdout, /report: ok/);
  assert.match(text.stdout, /    measured output/);
  assert.match(text.stdout, /    tool warning/);
  assert.equal((text.stdout.match(/^  output \(/gm) ?? []).length, 1);
  const json = invoke(currentDirectory, ['report']);
  assert.equal(json.status, 0);
  assert.equal(json.stdout.trim().split(/\r?\n/).length, 1);
  assert.equal(json.envelope.data.steps.length, 2);
  assert.equal(json.envelope.data.steps[0].stdout, 'measured output\n');
  assert.equal(json.envelope.data.steps[0].stderr, 'tool warning\n');
  assert.equal(json.envelope.data.steps[1].stdout, '');
});

test('function contracts, thrown errors, and unknown flags fail explicitly', (t) => {
  const currentDirectory = workspace(t);
  config(currentDirectory, `export default { verbs: {
    missing: () => undefined,
    invalid: () => ({ status: "green" }),
    bad: () => ({ status: "degraded", data: {} }),
    throws: () => { throw new Error("fixture failure"); },
    sync: (context) => ({ result: context.executeSynchronously('"' + process.execPath + '" -e "process.exit(0)"').code })
  }};`);
  for (const name of ['missing', 'invalid', 'bad', 'throws']) {
    const result = invoke(currentDirectory, [name]);
    assert.equal(result.status, 1, name);
    assert.ok(result.envelope.error.code);
    assert.ok(result.envelope.next_action);
  }
  assert.equal(invoke(currentDirectory, ['sync']).envelope.data.result, 0);
  assert.equal(invoke(currentDirectory, ['--unsupported']).status, 1);
});

test('discovery is usable with broken configuration and per-verb help never executes', (t) => {
  const currentDirectory = workspace(t);
  config(currentDirectory, 'export default {profile: "not-installed"};');
  assert.equal(invoke(currentDirectory, ['version']).status, 0);
  assert.equal(invoke(currentDirectory, ['help']).envelope.status, 'degraded');
  assert.equal(invoke(currentDirectory, ['doctor']).status, 2);
  const clean = workspace(t);
  config(clean, 'export default { verbs: { dangerous: () => { throw new Error("executed"); } } };');
  assert.equal(invoke(clean, ['dangerous', '--help']).status, 0);
  assert.equal(invoke(clean, ['instructions', 'dangerous']).status, 2);
  assert.equal(invoke(clean, ['instructions']).status, 0);
});

test('filesystem failure is reported rather than returning success', (t) => {
  const currentDirectory = workspace(t);
  config(currentDirectory, 'export default {};');
  writeFileSync(join(currentDirectory, '.pou'), 'not a directory');
  assert.equal(invoke(currentDirectory, ['observe', 'cannot write']).status, 1);
  assert.equal(invoke(currentDirectory, ['init']).status, 1);
});
