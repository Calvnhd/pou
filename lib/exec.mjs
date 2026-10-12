import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter, extname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_OUTPUT_BYTES = 65_536;
const EXECUTION_WORKER_PATH = fileURLToPath(import.meta.url);
const owned = new WeakSet();

export function resolveExecutable(command, currentDirectory = process.cwd()) {
  const directories = isAbsolute(command) || command.includes('/') || command.includes('\\')
    ? [''] : (process.env.PATH ?? '').split(delimiter);
  const suffixes = process.platform === 'win32' && !extname(command)
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';') : [''];
  for (const directory of directories) {
    for (const suffix of ['', ...suffixes]) {
      const candidate = resolve(currentDirectory, directory, `${command}${suffix}`);
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
  }
  return null;
}

function invocation(command, currentDirectory, commandArguments) {
  if (typeof command !== 'string' || !command.trim()) throw new TypeError('Command must be a nonempty string');
  if (commandArguments === null) return { file: command, commandArguments: [], shell: true, executable: null };
  if (!Array.isArray(commandArguments) || commandArguments.some((argument) => typeof argument !== 'string' || argument.includes('\0'))) {
    throw new TypeError('Arguments must be an array of strings without NUL characters');
  }
  const executable = resolveExecutable(command, currentDirectory);
  if (process.platform === 'win32' && executable && /\.(cmd|bat)$/i.test(executable)) {
    throw new TypeError('Structured execution requires an executable, not a .cmd/.bat shim; use a trusted shell recipe for scripts');
  }
  return { file: executable ?? command, commandArguments, shell: false, executable };
}

function limits(options) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_OUTPUT_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_000_000 ||
      !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 16_777_216) {
    throw new TypeError('timeoutMs and maxOutputBytes must be positive integers within the documented limits');
  }
  return { timeoutMs, maxOutputBytes };
}

export async function runCommandAsynchronously(command, currentDirectory, commandArguments = null, options = {}) {
  const invocationDetails = invocation(command, currentDirectory, commandArguments);
  const { timeoutMs, maxOutputBytes } = limits(options);
  const started = Date.now();
  return new Promise((resolveResult) => {
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let truncated = false;
    let timedOut = false;
    let spawnError = null;
    let cleanupError = null;
    let cleanup = Promise.resolve();
    const child = spawn(invocationDetails.file, invocationDetails.commandArguments, {
      cwd: currentDirectory, shell: invocationDetails.shell, stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32', windowsHide: true,
    });
    owned.add(child);
    const capture = (current, chunk) => {
      const available = maxOutputBytes - stdout.length - stderr.length;
      if (chunk.length > available) truncated = true;
      return Buffer.concat([current, chunk.subarray(0, Math.max(0, available))]);
    };
    child.stdout.on('data', (chunk) => { stdout = capture(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = capture(stderr, chunk); });
    child.on('error', (error) => { spawnError = { code: error.code ?? 'SPAWN_ERROR', message: error.message }; });
    const timer = setTimeout(() => {
      timedOut = true;
      cleanup = killTree(child).catch((error) => { cleanupError = error.message; });
    }, timeoutMs);
    child.on('close', async (status, signal) => {
      clearTimeout(timer);
      await cleanup;
      const ok = status === 0 && !signal && !spawnError && !timedOut && !cleanupError;
      resolveResult({
        ok, code: ok ? 0 : (status && status > 0 ? status : 1),
        exitCode: status, signal, timedOut, error: spawnError, cleanupError,
        stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), truncated,
        command, commandArguments, currentDirectory: resolve(currentDirectory), executable: invocationDetails.executable,
        durationMs: Date.now() - started,
      });
    });
  });
}

// A managed worker keeps the legacy synchronous context.executeSynchronously API while allowing
// timeout handling to stop the child process tree before returning.
export function runCommand(command, currentDirectory, commandArguments = null, options = {}) {
  const { timeoutMs, maxOutputBytes } = limits(options);
  invocation(command, currentDirectory, commandArguments);
  const request = Buffer.from(JSON.stringify({ command, currentDirectory, commandArguments, options })).toString('base64');
  const result = spawnSync(process.execPath, [EXECUTION_WORKER_PATH, '--pou-exec-worker', request], {
    encoding: 'utf8', timeout: timeoutMs + 15_000,
    maxBuffer: maxOutputBytes * 8 + 65_536, windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Execution worker failed: ${result.error?.message ?? result.stderr ?? result.signal}`);
  }
  return JSON.parse(result.stdout);
}

export const runCommandQuiet = runCommand;

export function spawnBackground(command, currentDirectory, commandArguments = null) {
  const invocationDetails = invocation(command, currentDirectory, commandArguments);
  const child = spawn(invocationDetails.file, invocationDetails.commandArguments, {
    cwd: currentDirectory, shell: invocationDetails.shell, stdio: 'ignore',
    detached: process.platform !== 'win32', windowsHide: true,
  });
  owned.add(child);
  child.spawnError = null;
  child.on('error', (error) => { child.spawnError = error; });
  return child;
}

export async function killTree(child) {
  if (!child || !owned.has(child)) throw new TypeError('Only processes created by pou helpers may be stopped');
  if (child.spawnError) throw child.spawnError;
  if (child.pid == null) return;
  if (process.platform === 'win32') {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      encoding: 'utf8', timeout: 10_000, windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      if (child.exitCode !== null || child.signalCode !== null) return;
      throw new Error(`Process cleanup failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise((resolveExit, reject) => {
      const timer = setTimeout(() => reject(new Error('Owned process did not exit after cleanup')), 5000);
      child.once('close', () => { clearTimeout(timer); resolveExit(); });
    });
  }
}

if (process.argv[2] === '--pou-exec-worker' && resolve(process.argv[1]) === resolve(EXECUTION_WORKER_PATH)) {
  const request = JSON.parse(Buffer.from(process.argv[3], 'base64').toString('utf8'));
  try {
    const result = await runCommandAsynchronously(request.command, request.currentDirectory, request.commandArguments, request.options);
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stderr.write(error.message);
    process.exitCode = 1;
  }
}
