import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { probeHttp } from '../lib/http.mjs';

async function server(t, handler) {
  const instance = http.createServer(handler).listen(0, '127.0.0.1');
  await once(instance, 'listening');
  t.after(() => new Promise((resolve) => instance.close(resolve)));
  return `http://127.0.0.1:${instance.address().port}`;
}

test('404 and redirects do not prove health; an explicit expected status can', async (t) => {
  let count = 0;
  const url = await server(t, (_, response) => { count += 1; response.writeHead(404).end(); });
  const result = await probeHttp(url, { attempts: 2, delayMs: 1 });
  assert.equal(result.ok, false);
  assert.equal(count, 2);
  assert.equal((await probeHttp(url, { attempts: 1, expectedStatus: 404 })).ok, true);
});

test('timeouts schedule exactly one retry per attempt', async (t) => {
  let count = 0;
  const url = await server(t, () => { count += 1; });
  const result = await probeHttp(url, { attempts: 3, delayMs: 1, timeoutMs: 30 });
  assert.equal(result.ok, false);
  assert.equal(count, 3);
  assert.ok(result.durationMs < 1000);
});

test('successful health is measured and invalid inputs fail explicitly', async (t) => {
  const url = await server(t, (_, response) => response.end('healthy'));
  assert.equal((await probeHttp(url)).ok, true);
  await assert.rejects(probeHttp('file:///tmp/test'), /http or https/);
  await assert.rejects(probeHttp(url, { attempts: 0 }), /Invalid/);
});
