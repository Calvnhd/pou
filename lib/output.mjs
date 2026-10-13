export const EXIT_CODES = { ok: 0, degraded: 0, error: 1, unconfigured: 2 };

export class PouError extends Error {
  constructor(code, message, nextAction, status = 'error', details = {}) {
    super(message);
    this.code = code;
    this.nextAction = nextAction;
    this.status = status;
    this.details = details;
  }
}

export function makeEnvelope(command, status, data = {}) {
  if (!Object.hasOwn(EXIT_CODES, status)) throw new TypeError(`Invalid result status: ${status}`);
  return { command, status, timestamp: new Date().toISOString(), data };
}

export function failure(command, error) {
  const known = error instanceof PouError;
  const envelope = makeEnvelope(command, known ? error.status : 'error', known ? error.details : {});
  envelope.error = { code: known ? error.code : 'RUNTIME_ERROR', message: error.message ?? String(error) };
  envelope.next_action = known ? error.nextAction : 'Inspect the reported error and fix the command or configuration before retrying.';
  return envelope;
}

export function normalizeResult(command, result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new PouError('RESULT_CONTRACT', 'A function verb must return an explicit object result', 'Return { status, data } or a plain success-data object.');
  }
  if (!Object.hasOwn(result, 'status')) return makeEnvelope(command, 'ok', result);
  if (!Object.hasOwn(EXIT_CODES, result.status) ||
      (result.command !== undefined && result.command !== command) ||
      (result.data !== undefined && (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)))) {
    throw new PouError('RESULT_CONTRACT', 'Malformed function-verb result', 'Return a valid status and object data for the invoked command.');
  }
  const envelope = makeEnvelope(command, result.status, result.data ?? {});
  if (result.status !== 'ok') {
    if (typeof result.next_action !== 'string' || !result.next_action.trim() ||
        typeof result.error?.code !== 'string' || !result.error.code.trim() ||
        typeof result.error?.message !== 'string' || !result.error.message.trim()) {
      throw new PouError('RESULT_CONTRACT', 'Non-ok results require error.code, error.message, and next_action', 'Add an actionable reason and recovery instruction to the result.');
    }
    envelope.error = result.error;
    envelope.next_action = result.next_action;
  }
  return envelope;
}

export function renderEnvelope(envelope, asJson) {
  if (asJson) {
    console.log(JSON.stringify(envelope));
    return;
  }
  console.log(`${envelope.command}: ${envelope.status}`);
  if (envelope.error) console.log(`  ${envelope.error.code}: ${envelope.error.message}`);
  if (envelope.next_action) console.log(`  next: ${envelope.next_action}`);
  const data = envelope.data;
  if (envelope.command === 'instructions' || data.briefing) {
    const briefing = data.briefing ?? data;
    const entries = Object.entries(briefing);
    const keyWidth = Math.max(0, ...entries.map(([key]) => key.length)) + 1;
    for (const [key, value] of entries) {
      console.log(`  ${`${key}:`.padEnd(keyWidth)}  ${Array.isArray(value) ? value.join('; ') : value}`);
    }
  } else if (envelope.command === 'help') {
    console.log('Usage: pou <verb> [arguments] [--json]');
    console.log(`Profile: ${data.profile}${data.hasConfiguration ? '' : ' (not configured)'}`);
    const commands = data.commands ?? [];
    const width = Math.max(0, ...commands.map((item) => item.name.length));
    for (const item of commands) {
      console.log(`  ${item.name.padEnd(width)}  ${item.summary}${item.hasInstructions ? '' : ' (briefing unavailable)'}`);
    }
    if (data.configurationError) console.log(`  configuration: ${data.configurationError}`);
  } else if (envelope.command === 'profiles') {
    const profiles = data.profiles ?? [];
    const width = Math.max(0, ...profiles.map((profile) => profile.name.length));
    for (const profile of profiles) {
      console.log(`  ${profile.name === data.selected ? '*' : ' '}  ${profile.name.padEnd(width)}  ${profile.description}`);
    }
  } else if (envelope.command === 'doctor') {
    console.log(`  currentDirectory: ${data.currentDirectory}`);
    const probes = data.probes ?? [];
    const nameWidth = Math.max(0, ...probes.map((probe) => probe.name.length));
    for (const probe of probes) {
      console.log(`  ${probe.ok ? 'PASS' : 'FAIL'}  ${probe.name.padEnd(nameWidth)}  ${probe.detail ?? ''}`);
      if (!probe.ok && probe.fix) console.log(`        fix: ${probe.fix}`);
    }
  } else {
    renderData(data);
  }
}

const MAX_DETAIL_LINES = 20;

function formatValue(value) {
  if (Array.isArray(value)) return value.length ? value.join('; ') : 'none';
  if (value === null || typeof value !== 'object') return String(value);
  if (typeof value.detail === 'string') return value.detail;
  return Object.entries(value).filter(([, item]) => item === null || typeof item !== 'object').map(([key, item]) => `${key}=${item}`).join('  ');
}

function renderData(data) {
  const { steps = [], failed, ...rest } = data;
  const entries = Object.entries(rest).map(([key, value]) => [`${key}:`, formatValue(value)]);
  const keyWidth = Math.max(0, ...entries.map(([key]) => key.length));
  for (const [key, value] of entries) console.log(`  ${key.padEnd(keyWidth)}  ${value}`);
  if (steps.length === 0) return;
  const times = steps.map((step) => `${((step.durationMs ?? 0) / 1000).toFixed(1)}s`);
  const timeWidth = Math.max(...times.map((time) => time.length));
  console.log('  steps');
  steps.forEach((step, index) => {
    console.log(`    ${step.ok ? 'PASS' : 'FAIL'}  ${times[index].padStart(timeWidth)}  ${step.command ?? ''}`);
  });
  for (const step of steps) {
    // Build tools repeat output in a closing summary; show each distinct line once.
    const lines = [...new Set(`${step.stdout ?? ''}\n${step.stderr ?? ''}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
    if (lines.length === 0) continue;
    console.log(`  output (${step.command ?? 'step'})`);
    for (const line of lines.slice(0, MAX_DETAIL_LINES)) console.log(`    ${line}`);
    if (lines.length > MAX_DETAIL_LINES) console.log(`    ... ${lines.length - MAX_DETAIL_LINES} more lines (use --json for full output)`);
  }
}
