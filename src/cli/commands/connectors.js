import { UsageError } from '../../core/errors.js';
import {
  assertKnownBackends,
  getBackendConfig,
  loadConfig,
  mergeConnectorConfigs,
  writeConfig,
} from '../../core/config.js';
import { findManifest, manifestHint, resolveConnectorDeclarations } from '../../connectors/registry.js';
import { assertNoCoexistence } from '../../migrate/migrate.js';
import { heading, info, line, printJson, success, table } from '../render.js';

/**
 * Binds raw settings flags to the positional connector id: un-namespaced keys
 * (`--teamKey=ENG`) and top-level dotted paths of a declared setting
 * (`--mcp.command=npx`) attach to `<id>`, a namespace equal to `<id>` passes
 * through unchanged, anything else is a UsageError (INV-2). The dotted
 * disambiguation reads the manifest `settingTypes` — no connector id is ever
 * special-cased here (INV-3).
 */
function bindSettingsToId(id, settingsFlags = {}, settingTypes = {}) {
  const bound = {};
  for (const [key, raw] of Object.entries(settingsFlags)) {
    const separator = key.indexOf('.');
    if (separator === -1) {
      bound[`${id}.${key}`] = raw;
      continue;
    }
    const namespace = key.slice(0, separator);
    if (namespace === id) {
      bound[key] = raw;
      continue;
    }
    if (Object.hasOwn(settingTypes, namespace)) {
      bound[`${id}.${key}`] = raw;
      continue;
    }
    throw new UsageError(`Settings namespace "${namespace}" does not match connector "${id}".`);
  }
  return bound;
}

/**
 * Required settings that are missing or empty in the resolved entry (same
 * "present and non-empty" semantics as the `connector-settings` rule).
 */
function missingRequiredSettings(manifest, entry) {
  const settings = entry?.settings ?? {};
  const isEmpty = (value) => value === undefined || value === null || value === ''
    || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
  return (manifest?.requiredSettings ?? []).filter((key) => isEmpty(settings[key]));
}

/**
 * `sdd connectors list`
 * `sdd connectors enable <id> [--<id>.<key>[.<subkey>]=<value> | --<key>[.<subkey>]=<value>]… [--dry-run]`
 * `sdd connectors disable <id> [same settings] [--dry-run]`
 *
 * `enable`/`disable` mutate `.sdd/config.json` through the same registry
 * helpers as `sdd init` (unified grammar, INV-1: explicit values win, manifest
 * defaults fill the absent keys) and are locked during a pending migration
 * (INV-5). `--dry-run` prints the projected config and writes nothing.
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
  if (!flags.dryRun) assertNoCoexistence(cwd); // INV-5: mutations locked during coexistence
  assertKnownBackends(config, [id]);

  const manifest = await findManifest(cwd, id); // null for config-only connectors
  const declarations = await resolveConnectorDeclarations(
    cwd,
    [id],
    bindSettingsToId(id, flags.settings, manifest?.settingTypes),
    { requireManifest: false },
  ).then((resolved) => resolved.map((declaration) => ({ ...declaration, enabled: action === 'enable' })));

  // INV-4: the merge is the shared, idempotent helper — nothing local.
  const projected = { ...config, connectors: mergeConnectorConfigs(config.connectors, declarations) };

  if (flags.dryRun) {
    printJson(projected);
    line('\n  (dry-run: nothing was written)');
    return;
  }

  config.connectors = projected.connectors;
  await writeConfig(cwd, config);

  const entry = getBackendConfig(config, id);
  success(`Connector "${id}" ${entry.enabled ? 'enabled' : 'disabled'} in .sdd/config.json`);
  const missing = entry.enabled ? missingRequiredSettings(manifest, entry) : [];
  if (missing.length > 0) {
    const hint = manifestHint(manifest);
    if (hint) info(hint);
    else info(`Required settings incomplete: ${missing.join(', ')}.`);
  }
}
