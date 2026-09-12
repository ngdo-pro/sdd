import { UsageError } from '../../core/errors.js';
import { loadConfig, writeConfig, getBackendConfig, assertKnownBackends } from '../../core/config.js';
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
    heading('Backends');
    table(
      config.backends.map((entry) => [
        entry.id,
        entry.type,
        entry.enabled ? 'enabled' : 'disabled',
        entry.required ? 'required' : '',
      ]),
      ['id', 'type', 'status', 'flag'],
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
  if (entry.required && action === 'disable') {
    throw new UsageError(`Backend "${id}" is required and cannot be disabled.`);
  }

  entry.enabled = action === 'enable';
  await writeConfig(cwd, config);

  success(`Backend "${id}" ${entry.enabled ? 'enabled' : 'disabled'} in .specs/config.json`);
  if (id === 'linear' && entry.enabled && !entry.settings?.teamKey) {
    info('Set settings.teamKey (and LINEAR_API_KEY) before syncing.');
  }
}
