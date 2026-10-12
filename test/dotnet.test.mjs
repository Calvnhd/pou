import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import profile, { readTestResultsReport } from '../lib/profiles/dotnet.mjs';
import { config, invoke, workspace } from './helpers.mjs';

function createTestResultsReport({ passed = 1, failed = 0, skipped = 0 } = {}) {
  const entries = [...Array(passed).fill('Passed'), ...Array(failed).fill('Failed'), ...Array(skipped).fill('NotExecuted')];
  return `<TestRun><Results>${entries.map((outcome, i) => `<UnitTestResult executionId="e${i}" testId="t${i}" outcome="${outcome}" />`).join('')}</Results><ResultSummary><Counters total="${entries.length}" executed="${passed + failed}" passed="${passed}" failed="${failed}" notExecuted="${skipped}" /></ResultSummary></TestRun>`;
}

function setup(t) {
  const currentDirectory = workspace(t);
  writeFileSync(join(currentDirectory, 'Library.csproj'), '<Project />');
  return { currentDirectory, params: { buildTarget: 'Library.csproj', testProject: 'Library.csproj', testFramework: 'net9.0' } };
}

function context(currentDirectory, run) {
  return { currentDirectory, run, resolveExecutable: () => process.execPath };
}

test('TRX counts completed tests and rejects malformed, zero, inconsistent reports', () => {
  assert.equal(readTestResultsReport(createTestResultsReport()).passed, 1);
  assert.equal(readTestResultsReport(createTestResultsReport({ passed: 0, failed: 1 })).failed, 1);
  for (const source of ['', '<TestRun />', createTestResultsReport({ passed: 0 }), createTestResultsReport().replace('passed="1"', 'passed="2"'),
    createTestResultsReport().replace('executionId="e0"', ''), createTestResultsReport().replace('</TestRun>', '<broken'),
    createTestResultsReport().replace('<Results>', '<Results><broken>'),
    createTestResultsReport().replace('<Results>', '<Results><!--').replace('</Results>', '--></Results>')]) {
    assert.throws(() => readTestResultsReport(source));
  }
});

test('dotnet uses positional structured targets and rejects missing selection before execution', async (t) => {
  const { currentDirectory, params } = setup(t);
  const calls = [];
  const adapter = profile(params);
  const result = await adapter.verbs.build(context(currentDirectory, async (command, commandArguments) => {
    if (commandArguments[0] === '--version') return { ok: true, stdout: '9.0.318' };
    calls.push({ command, commandArguments }); return { ok: true, code: 0 };
  }));
  assert.equal(result.status, 'ok');
  assert.equal(calls[0].commandArguments[0], 'build');
  assert.equal(calls[0].commandArguments[1], join(currentDirectory, 'Library.csproj'));
  assert.equal(calls[0].commandArguments.includes('--project'), false);
  await assert.rejects(profile({}).verbs.build({ currentDirectory, run: () => { throw new Error('must not run'); } }), /buildTarget/);
});

test('fresh invocation reports succeed and are cleaned; prior reports cannot satisfy proof', async (t) => {
  const { currentDirectory, params } = setup(t);
  const adapter = profile(params);
  let directory;
  const run = async (_, commandArguments) => {
    if (commandArguments[0] === '--version') return { ok: true, stdout: '9.0.318' };
    directory = commandArguments[commandArguments.indexOf('--results-directory') + 1];
    writeFileSync(join(directory, 'current.trx'), createTestResultsReport());
    return { ok: true, code: 0 };
  };
  const result = await adapter.verbs.test(context(currentDirectory, run));
  assert.equal(result.status, 'ok');
  assert.equal(result.data.tests.executed, 1);
  assert.equal(existsSync(directory), false);
  writeFileSync(join(currentDirectory, 'stale.trx'), createTestResultsReport());
  const absent = await adapter.verbs.test(context(currentDirectory, async (_, commandArguments) => commandArguments[0] === '--version' ? { ok: true, stdout: '9.0.318' } : { ok: true, code: 0 }));
  assert.equal(absent.status, 'unconfigured');
});

test('failed, skipped, all-skipped, malformed, and multiple reports cannot pass', async (t) => {
  const { currentDirectory, params } = setup(t);
  for (const [reports, expected, ok] of [
    [[createTestResultsReport({ passed: 0, failed: 1 })], 'error', false],
    [[createTestResultsReport({ skipped: 1 })], 'unconfigured', true],
    [[createTestResultsReport({ passed: 0, skipped: 1 })], 'unconfigured', true],
    [['<malformed>'], 'unconfigured', true],
    [[createTestResultsReport(), createTestResultsReport()], 'unconfigured', true],
  ]) {
    const result = await profile(params).verbs.test(context(currentDirectory, async (_, commandArguments) => {
      if (commandArguments[0] === '--version') return { ok: true, stdout: '9.0.318' };
      const directory = commandArguments[commandArguments.indexOf('--results-directory') + 1];
      reports.forEach((report, i) => writeFileSync(join(directory, `${i}.trx`), report));
      return { ok, code: ok ? 0 : 1 };
    }));
    assert.equal(result.status, expected);
  }
});

test('checks short-circuit build failure and validate required test selection first', async (t) => {
  const { currentDirectory, params } = setup(t);
  let calls = 0;
  const result = await profile(params).verbs.checks(context(currentDirectory, async (_, commandArguments) => {
    if (commandArguments[0] === '--version') return { ok: true, stdout: '9.0.318' };
    calls += 1; return { ok: false, code: 1 };
  }));
  assert.equal(calls, 1);
  assert.deepEqual(result.data.skipped, ['test']);
  assert.equal(result.command, 'checks');
});

test('runtime-only or SDK selection failure is a prerequisite error', async (t) => {
  const { currentDirectory, params } = setup(t);
  await assert.rejects(profile(params).verbs.build(context(currentDirectory, async () => ({ ok: false, stdout: '', code: 145 }))),
    (error) => error.status === 'unconfigured');
});

test('behavior-only overrides invalidate inherited briefings; replacement metadata wins', (t) => {
  const { currentDirectory, params } = setup(t);
  config(currentDirectory, `export default {profile: "dotnet", params: ${JSON.stringify(params)}, verbs: {test: () => ({note:"custom"})}};`);
  assert.equal(invoke(currentDirectory, ['instructions', 'test']).status, 2);
  assert.equal(invoke(currentDirectory, ['instructions', 'build']).status, 0);
  const other = workspace(t);
  const metadata = { summary: 'custom', purpose: 'custom', inputs: 'none', prerequisites: 'none', sideEffects: 'none', outputs: 'custom', recovery: 'inspect', proofBoundary: 'custom only' };
  config(other, `export default {profile:"dotnet",params:${JSON.stringify(params)},verbs:{test:()=>({note:"custom"})},briefings:{test:${JSON.stringify(metadata)}}};`);
  assert.equal(invoke(other, ['instructions', 'test']).envelope.data.briefing.proofBoundary, 'custom only');
});
