import http from 'node:http';
import https from 'node:https';

export async function probeHttp(url, { attempts = 30, delayMs = 1000, timeoutMs = 3000, expectedStatus = 200 } = {}) {
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol)) throw new TypeError('Probe URL must use http or https');
  if (![attempts, timeoutMs].every((value) => Number.isSafeInteger(value) && value > 0) ||
      !Number.isSafeInteger(delayMs) || delayMs < 0 || attempts > 1000 ||
      timeoutMs > 2_147_000_000 || delayMs > 2_147_000_000 ||
      !Number.isSafeInteger(expectedStatus) || expectedStatus < 100 || expectedStatus > 599) {
    throw new TypeError('Invalid HTTP probe attempts, timing, or expectedStatus');
  }
  const started = Date.now();
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await new Promise((resolve) => {
      let settled = false;
      let timer;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const request = (target.protocol === 'https:' ? https : http).get(target, (response) => {
        response.resume();
        finish({ ok: response.statusCode === expectedStatus, status: response.statusCode });
        request.destroy();
      });
      request.on('error', (error) => finish({ ok: false, error: error.message }));
      timer = setTimeout(() => {
        finish({ ok: false, error: 'HTTP probe timed out' });
        request.destroy();
      }, timeoutMs);
    });
    if (last.ok || attempt === attempts) return { ...last, attempts: attempt, expectedStatus, durationMs: Date.now() - started };
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
