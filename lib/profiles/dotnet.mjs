import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { PouError, failure, makeEnvelope } from '../output.mjs';

function unavailable(message, details = {}) {
  return new PouError('DOTNET_UNCONFIGURED', message,
    'Select an existing buildTarget, a single VSTest testProject, and its explicit testFramework; install the selected .NET SDK.',
    'unconfigured', details);
}

function target(currentDirectory, value, extensions, label) {
  if (typeof value !== 'string' || !value.trim()) throw unavailable(`${label} is required`);
  const file = resolve(currentDirectory, value);
  if (!extensions.includes(extname(file).toLowerCase()) || !existsSync(file) || !statSync(file).isFile()) {
    throw unavailable(`${label} must select an existing ${extensions.join('/')} file`, { target: file });
  }
  return file;
}

function attributes(source) {
  const result = {};
  const expression = /([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/g;
  for (const match of source.matchAll(expression)) {
    if (Object.hasOwn(result, match[1])) throw unavailable('Duplicate TRX attribute');
    result[match[1]] = match[2] ?? match[3];
  }
  const residue = source.replace(expression, '').trim();
  if (residue) throw unavailable('Malformed TRX attributes');
  return result;
}

export function readTestResultsReport(source) {
  const stack = [];
  const counters = [];
  const entries = [];
  let roots = 0;
  let offset = 0;
  const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?(?:[^<>"']|"[^"]*"|'[^']*')+>|[^<]+/g;
  for (const match of source.matchAll(tokens)) {
    if (match.index !== offset) throw unavailable('Malformed TRX markup');
    const token = match[0];
    offset += token.length;
    if (token.startsWith('<!--') || token.startsWith('<?')) continue;
    if (!token.startsWith('<') || token.startsWith('<![CDATA[')) {
      if (!stack.length && token.trim()) throw unavailable('TRX content outside its root');
      continue;
    }
    const tag = /^<(\/?)([A-Za-z_][A-Za-z0-9_.:-]*)([\s\S]*?)(\/?)>$/.exec(token);
    if (!tag) throw unavailable('Unsupported TRX markup');
    const [, closing, name, raw, selfClosing] = tag;
    if (closing) {
      if (selfClosing || raw.trim() || stack.pop() !== name) throw unavailable('Mismatched TRX closing element');
      continue;
    }
    const values = attributes(raw);
    if (!stack.length && (++roots !== 1 || name !== 'TestRun')) throw unavailable('TRX must have one TestRun root');
    if (name === 'Counters') {
      if (stack.join('/') !== 'TestRun/ResultSummary') throw unavailable('TRX counters are outside the summary');
      counters.push(values);
    }
    if (name === 'UnitTestResult') {
      if (stack.join('/') !== 'TestRun/Results') throw unavailable('TRX assertion is outside Results');
      entries.push(values);
    }
    if (!selfClosing) stack.push(name);
  }
  if (offset !== source.length || stack.length || roots !== 1) throw unavailable('Incomplete TRX document');
  if (counters.length !== 1) throw unavailable('TRX must contain exactly one counters element');
  const values = counters[0];
  const number = (key) => {
    if (!/^\d+$/.test(values[key] ?? '')) throw unavailable(`Invalid TRX counter: ${key}`);
    const value = Number(values[key]);
    if (!Number.isSafeInteger(value)) throw unavailable(`TRX counter out of range: ${key}`);
    return value;
  };
  const total = number('total');
  const executed = number('executed');
  const passed = number('passed');
  const failed = number('failed');
  const skipped = number('notExecuted');
  if (total === 0 || executed === 0) throw unavailable('No completed tests were measured');
  if (entries.length !== total || new Set(entries.map((entry) => entry.executionId)).size !== total ||
      entries.some((entry) => !entry.executionId || !entry.testId || !['Passed', 'Failed', 'NotExecuted'].includes(entry.outcome)) ||
      passed !== entries.filter((entry) => entry.outcome === 'Passed').length ||
      failed !== entries.filter((entry) => entry.outcome === 'Failed').length ||
      skipped !== entries.filter((entry) => entry.outcome === 'NotExecuted').length ||
      executed !== passed + failed || total !== executed + skipped) {
    throw unavailable('TRX results do not consistently account for the selected test scope');
  }
  return { total, executed, passed, failed, skipped };
}

export const description = 'Adds build and test for explicitly selected .NET targets';

export default function dotnet(params = {}) {
  const configuration = params.configuration ?? 'Debug';
  if (typeof configuration !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(configuration)) throw unavailable('Invalid .NET configuration');
  if (params.timeoutMs !== undefined && (!Number.isSafeInteger(params.timeoutMs) || params.timeoutMs <= 0)) throw unavailable('Invalid .NET timeoutMs');
  const options = params.timeoutMs === undefined ? {} : { timeoutMs: params.timeoutMs };
  const environments = new WeakMap();
  const buildTarget = (context) => target(context.currentDirectory, params.buildTarget, ['.csproj', '.sln', '.slnx'], 'buildTarget');
  const testSelection = (context) => {
    const project = target(context.currentDirectory, params.testProject, ['.csproj'], 'testProject');
    if (typeof params.testFramework !== 'string' || !/^net[a-zA-Z0-9.-]+$/.test(params.testFramework)) throw unavailable('testFramework is required, for example net9.0');
    return { project, framework: params.testFramework };
  };

  async function checkDotnetInstallation(context) {
    if (environments.has(context)) return environments.get(context);
    const executable = context.resolveExecutable('dotnet');
    if (!executable) return { ok: false, detail: 'dotnet executable not found', fix: 'Install the .NET SDK in this Windows/WSL environment.' };
    const result = await context.run(executable, ['--version'], options);
    let cursor = resolve(context.currentDirectory);
    let globalJson = null;
    while (true) {
      const candidate = join(cursor, 'global.json');
      if (existsSync(candidate)) { globalJson = candidate; break; }
      const parent = resolve(cursor, '..');
      if (parent === cursor) break;
      cursor = parent;
    }
    const evidence = {
      ok: result.ok && /^\d+\.\d+\.\d+(?:[-+][^\s]+)?$/.test(result.stdout.trim()),
      detail: `SDK ${result.stdout.trim() || 'unavailable'}; executable ${executable}; currentDirectory ${context.currentDirectory}; global.json ${globalJson ?? 'absent'}`,
      fix: 'Install the SDK selected by global.json in the environment executing pou.',
      evidence: { ...result, globalJson },
    };
    environments.set(context, evidence);
    return evidence;
  }

  async function ensureDotnetAvailable(context) {
    const environment = await checkDotnetInstallation(context);
    if (!environment.ok) throw unavailable(environment.detail, { environment });
    return environment;
  }

  async function build(context) {
    const selected = buildTarget(context);
    const environment = await ensureDotnetAvailable(context);
    const result = await context.run('dotnet', ['build', selected, '--configuration', configuration], options);
    const data = { currentDirectory: context.currentDirectory, target: selected, configuration, environment, steps: [result], proofBoundary: 'Compilation only; not test, launch, rendering, or deployment proof.' };
    if (!result.ok) return executionFailure('build', result, data);
    return makeEnvelope('build', 'ok', data);
  }

  async function test(context) {
    const selected = testSelection(context);
    const environment = await ensureDotnetAvailable(context);
    const reports = mkdtempSync(join(tmpdir(), 'pou-trx-'));
    const data = { currentDirectory: context.currentDirectory, target: selected.project, framework: selected.framework, configuration, environment,
      steps: [], reportScope: 'One explicit test project/framework, current invocation only.',
      proofBoundary: 'Selected VSTest assertions only; not game launch/rendering or other projects/frameworks.' };
    try {
      const result = await context.run('dotnet', ['test', selected.project, '--configuration', configuration,
        '--framework', selected.framework, '--logger', 'trx', '--results-directory', reports], options);
      data.steps.push(result);
      if (result.timedOut || result.signal || result.error || result.cleanupError) return executionFailure('test', result, data);
      const files = readdirSync(reports).filter((name) => name.endsWith('.trx'));
      if (files.length !== 1) throw unavailable('Expected exactly one fresh TRX report for the selected project/framework', data);
      const report = join(reports, files[0]);
      if (statSync(report).size > 16_777_216) throw unavailable('TRX report exceeds the supported 16 MiB bound', data);
      data.tests = readTestResultsReport(readFileSync(report, 'utf8'));
      data.report = { filename: files[0], retained: false, source: 'Invocation-owned temporary directory; cleaned after measurement.' };
      if (!result.ok || data.tests.failed) return executionFailure('test', result, data);
      if (data.tests.skipped) throw unavailable('Required test proof includes skipped assertions', data);
      return makeEnvelope('test', 'ok', data);
    } catch (error) {
      if (error instanceof PouError) {
        error.details = { ...data, ...error.details };
        return failure('test', error);
      }
      throw error;
    } finally {
      rmSync(reports, { recursive: true, force: true });
    }
  }

  const verbs = { build, test };
  const briefings = Object.fromEntries(Object.keys(verbs).map((name) => [name, {
    summary: `${name} selected .NET targets`,
    purpose: name === 'build' ? 'Compile the selected project/solution.' : 'Measure selected VSTest assertions.',
    inputs: 'params.buildTarget; params.testProject (one csproj); params.testFramework (one TFM); optional configuration and timeoutMs. No implicit CLI targets.',
    prerequisites: 'Resolved .NET SDK. test requires VSTest TRX-compatible test project. Microsoft.Testing.Platform-only runners are not supported.',
    sideEffects: 'SDK build/restore writes project artifacts and may restore declared dependencies. Tests execute project code; temporary TRX reports are removed.',
    outputs: 'Selected currentDirectory/target/framework/configuration, managed process evidence, fresh test counters, skipped scope, and proof boundary.',
    recovery: 'Fix SDK/targets, failed compilation/assertions, or missing/stale/malformed/zero/skipped test evidence. Required proof cannot be replaced by exit zero.',
    proofBoundary: 'Only selected compilation/assertions. No implicit application launch, MonoGame rendering, publish, or deployment.',
  }]));
  return {
    verbs, briefings,
    doctor: [
      { name: 'dotnet-sdk', check: checkDotnetInstallation },
      { name: 'dotnet-build-target', check: (context) => ({ ok: true, detail: buildTarget(context) }) },
    ],
  };
}

function executionFailure(command, result, data) {
  const missing = result.error?.code === 'ENOENT';
  return failure(command, new PouError(missing ? 'TOOL_MISSING' : result.timedOut ? 'COMMAND_TIMEOUT' : 'DOTNET_FAILED',
    `Selected .NET ${command} did not complete successfully`, 'Inspect selected SDK, targets, process diagnostics, and assertion results before retrying.',
    missing ? 'unconfigured' : 'error', data));
}
