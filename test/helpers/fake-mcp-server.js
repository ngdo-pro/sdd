import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FAKE_TOOLS = ['get_issue', 'list_issues', 'create_issue', 'update_issue'];
const KNOWN_STATES = ['Backlog', 'In Progress', 'Done'];

/**
 * JSON-RPC handler of a fake Linear MCP server (no network — tests spawn it on
 * stdio or mount it behind an in-process `node:http` server). Supports the
 * strict MCP sequence (`initialize` → `notifications/initialized` → tools) and
 * failure modes: `silent` (never answers, handshake timeout) and
 * `hangAfterInit` (answers the handshake only, call timeout).
 */
export function createFakeLinearRpc({
  issues = [],
  nextId = 100,
  stateFile = null,
  logFile = null,
  silent = false,
  hangAfterInit = false,
} = {}) {
  const store = new Map();
  let counter = nextId;
  let initialized = false;

  if (stateFile && existsSync(stateFile)) {
    const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
    for (const issue of saved.issues ?? []) store.set(issue.identifier, issue);
    if (Number.isFinite(saved.nextId)) counter = saved.nextId;
  }
  for (const issue of issues) store.set(issue.identifier, { ...issue });

  const persist = () => {
    if (!stateFile) return;
    writeFileSync(stateFile, `${JSON.stringify({ issues: [...store.values()], nextId: counter }, null, 2)}\n`);
  };
  const log = (tool, args) => {
    if (!logFile) return;
    appendFileSync(logFile, `${JSON.stringify({ tool, args })}\n`);
  };

  function stateName(raw) {
    const match = KNOWN_STATES.find((name) => name.toLowerCase() === String(raw ?? '').toLowerCase());
    if (!match) throw new Error(`Unknown workflow state "${raw ?? ''}"`);
    return match;
  }

  const envelope = (payload, isError = false) => ({
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {}),
  });

  return async function handle(method, params = {}) {
    if (String(method).startsWith('notifications/')) {
      if (method === 'notifications/initialized') initialized = true;
      return undefined; // notification — no response
    }
    // Failure modes apply to every request, the handshake included.
    if (silent || (hangAfterInit && initialized)) return new Promise(() => {}); // never answers
    if (method === 'initialize') {
      return {
        protocolVersion: params.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake-linear-mcp', version: '1.0.0' },
      };
    }
    if (method === 'tools/list') {
      return {
        tools: FAKE_TOOLS.map((name) => ({ name, description: `Fake Linear tool ${name}`, inputSchema: { type: 'object' } })),
      };
    }
    if (method !== 'tools/call') {
      throw new Error(`Unknown method "${method}"`);
    }

    const tool = params.name;
    log(tool, params.arguments ?? {});

    try {
      switch (tool) {
        case 'get_issue':
          return envelope(store.get(params.arguments?.id) ?? null);
        case 'list_issues':
          return envelope({ issues: [...store.values()] });
        case 'create_issue': {
          const input = params.arguments ?? {};
          const identifier = `${String(input.teamKey ?? 'ENG').toUpperCase()}-${counter}`;
          counter += 1;
          const issue = {
            identifier,
            title: input.title ?? '',
            state: { name: input.state ? stateName(input.state) : 'Backlog' },
            labels: input.labels ?? [],
            description: input.description ?? null,
          };
          store.set(identifier, issue);
          persist();
          return envelope({ identifier, title: issue.title, state: issue.state });
        }
        case 'update_issue': {
          const issue = store.get(params.arguments?.id);
          if (!issue) return envelope(`Issue not found: ${params.arguments?.id}`, true);
          if (params.arguments?.state !== undefined) issue.state = { name: stateName(params.arguments.state) };
          for (const [key, value] of Object.entries(params.arguments ?? {})) {
            if (key !== 'id' && key !== 'state') issue[key] = value;
          }
          persist();
          return envelope(issue);
        }
        default:
          return envelope(`Unknown tool: ${tool}`, true);
      }
    } catch (error) {
      return envelope(error?.message ?? String(error), true);
    }
  };
}

/** CLI flags: --silent, --hang-after-init, --state=<file>, --log=<file>, --issue=<id>|<state>|<title>[|<labels>] */
function parseArgv(argv) {
  const options = { issues: [] };
  for (const token of argv) {
    const [flag, ...rest] = token.split('=');
    const value = rest.join('=');
    switch (flag) {
      case '--silent': options.silent = true; break;
      case '--hang-after-init': options.hangAfterInit = true; break;
      case '--state': options.stateFile = value; break;
      case '--log': options.logFile = value; break;
      case '--issue': {
        const [identifier, state, title, labels] = value.split('|');
        options.issues.push({
          identifier,
          title: title ?? identifier,
          state: { name: state ?? 'Backlog' },
          labels: labels ? labels.split(',') : [],
        });
        break;
      }
      default: break;
    }
  }
  return options;
}

/** Stdio entry point: newline-delimited JSON-RPC on stdin/stdout. */
function main() {
  const handle = createFakeLinearRpc(parseArgv(process.argv.slice(2)));
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let separator;
    while ((separator = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, separator).trim();
      buffer = buffer.slice(separator + 1);
      if (line) void serve(line);
    }
  });
  process.stdin.on('end', () => process.exit(0));

  const write = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  async function serve(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!message || typeof message.method !== 'string') return;
    try {
      const result = await handle(message.method, message.params);
      if (result === undefined) return; // notification — no response
      write({ id: message.id, result });
    } catch (error) {
      write({ id: message.id, error: { code: -32603, message: error?.message ?? String(error) } });
    }
  }
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();