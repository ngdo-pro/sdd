import { UsageError } from '../../core/errors.js';
import {
  assertKnownBackends,
  getBackendConfig,
  loadConfig,
  mergeConnectorConfigs,
  writeConfig,
} from '../../core/config.js';
import { resolveConnectorDeclarations } from '../../connectors/registry.js';
import { assertNoCoexistence } from '../../migrate/migrate.js';
import { heading, info, printJson, success, table } from '../render.js';

/**
 * Binds raw settings flags to the positional connector id: un-namespaced keys
 * (`--teamKey=ENG`) attach to `<id>`, a namespace different from `<id>` is a
 * UsageError (INV-2).
 */
function bindSettingsToId(id, settingsFlags = {}) {
  const bound = {};
  for (const [key, raw] of Object.entries(settingsFlags)) {
    const separator = key.indexOf('.');
    if (separator === -1) {
      bound[`${id}.${key}`] = raw;
      continue;
    }
    const namespace = key.slice(0, separator);
    if (namespace !== id) {
      throw new UsageError(`Settings namespace "${namespace}" does not match connector "${id}".`);
    }
    bound[key] = raw;
  }
  return bound;
}

/**
 * `sdd connectors list`
 * `sdd connectors enable <id> [--<id>.<key>[.<subkey>]=<value> | --<key>=<value>]…`
 * `sdd connectors disable <id> [same settings]`
 *
 * `enable`/`disable` mutate `.sdd/config.json` (same merge mechanics as
 * `sdd init` — explicit values win, manifest defaults fill the absent keys)
 * and are locked during a pending migration (INV-5).
 */
export async function connectors({ cwd, positionals, flags }) {
  const action = positionals[0] ?? 'list';
  const config = await loadConfig(cwd);

  if (action === 'list') {
    if (flags.json) {
      printJson(config.connectors);
      return;
    }
    heading('Mirror connectors (canonical source of truth: .sdd/canonical/)');
    if (config.connectors.length === 0) {
      info('No connector registered.');
      return;
    }
    table(
      config.connectors.map((entry) => [entry.id, entry.type, entry.enabled ? 'enabled' : 'disabled']),
      ['id', 'type', 'status'],
    );
    return;
  }

  if (action !== 'enable' && action !== 'disable') {
    throw new UsageError(`Unknown connector action "${action}". Use: list | enable <id> | disable <id>.`);
  }

  const id = positionals[1];
  if (!id) throw new UsageError(`Usage: sdd connectors ${action} <id>`);
  assertNoCoexistence(cwd); // INV-5: config mutations locked during coexistence
  assertKnownBackends(config, [id]);

  const declarations = await resolveConnectorDeclarations(
    cwd,
    [id],
    bindSettingsToId(id, flags.settings),
    { requireManifest: false },
  ).then((resolved) => resolved.map((declaration) => ({ ...declaration, enabled: action === 'enable' })));

  config.connectors = mergeConnectorConfigs(config.connectors, declarations);
  await writeConfig(cwd, config);

  const entry = getBackendConfig(config, id);
  success(`Connector "${id}" ${entry.enabled ? 'enabled' : 'disabled'} in .sdd/config.json`);
  if (id === 'linear' && entry.enabled && !entry.settings?.teamKey) {
    info('Set settings.teamKey (and LINEAR_API_KEY) before syncing.');
  }
}
