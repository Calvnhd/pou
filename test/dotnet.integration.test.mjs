import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCommandAsynchronously } from '../lib/exec.mjs';
import { config, invoke, workspace } from './helpers.mjs';

test('real SDK proves passing/failing/zero-test and compile-failure fixtures', { timeout: 300_000 }, async (t) => {
  const currentDirectory = workspace(t);
  const dotnetVersionResult = await runCommandAsynchronously('dotnet', currentDirectory, ['--version']);
  assert.equal(dotnetVersionResult.ok, true, 'Integration requires a .NET SDK; do not count absence as a passing release check');
  const major = Number(dotnetVersionResult.stdout.trim().split('.')[0]);
  assert.ok(major >= 8, 'Fixture requires .NET SDK 8 or newer');
  const framework = `net${major}.0`;
  const projectDirectory = join(currentDirectory, 'Fixture Tests');
  const scaffold = await runCommandAsynchronously('dotnet', currentDirectory, ['new', 'xunit', '--no-restore', '--framework', framework,
    '--name', 'Fixture', '--output', projectDirectory]);
  assert.equal(scaffold.ok, true, scaffold.stderr);
  const project = join(projectDirectory, 'Fixture.csproj');
  const source = join(projectDirectory, 'UnitTest1.cs');
  const restore = await runCommandAsynchronously('dotnet', currentDirectory, ['restore', project], { timeoutMs: 180_000 });
  assert.equal(restore.ok, true, restore.stdout + restore.stderr);
  config(currentDirectory, `export default {profile:"dotnet",params:${JSON.stringify({ buildTarget: project, testProject: project, testFramework: framework })}};`);
  writeFileSync(source, 'public class Evidence { [Xunit.Fact] public void Proof() { Xunit.Assert.True(true); } }');
  const good = invoke(currentDirectory, ['test'], { timeout: 120_000 });
  assert.equal(good.status, 0, good.stdout);
  assert.equal(good.envelope.data.tests.passed, 1);
  writeFileSync(source, 'public class Evidence { [Xunit.Fact] public void Proof() { Xunit.Assert.True(false); } }');
  const bad = invoke(currentDirectory, ['test'], { timeout: 120_000 });
  assert.equal(bad.status, 1, bad.stdout);
  assert.equal(bad.envelope.data.tests.failed, 1);
  writeFileSync(source, 'public class NoTests {}');
  const empty = invoke(currentDirectory, ['test'], { timeout: 120_000 });
  assert.equal(empty.status, 2, empty.stdout);
  writeFileSync(source, 'this is deliberately not valid C#');
  assert.equal(invoke(currentDirectory, ['build'], { timeout: 120_000 }).status, 1);
});
