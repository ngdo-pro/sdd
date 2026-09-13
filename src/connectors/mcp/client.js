import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { ConnectorError, UsageError } from '../../core/errors.js';

const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_INFO = { name: 'sdd-framework', version: '2.0.0' };
const KILL_GRACE_MS = 1000;
const DEFAULT_TIMEOUT_MS = 15000;

/** A transport is exactly one of `{ command, args }` (stdio) or `{ url }` (HTTP). */
function validateTransport({ command, args, url }) {
  const hasStdio = command !== undefined;
  const hasHttp = url !== undefined;
  if (hasStdio && hasHttp) {
    throw new UsageError('settings.mcp must define either {command, args} (stdio) or {url} (HTTP), not both.');
  }
  if (!hasStdio && !hasHttp) {
    throw new UsageError('settings.mcp must define either {command, args} (stdio) or {url} (HTTP).');
  }
  if (hasStdio) {
    if (typeof command !== 'string' || command.length === 0) {
      throw new UsageError('settings.mcp.command must be a non-empty string.');
    }
    const normalizedArgs = typeof args === 'string' ? [args] : args ?? [];
    if (!Array.isArray(normalizedArgs) || normalizedArgs.some((arg) => typeof arg !== 'string')) {
      throw new UsageError('settings.mcp.args must be an array of strings.');
    }
    return { kind: 'stdio', command, args: normalizedArgs };
  }
  if (typeof url !== 'string' || url.length === 0) {
    throw new UsageError('settings.mcp.url must be a non-empty string.');
  }
  return { kind: 'http', url };
}

/**
 * Minimal MCP client on the standard library only (INV-4): JSON-RPC 2.0 with a
 * strict `initialize` → `initialized` → tools sequence, newline-delimited
 * frames over stdio (no Content-Length/LSP framing) or streamable HTTP POSTs
 * (JSON body or SSE stream, responses matched by request id — no reconnect:
 * the client is ephemeral). Timeouts on the handshake AND every call reject
 * with a `ConnectorError` whose message names the transport.
 */
export function createMcpClient({ command, args, url, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const transport = validateTransport({ command, args, url });
  return transport.kind === 'stdio'
    ? createStdioClient(transport, timeoutMs)
    : createHttpClient(transport, timeoutMs);
}

function createStdioClient(transport, timeoutMs) {
  const label = `stdio (${[transport.command, ...transport.args].join(' ')})`;
  const child = spawn(transport.command, transport.args, { stdio: ['pipe', 'pipe', 'pipe'] });

  let closed = false;
  let buffer = '';
  let stderrTail = '';
  let nextId = 1;
  let handshake = null;
  let closePromise = null;
  const pending = new Map();

  const killChild = () => {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  };
  // No zombies: a forgotten client is reaped when the host process exits.
  process.once('exit', killChild);

  const refStreams = () => {
    child.stdin.ref?.();
    child.stdout.ref?.();
    child.stderr.ref?.();
    child.ref?.();
  };
  const unrefStreams = () => {
    child.stdin.unref?.();
    child.stdout.unref?.();
    child.stderr.unref?.();
    child.unref?.();
  };

  const failAll = (error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };

  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let separator;
    while ((separator = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, separator).trim();
      buffer = buffer.slice(separator + 1);
      if (line) deliver(line);
    }
  });
  child.stderr.on('data', (chunk) => {
    stderrTail = `${stderrTail}${chunk}`.slice(-2000);
  });
  child.on('error', (error) => {
    closed = true;
    process.removeListener('exit', killChild);
    failAll(new ConnectorError(`MCP ${label}: ${error.message}${stderrDetail()}`));
  });
  child.on('exit', (code) => {
    closed = true;
    process.removeListener('exit', killChild);
    failAll(new ConnectorError(`MCP ${label}: server exited unexpectedly (code ${code ?? 'signal'})${stderrDetail()}`));
  });

  function stderrDetail() {
    return stderrTail.trim() ? `: ${stderrTail.trim().slice(-200)}` : '';
  }

  function deliver(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return; // tolerate server chatter on stdout
    }
    const entry = pending.get(message?.id);
    if (!entry) return; // notification or unknown id
    clearTimeout(entry.timer);
    pending.delete(message.id);
    if (message.error) {
      entry.reject(new ConnectorError(`MCP ${label}: ${entry.method} failed: ${message.error.message ?? JSON.stringify(message.error)}`));
      return;
    }
    entry.resolve(message.result);
  }

  function request(method, params) {
    if (closed) {
      return Promise.reject(new ConnectorError(`MCP ${label}: client closed`));
    }
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new ConnectorError(`MCP ${label}: timeout after ${timeoutMs}ms waiting for "${method}"`));
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      refStreams();
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, (error) => {
        if (error) {
          pending.delete(id);
          clearTimeout(timer);
          reject(new ConnectorError(`MCP ${label}: ${method} failed: ${error.message}${stderrDetail()}`));
        }
      });
    }).finally(() => {
      if (pending.size === 0) unrefStreams();
    });
  }

  function notify(method, params) {
    if (closed) return;
    refStreams();
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`, () => {
      if (pending.size === 0) unrefStreams();
    });
  }

  function ensureHandshake() {
    if (handshake) return handshake;
    handshake = request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    }).then(
      (result) => {
        notify('notifications/initialized');
        return result;
      },
      (error) => {
        handshake = null;
        close(); // a failed handshake leaves an unusable transport — kill the child (INV-4)
        throw error;
      },
    );
    return handshake;
  }

  function close() {
    if (closePromise) return closePromise;
    closed = true;
    failAll(new ConnectorError(`MCP ${label}: client closed`));
    process.removeListener('exit', killChild);
    if (child.exitCode !== null || child.signalCode !== null) {
      closePromise = Promise.resolve();
      return closePromise;
    }
    closePromise = new Promise((resolve) => {
      const fallback = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }, KILL_GRACE_MS);
      fallback.unref?.();
      child.once('exit', () => {
        clearTimeout(fallback);
        resolve();
      });
      killChild();
    });
    return closePromise;
  }

  return {
    async call(tool, args) {
      await ensureHandshake();
      return request('tools/call', { name: tool, arguments: args });
    },
    async listTools() {
      await ensureHandshake();
      return request('tools/list', {});
    },
    close,
    get closed() {
      return closed;
    },
    get pid() {
      return child.pid ?? null;
    },
  };
}

function createHttpClient(transport, timeoutMs) {
  const label = `http (${transport.url})`;
  const endpoint = new URL(transport.url);
  const requester = endpoint.protocol === 'https:' ? https : http;
  let closed = false;
  let nextId = 1;
  let handshake = null;

  function post(payload) {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      timer.unref?.();
      const request = requester.request(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        signal: controller.signal,
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('error', (error) => reject(new ConnectorError(`MCP ${label}: ${error.message}`)));
        response.on('end', () => {
          clearTimeout(timer);
          const text = Buffer.concat(chunks).toString('utf8');
          if ((response.statusCode ?? 500) >= 300) {
            reject(new ConnectorError(`MCP ${label}: HTTP ${response.statusCode}: ${text.slice(0, 200)}`));
            return;
          }
          resolve({ contentType: String(response.headers['content-type'] ?? ''), text });
        });
      });
      request.on('error', (error) => {
        clearTimeout(timer);
        reject(new ConnectorError(
          controller.signal.aborted
            ? `MCP ${label}: timeout after ${timeoutMs}ms`
            : `MCP ${label}: ${error.message}`,
        ));
      });
      request.end(JSON.stringify(payload));
    });
  }

  function matchResponse({ contentType, text }, id, method) {
    const messages = contentType.includes('text/event-stream')
      ? text.split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => parseJson(line.slice(5).trim()))
        .filter(Boolean)
      : [parseJson(text)];
    const message = messages.find((candidate) => candidate?.id === id);
    if (!message) {
      throw new ConnectorError(`MCP ${label}: ${method}: no response for request id ${id}`);
    }
    if (message.error) {
      throw new ConnectorError(`MCP ${label}: ${method} failed: ${message.error.message ?? JSON.stringify(message.error)}`);
    }
    return message.result;
  }

  function ensureHandshake() {
    if (handshake) return handshake;
    handshake = (async () => {
      const id = nextId;
      nextId += 1;
      const response = await post({
        jsonrpc: '2.0',
        id,
        method: 'initialize',
        params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
      });
      matchResponse(response, id, 'initialize');
      await post({ jsonrpc: '2.0', method: 'notifications/initialized' }); // notification — no id to match
      return true;
    })().catch((error) => {
      handshake = null;
      throw error;
    });
    return handshake;
  }

  async function request(method, params) {
    if (closed) throw new ConnectorError(`MCP ${label}: client closed`);
    await ensureHandshake();
    const id = nextId;
    nextId += 1;
    return matchResponse(await post({ jsonrpc: '2.0', id, method, params }), id, method);
  }

  return {
    call: (tool, args) => request('tools/call', { name: tool, arguments: args }),
    listTools: () => request('tools/list', {}),
    close: () => {
      closed = true;
      return Promise.resolve();
    },
    get closed() {
      return closed;
    },
    get pid() {
      return null;
    },
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}