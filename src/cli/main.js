import path from 'node:path';
import { parseArgs } from 'node:util';
import { UsageError } from '../core/errors.js';
import { line } from './render.js';
import { init } from './commands/init.js';
import { install } from './commands/install.js';
import { importArtifacts } from './commands/import.js';
import { migrate } from './commands/migrate.js';
import { render } from './commands/render.js';
import { graph } from './commands/graph.js';
import { upsert } from './commands/upsert.js';
import { move } from './commands/move.js';
import { done } from './commands/done.js';
import { link } from './commands/link.js';
import { status } from './commands/status.js';
import { list } from './commands/list.js';
import { sync } from './commands/sync.js';
import { connectors } from './commands/connectors.js';
import { validate } from './commands/validate.js';
import { VERSION, HELP } from './help.js';
import { checkUpdate, updateCheckDisabled } from './update-check.js';

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
  connector: { type: 'string', multiple: true },
  interactive: { type: 'boolean' },
  create: { type: 'boolean' },
  force: { type: 'boolean' },
  check: { type: 'boolean' },
  write: { type: 'boolean' },
  cascade: { type: 'boolean' },
  undo: { type: 'boolean' },
  done: { type: 'boolean' },
  host: { type: 'string' },
  init: { type: 'boolean' },
  'no-init': { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  json: { type: 'boolean' },
  'no-update-check': { type: 'boolean' },
  cwd: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

const COMMANDS = {
  init,
  install,
  import: importArtifacts,
  migrate,
  render,
  graph,
  upsert,
  move,
  done,
  link,
  status,
  list,
  ls: list,
  sync,
  connectors,
  validate,
};

export async function run(argv, { fetchImpl } = {}) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: false });
  } catch (error) {
    throw new UsageError(error.message);
  }

  const { values, positionals } = parsed;

  if (values.version) {
    line(`@ngdo-pro/sdd ${VERSION}`);
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

  // Settings flags: `--<id>.<key>[.<subkey>=<value>]` collected verbatim
  // (parseArgs with strict: false exposes them as dotted values keys), plus
  // un-namespaced keys which `connectors enable <id>` binds to its positional.
  // A dotted flag without a value is a malformed call — rejected here so no
  // command ever sees a silent `true` (INV-2). Repeated occurrences of the
  // same dotted flag (`--linear.mcp.args=-y --linear.mcp.args=npx`) collapse
  // to their last value in parseArgs — collect every occurrence so array
  // settings like `mcp.args` arrive as string arrays (spec 005 §4.1).
  const repeated = new Map();
  for (const token of argv) {
    const separator = token.indexOf('=');
    if (!token.startsWith('--') || separator === -1) continue;
    const key = token.slice(2, separator);
    if (!key.includes('.')) continue;
    const values = repeated.get(key) ?? [];
    values.push(token.slice(separator + 1));
    repeated.set(key, values);
  }

  const declaredOptions = new Set(Object.keys(OPTIONS));
  const settings = {};
  for (const [key, value] of Object.entries(values)) {
    const isDotted = key.includes('.');
    if (!isDotted && declaredOptions.has(key)) continue;
    if (value === true) {
      throw new UsageError(`Option "--${key}" requires a value (--${key}=<value>).`);
    }
    const occurrences = repeated.get(key);
    settings[key] = occurrences && occurrences.length > 1 ? occurrences : value;
  }

  const cwd = values.cwd ? path.resolve(values.cwd) : process.cwd();

  // Post-run update notice (spec 009): strictly after the command output, one
  // line on stderr, never before stdout output and never touching the exit
  // code. One check per run() invocation, inside a `finally` with a total
  // try/catch so a failing check can never break a command — even a
  // command whose handler threw (INV-2). Opt-outs: `--no-update-check` or a
  // non-empty SDD_NO_UPDATE_CHECK → no fetch, no cache write (INV-3).
  try {
    await handler({
      cwd,
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
        connectors: values.connector,
        create: Boolean(values.create),
        force: Boolean(values.force),
        check: Boolean(values.check),
        write: Boolean(values.write),
        cascade: Boolean(values.cascade),
        undo: Boolean(values.undo),
        done: Boolean(values.done),
        host: values.host,
        init: values['no-init'] ? false : (values.init ?? true),
        dryRun: Boolean(values['dry-run']),
        json: Boolean(values.json),
        interactive: Boolean(values.interactive),
        settings,
      },
    });
  } finally {
    try {
      if (!updateCheckDisabled({ flag: Boolean(values['no-update-check']) })) {
        const { notice, cached } = await checkUpdate({ cwd, fetchImpl });
        // §4.2 "Fraîcheur: aucun fetch, aucun affichage": a cache-served
        // answer is returned by checkUpdate (the §8.1 cache scenario asserts
        // it) but never displayed — the notice shows only when this very
        // invocation fetched a newer version, i.e. at most once per 24 h.
        if (notice && !cached) process.stderr.write(notice);
      }
    } catch {
      // Best-effort by contract: a failing update check is swallowed.
    }
  }
}

