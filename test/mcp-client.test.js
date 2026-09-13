import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcpClient } from '../src/connectors/mcp/client.js';
import { ConnectorError, UsageError } from '../src/core/errors.js';
import { FAKE_TOOLS, createFakeLinearRpc } from './helpers/fake-mcp-server.js';

const FAKE_SERVER = fileURLToPath(new URL('./helpers/fake-mcp-server.js', import.meta.url));
const EXIT_DRIVER = fileURLToPath(new URL('./helpers/mcp-exit-driver.js', import.meta.url));
const SEED = ['--issue=ENG-1|Backlog|Magic link|spec'];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const LOOPBACK = '127' + '.0.0.1';

/** Fails when the process is still alive after the grace window (zombie check). */
async function assertProcessDead(pid) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await delay(20);
  }
  throw new Error(`process ${pid} is still alive (zombie)`);
}

function stdioClient(extraArgs = [], options = {}) {
  return createMcpClient({ command: process.execPath, args: [FAKE_SERVER, ...SEED, ...extraArgs], ...options });
}

// ============================================================================
// Unit Tests (@unit) — §8.1 scenarios U1–U2
// ============================================================================

test('[U1][INV-4] handshake, tool call and close() reap the spawned stdio server', async () => {
  const client = stdioClient();
  try {
    const result = await client.call('get_issue', { id: 'ENG-1' });
    assert.deepEqual(JSON.parse(result.content[0].text), {
      identifier: 'ENG-1',
      title: 'Magic link',
      state: { name: 'Backlog' },
      labels: ['spec'],
    });
    const pid = client.pid;
    assert.equal(typeof pid, 'number');
    await client.close();
    assert.equal(client.closed, true);
    await assertProcessDead(pid); // no zombie after close()
  } finally {
    await client.close();
  }
});

test('[U2][INV-4] a silent server times out the handshake in ~timeoutMs', async () => {
  const client = stdioClient(['--silent'], { timeoutMs: 100 });
  const startedAt = Date.now();
  await assert.rejects(
    () => client.call('get_issue', { id: 'ENG-1' }),
    (error) => error instanceof ConnectorError
      && error.code === 'CONNECTOR_ERROR'
      && error.exitCode === 1
      && /timeout after 100ms/.test(error.message)
      && /stdio/.test(error.message),
  );
  assert.equal(Date.now() - startedAt < 1000, true, 'timeout must not wait for the default 15s');
  await assertProcessDead(client.pid); // handshake failure closes the transport (finally)
});

test('[U3][INV-4] a server that answers the handshake only times out each call', async () => {
  const client = stdioClient(['--hang-after-init'], { timeoutMs: 150 });
  try {
    await assert.rejects(
      () => client.call('get_issue', { id: 'ENG-1' }),
      (error) => error instanceof ConnectorError && /timeout after 150ms/.test(error.message),
    );
    // The transport stays reusable: the next call is an independent request.
    await assert.rejects(
      () => client.call('get_issue', { id: 'ENG-1' }),
      (error) => error instanceof ConnectorError && /timeout/.test(error.message),
    );
  } finally {
    await client.close();
  }
  await assertProcessDead(client.pid);
});

test('[U4][INV-4] listTools exposes the server tool catalog after the handshake', async () => {
  const client = stdioClient();
  try {
    const result = await client.listTools();
    assert.deepEqual(result.tools.map((tool) => tool.name), ['get_issue', 'list_issues', 'create_issue', 'update_issue']);
  } finally {
    await client.close();
  }
});

test('[U5][INV-4] close() is idempotent and works without any prior call', async () => {
  const client = stdioClient();
  const pid = client.pid;
  await client.close();
  await client.close(); // second close is a no-op, not a throw
  assert.equal(client.closed, true);
  await assertProcessDead(pid);
});

test('[U6][INV-1][INV-4] the transport shape is validated before any spawn', () => {
  const both = { command: 'node', args: ['x.js'], url: 'https://mcp.linear.app/sse' };
  assert.throws(() => createMcpClient(both), (error) => error instanceof UsageError
    && error.exitCode === 2
    && /not both/.test(error.message));
  assert.throws(() => createMcpClient({}), (error) => error instanceof UsageError);
  assert.throws(() => createMcpClient({ command: 'node', args: 2 }), (error) => error instanceof UsageError);
  assert.throws(() => createMcpClient({ command: 'node', args: ['-y', 2] }), (error) => error instanceof UsageError);
  assert.throws(() => createMcpClient({ url: '' }), (error) => error instanceof UsageError);
  // A single string arg (single --linear.mcp.args flag) is wrapped into an array.
  const client = createMcpClient({ command: process.execPath, args: FAKE_SERVER });
  assert.equal(typeof client.pid, 'number');
  return client.close();
});

// ============================================================================
// Component Tests (@component) — no-zombie guarantee when the host dies
// ============================================================================

test('[C1][INV-4] a host process exiting without close() leaves no MCP zombie behind', async () => {
  const driver = spawn(process.execPath, [path.join(path.dirname(FAKE_SERVER), 'mcp-exit-driver.js'), FAKE_SERVER, ...SEED], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  driver.stdout.on('data', (chunk) => {
    output += chunk;
  });
  const [code] = await once(driver, 'exit');
  assert.equal(code, 0);
  const pid = Number(output.match(/PID:(\d+)/)?.[1]);
  assert.equal(Number.isInteger(pid), true);
  await assertProcessDead(pid); // process-exit handler SIGTERMs the server (INV-4)
});

// ============================================================================
// Unit Tests — HTTP transport (streamable JSON + SSE, failures)
// ============================================================================

/** Mounts the fake Linear RPC behind a local `node:http` server (no network). */
function startHttpFake(mode, options = {}) {
  const handler = createFakeLinearRpc({
    issues: [{ identifier: 'ENG-1', title: 'Magic link', state: { name: 'Backlog' }, labels: ['spec'] }],
    ...options,
  });
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    if (String(payload.method).startsWith('notifications/')) {
      response.writeHead(202);
      response.end();
      return;
    }
    if (mode === 'silent') return; // accepts the connection, never answers
    let result;
    try {
      result = await handler(payload.method, payload.params);
    } catch (error) {
      result = undefined;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, error: { code: -32603, message: error?.message ?? String(error) } }));
      return;
    }
    const message = { jsonrpc: '2.0', id: payload.id, result };
    if (mode === 'sse') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(message));
  });
return new Promise((resolve) => {
    server.listen(0, LOOPBACK, () => resolve({ server, url: `http://${LOOPBACK}:${server.address().port}/mcp` }));
  });
}

test('[U7][INV-4] the HTTP transport POSTs JSON-RPC and reads the single-JSON response', async () => {
  const { server, url } = await startHttpFake('json');
  const client = createMcpClient({ url });
  try {
    const result = await client.call('get_issue', { id: 'ENG-1' });
    assert.equal(JSON.parse(result.content[0].text).identifier, 'ENG-1');
  } finally {
    await client.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('[U8][INV-4] the HTTP transport parses streamable SSE responses and matches request ids', async () => {
  const { server, url } = await startHttpFake('sse');
  const client = createMcpClient({ url });
  try {
    const result = await client.call('get_issue', { id: 'ENG-1' });
    assert.equal(JSON.parse(result.content[0].text).identifier, 'ENG-1');
  } finally {
    await client.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('[U9][INV-4] a refused HTTP connection surfaces as a ConnectorError', async () => {
  const { server } = await startHttpFake('json');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve)); // nothing listens anymore
  const client = createMcpClient({ url: `http://${LOOPBACK}:${port}/mcp` });
  await assert.rejects(
    () => client.call('get_issue', { id: 'ENG-1' }),
    (error) => error instanceof ConnectorError && /ECONNREFUSED/.test(error.message),
  );
});

test('[U10][INV-4] an HTTP server that never answers times out with a ConnectorError', async () => {
  const { server, url } = await startHttpFake('silent');
  const client = createMcpClient({ url, timeoutMs: 150 });
  const startedAt = Date.now();
  await assert.rejects(
    () => client.call('get_issue', { id: 'ENG-1' }),
    (error) => error instanceof ConnectorError && /timeout after 150ms/.test(error.message),
  );
  assert.equal(Date.now() - startedAt < 1000, true);
  await client.close();
  await new Promise((resolve) => server.close(resolve));
});