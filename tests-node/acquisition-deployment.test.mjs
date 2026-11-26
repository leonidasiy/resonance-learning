import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { createAcquisitionDeployment } from '../acquisition/deployment.ts';
import { createImageDecoder } from '../acquisition/image-decoder.ts';
import { ACQUISITION_POLICY as policy } from '../worker/acquisition-policy.js';
import gateway from '../worker/acquisition-gateway.js';

const token = 'synthetic-test-token-32-characters-only';
const deployment = env => createAcquisitionDeployment({ env, nodePath: process.execPath, platform: 'linux', logger: () => {} });

test('deployment defaults bind loopback and keep authentication without Chrome', async () => {
  const runtime = await deployment({ ACQUISITION_TOKEN: token });
  assert.equal(runtime.host, '127.0.0.1');
  assert.equal(runtime.port, 8788);
  assert.equal(runtime.mode, 'loopback');
  assert.equal((await runtime.handler(new Request('https://acquisition.example/v1/operations/synthetic-test-0001', { method: 'DELETE' }))).status, 401);
  const response = await runtime.handler(new Request('https://acquisition.example/v1/operations/synthetic-test-0001', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.kind, 'OperationNotFound');
});

test('deployment reads token files and rejects unsafe or incomplete listener configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'acquisition-deployment-'));
  try {
    const file = join(directory, 'token');
    await writeFile(file, `${token}\n`, { mode: 0o600 });
    const runtime = await deployment({ ACQUISITION_TOKEN_FILE: file });
    runtime.server.close();
    for (const overrides of [
      { ACQUISITION_TOKEN: undefined }, { ACQUISITION_TOKEN: 'short' },
      { ACQUISITION_TOKEN: `${token}\n` }, { ACQUISITION_TOKEN_FILE: file },
      { ACQUISITION_TRANSPORT: 'http' }, { ACQUISITION_HOST: '0.0.0.0' },
      { ACQUISITION_PORT: '0' }, { ACQUISITION_PORT: '65536' },
      { ACQUISITION_TRANSPORT: 'tls' }, { ACQUISITION_TLS_KEY_FILE: file },
      { ACQUISITION_MAX_ACTIVE: '3', ACQUISITION_MAX_RETAINED: '2' },
      { ACQUISITION_CHROME_PATH: 'chrome' },
    ]) await assert.rejects(deployment({ ACQUISITION_TOKEN: token, ...overrides }), /ConfigurationInvalid/);
  } finally { await rm(directory, { recursive: true }); }
});

test('portable image decoder validates real PNG/JPEG/WebP/GIF bytes and rejects corrupt or oversized images', async () => {
  const decode = createImageDecoder({ policy, nodePath: process.execPath });
  for (const format of ['png', 'jpeg', 'webp', 'gif']) {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#123456' } }).toFormat(format).toBuffer();
    assert.deepEqual(await decode(bytes, `image/${format}`, new AbortController().signal), { ok: true, value: null }, format);
    assert.equal((await decode(bytes.subarray(0, Math.floor(bytes.length / 2)), `image/${format}`, new AbortController().signal)).ok, false, `${format} truncated`);
  }
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#123456' } }).png().toBuffer();
  const tiny = createImageDecoder({ policy: { ...policy, imageBytes: 10 }, nodePath: process.execPath });
  assert.equal((await tiny(bytes, 'image/png', new AbortController().signal)).error.kind, 'EncodedLimitExceeded');
  const cancelled = new AbortController(); cancelled.abort();
  assert.equal((await decode(bytes, 'image/png', cancelled.signal)).error.kind, 'Cancelled');
});

test('portable image decoder kills a decoding child at its deadline', async () => {
  const decode = createImageDecoder({ policy: { ...policy, requestMilliseconds: 1 }, nodePath: process.execPath });
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#123456' } }).png().toBuffer();
  const start = Date.now();
  assert.equal((await decode(bytes, 'image/png', new AbortController().signal)).error.kind, 'TimedOut');
  assert.ok(Date.now() - start < 1000);
});

test('private gateway permits only configured origin operations, strips unrelated credentials and rejects redirects', async t => {
  const calls = [];
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ ok: true, value: null });
  });
  const env = { ACQUISITION_ORIGIN: 'https://acquisition.example' };
  const request = (url = 'https://acquisition.example/v1/operations/synthetic-test-0001') => new Request(url, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, cookie: 'private-cookie', 'x-secret': 'do-not-forward' }, body: '{}',
  });
  assert.equal((await gateway.fetch(request(), env)).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://acquisition.example/v1/operations/synthetic-test-0001');
  assert.deepEqual(calls[0].init.headers, { authorization: `Bearer ${token}`, 'content-type': 'application/json' });
  assert.equal(calls[0].init.redirect, 'manual');
  for (const url of ['https://other.example/v1/operations/synthetic-test-0001', 'https://acquisition.example/v1/operations/synthetic-test-0001?redirect=other', 'https://acquisition.example/not-an-operation']) {
    assert.equal((await gateway.fetch(request(url), env)).status, 400);
  }
  assert.equal((await gateway.fetch(new Request('https://acquisition.example/v1/operations/synthetic-test-0001', { method: 'DELETE' }), env)).status, 401);
  assert.equal((await gateway.fetch(request(), { ACQUISITION_ORIGIN: 'http://acquisition.example' })).status, 502);
  assert.equal(calls.length, 1);
  fetchMock.mock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: 'https://other.example' } }));
  assert.equal((await gateway.fetch(request(), env)).status, 502);
  fetchMock.mock.mockImplementation(async () => new Response('Tunnel not found',{status:530,headers:{'content-type':'text/html'}}));
  const offline=await gateway.fetch(request(),env);
  assert.equal(offline.status,502);
  assert.deepEqual(await offline.json(),{ok:false,error:{kind:'ConnectFailed',field:'acquisition-service'}});
});

test('a renewed tunnel keeps existing workflow routing identities without forwarding to the old address',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url)=>{calls.push(String(url));return Response.json({ok:false,error:{kind:'OperationNotFound'}},{status:404});});
  const response=await gateway.fetch(new Request('https://old-tunnel.example/v1/operations/synthetic-test-0001',{method:'DELETE',headers:{authorization:`Bearer ${token}`}}),{ACQUISITION_ORIGIN:'https://renewed-tunnel.example',ACQUISITION_CLIENT_ORIGIN:'https://old-tunnel.example'});
  assert.equal(response.status,404);assert.deepEqual(calls,['https://renewed-tunnel.example/v1/operations/synthetic-test-0001']);
});

test('production launcher starts authenticated loopback without Chrome, logs no token, and shuts down', async () => {
  // Reserve a port briefly rather than relying on a fixed developer port.
  const { createServer } = await import('node:net');
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['scripts/acquisition-server.mjs'], {
    env: { ...process.env, ACQUISITION_TOKEN_FILE: '', ACQUISITION_TOKEN: token, ACQUISITION_PORT: String(port), ACQUISITION_TRANSPORT: 'loopback', ACQUISITION_HOST: '127.0.0.1', ACQUISITION_CHROME_PATH: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  try {
    await Promise.race([
      new Promise(resolve => child.stdout.on('data', () => { if (output.includes('acquisition-listening')) resolve(); })),
      exited.then(() => { throw new Error(`launcher exited before listening: ${output}`); }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('launcher startup timed out')), 5000).unref()),
    ]);
    const response = await fetch(`http://127.0.0.1:${port}/v1/operations/synthetic-test-0001`, { method: 'DELETE' });
    assert.equal(response.status, 401);
    assert.equal(output.includes(token), false);
    child.kill('SIGTERM');
    assert.deepEqual(await exited, { code: 0, signal: null });
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
});
