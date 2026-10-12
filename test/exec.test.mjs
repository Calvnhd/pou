import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand, runCommandAsynchronously, spawnBackground, killTree } from '../lib/exec.mjs';
import { workspace } from './helpers.mjs';

test('structured arguments preserve spaces and shell metacharacters', async (t) => {
  const currentDirectory = workspace(t);
  const script = join(currentDirectory, 'file with spaces.mjs');
  writeFileSync(script, 'console.log(JSON.stringify(process.argv.slice(2)))');
  const result = await runCommandAsynchronously(process.execPath, currentDirectory, [script, 'a & b', 'x"y', '$(not-a-command)']);
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(result.stdout), ['a & b', 'x"y', '$(not-a-command)']);
  assert.equal(result.executable, process.execPath);
});

test('missing, nonzero, interrupted, and timed-out commands cannot pass', async (t) => {
  const currentDirectory = workspace(t);
  assert.equal((await runCommandAsynchronously('pou-missing-tool-84729', currentDirectory, [])).error.code, 'ENOENT');
  assert.equal((await runCommandAsynchronously(process.execPath, currentDirectory, ['-e', 'process.exit(7)'])).code, 7);
  const timed = await runCommandAsynchronously(process.execPath, currentDirectory, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 150 });
  assert.equal(timed.ok, false);
  assert.equal(timed.timedOut, true);
  assert.ok(timed.durationMs < 10_000);
  const interrupted = await runCommandAsynchronously(process.execPath, currentDirectory, ['-e', 'process.kill(process.pid)']);
  assert.equal(interrupted.ok, false);
});

test('synchronous compatibility helper has the same deadline and bounded output', (t) => {
  const currentDirectory = workspace(t);
  const output = runCommand(process.execPath, currentDirectory, ['-e', 'process.stdout.write("x".repeat(10000))'], { maxOutputBytes: 100 });
  assert.equal(output.ok, true);
  assert.equal(Buffer.byteLength(output.stdout), 100);
  assert.equal(output.truncated, true);
  const timeout = runCommand(process.execPath, currentDirectory, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 150 });
  assert.equal(timeout.ok, false);
  assert.equal(timeout.timedOut, true);
});

test('background helper cleanup is owned and awaited', async (t) => {
  const child = spawnBackground(process.execPath, workspace(t), ['-e', 'setInterval(()=>{},1000)']);
  await once(child, 'spawn');
  await killTree(child);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  await assert.rejects(killTree({ pid: process.pid }), /Only processes/);
});

test('timeout cleans a child and its descendant', async (t) => {
  const currentDirectory = workspace(t);
  const script = 'const {spawn}=require("node:child_process"); const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"}); process.stdout.write(String(c.pid)); setInterval(()=>{},1000)';
  const result = await runCommandAsynchronously(process.execPath, currentDirectory, ['-e', script], { timeoutMs: 5000 });
  assert.equal(result.error, null, JSON.stringify(result));
  assert.equal(result.cleanupError, null, JSON.stringify(result));
  assert.equal(result.timedOut, true);
  const pid = Number(result.stdout.trim());
  assert.ok(pid > 0, JSON.stringify(result));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
