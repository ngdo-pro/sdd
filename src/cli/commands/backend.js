import { UsageError } from '../../core/errors.js';
import { assertKnownBackends, getBackendConfig, loadConfig, writeConfig } from '../../core/config.js';
import { heading, info, printJson, success, table } from '../render.js';

/**
 * `spec backend list`
 * `spec backend enable <id>`
 * `spec backend disable <id>`
 */
export async function backend({ cwd, positionals, flags }) {
  const action = positionals[0] ?? 'list';
  const config = await loadConfig(cwd);

  if (action === 'list') {
    if (flags.json) {
      printJson(config.backends);
      return;
    }
    heading('Mirror backends (canonical source of truth: .specs/model/)');
    if (config.backends.length === 0) {
      info('No backend registered.');
      return;
    }
    table(
      config.backends.map((entry) => [entry.id, entry.type, entry.enabled ? 'enabled' : 'disabled']),
      ['id', 'type', 'status'],
    );
    return;
  }

  if (action !== 'enable' && action !== 'disable') {
    throw new UsageError(`Unknown backend action "${action}". Use: list | enable <id> | disable <id>.`);
  }

  const id = positionals[1];
  if (!id) throw new UsageError(`Usage: spec backend ${action} <id>`);
  assertKnownBackends(config, [id]);

  const entry = getBackendConfig(config, id);
  entry.enabled = action === 'enable';
  await writeConfig(cwd, config);

  success(`Backend "${id}" ${entry.enabled ? 'enabled' : 'disabled'} in .specs/config.json`);
  if (id === 'linear' && entry.enabled && !entry.settings?.teamKey) {
    info('Set settings.teamKey (and LINEAR_API_KEY) before syncing.');
  }
}
