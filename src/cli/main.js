import path from 'node:path';
import { parseArgs } from 'node:util';
import { UsageError } from '../core/errors.js';
import { line } from './render.js';
import { init } from './commands/init.js';
import { move } from './commands/move.js';
import { status } from './commands/status.js';
import { list } from './commands/list.js';
import { link } from './commands/link.js';
import { sync } from './commands/sync.js';
import { backend } from './commands/backend.js';
import { validate } from './commands/validate.js';
import { VERSION, HELP } from './help.js';

const OPTIONS = {
  to: { type: 'string' },
  kind: { type: 'string' },
  state: { type: 'string' },
  backend: { type: 'string', multiple: true },
  feature: { type: 'string' },
  initiative: { type: 'string' },
  create: { type: 'boolean' },
  force: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  json: { type: 'boolean' },
  cwd: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

const COMMANDS = { init, move, status, list, link, sync, backend, validate };

export async function run(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: false });
  } catch (error) {
    throw new UsageError(error.message);
  }

  const { values, positionals } = parsed;

  if (values.version) {
    line(`spec-framework ${VERSION}`);
    return;
  }

  const command = positionals[0];
  if (!command || command === 'help' || values.help) {
    line(HELP);
    return;
  }

  const handler = COMMANDS[command] ?? (command === 'ls' ? COMMANDS.list : null);
  if (!handler) {
    throw new UsageError(`Unknown command "${command}". Run \`spec help\` for the list of commands.`);
  }

  const context = {
    cwd: values.cwd ? path.resolve(values.cwd) : process.cwd(),
    positionals: positionals.slice(1),
    flags: {
      to: values.to,
      kind: values.kind,
      state: values.state,
      backends: values.backend,
      feature: values.feature,
      initiative: values.initiative,
      create: Boolean(values.create),
      force: Boolean(values.force),
      dryRun: Boolean(values['dry-run']),
      json: Boolean(values.json),
    },
  };

  await handler(context);
}
