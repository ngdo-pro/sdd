import path from 'node:path';
import { parseArgs } from 'node:util';
import { UsageError } from '../core/errors.js';
import { line } from './render.js';
import { init } from './commands/init.js';
import { importArtifacts } from './commands/import.js';
import { migrate } from './commands/migrate.js';
import { render } from './commands/render.js';
import { model } from './commands/model.js';
import { upsert } from './commands/upsert.js';
import { move } from './commands/move.js';
import { done } from './commands/done.js';
import { link } from './commands/link.js';
import { status } from './commands/status.js';
import { list } from './commands/list.js';
import { sync } from './commands/sync.js';
import { backend } from './commands/backend.js';
import { validate } from './commands/validate.js';
import { VERSION, HELP } from './help.js';

const OPTIONS = {
  to: { type: 'string' },
  kind: { type: 'string' },
  state: { type: 'string' },
  slug: { type: 'string' },
  title: { type: 'string' },
  from: { type: 'string' },
  feature: { type: 'string' },
  initiative: { type: 'string' },
  field: { type: 'string', multiple: true },
  backend: { type: 'string', multiple: true },
  create: { type: 'boolean' },
  force: { type: 'boolean' },
  check: { type: 'boolean' },
  write: { type: 'boolean' },
  cascade: { type: 'boolean' },
  undo: { type: 'boolean' },
  done: { type: 'boolean' },
  site: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  json: { type: 'boolean' },
  cwd: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

const COMMANDS = {
  init,
  import: importArtifacts,
  migrate,
  render,
  model,
  upsert,
  move,
  done,
  link,
  status,
  list,
  ls: list,
  sync,
  backend,
  validate,
};

export async function run(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: false });
  } catch (error) {
    throw new UsageError(error.message);
  }

  const { values, positionals } = parsed;

  if (values.version) {
    line(`sdd-framework ${VERSION}`);
    return;
  }

  const command = positionals[0];
  if (!command || command === 'help' || values.help) {
    line(HELP);
    return;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    throw new UsageError(`Unknown command "${command}". Run \`spec help\` for the list of commands.`);
  }

  await handler({
    cwd: values.cwd ? path.resolve(values.cwd) : process.cwd(),
    positionals: positionals.slice(1),
    flags: {
      to: values.to,
      kind: values.kind,
      state: values.state,
      slug: values.slug,
      title: values.title,
      from: values.from,
      feature: values.feature,
      initiative: values.initiative,
      field: values.field,
      backends: values.backend,
      create: Boolean(values.create),
      force: Boolean(values.force),
      check: Boolean(values.check),
      write: Boolean(values.write),
      cascade: Boolean(values.cascade),
      undo: Boolean(values.undo),
      done: Boolean(values.done),
      site: Boolean(values.site),
      dryRun: Boolean(values['dry-run']),
      json: Boolean(values.json),
    },
  });
}

