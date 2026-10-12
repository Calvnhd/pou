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
    for (const [key, value] of Object.entries(briefing)) {
      console.log(`  ${key}: ${Array.isArray(value) ? value.join('; ') : value}`);
    }
  } else if (envelope.command === 'help') {
    console.log('Usage: pou <verb> [arguments] [--json]');
    console.log(`Profile: ${data.profile}${data.hasConfiguration ? '' : ' (not configured)'}`);
    for (const item of data.commands ?? []) {
      console.log(`  ${item.name}: ${item.summary}${item.hasInstructions ? '' : ' (briefing unavailable)'}`);
    }
    if (data.configurationError) console.log(`  configuration: ${data.configurationError}`);
  } else if (envelope.command === 'doctor') {
    console.log(`  currentDirectory: ${data.currentDirectory}`);
    for (const probe of data.probes ?? []) {
      console.log(`  ${probe.ok ? 'PASS' : 'FAIL'} ${probe.name}: ${probe.detail ?? ''}`);
      if (!probe.ok && probe.fix) console.log(`    fix: ${probe.fix}`);
    }
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}
