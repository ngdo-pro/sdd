import { createMcpClient } from '../../src/connectors/mcp/client.js';

// Fixture driver: performs one MCP call, prints the server pid, and exits
// WITHOUT calling close() — the client's process-exit handler must reap the
// spawned MCP server (INV-4: no zombie after a command that dies mid-flight).
const [serverScript, ...serverArgs] = process.argv.slice(2);
const client = createMcpClient({ command: process.execPath, args: [serverScript, ...serverArgs] });
await client.call('get_issue', { id: 'ENG-1' });
process.stdout.write(`PID:${client.pid}\n`);
process.exit(0);