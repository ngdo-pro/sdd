import { configPath, ensureDir, exists, standardLayout } from '../../core/paths.js';
import {
  defaultConfig,
  getBackendConfig,
  loadConfig,
  mergeConnectorConfigs,
  writeConfig,
} from '../../core/config.js';
import { assertNoCoexistence } from '../../migrate/migrate.js';
import { listManifests, resolveConnectorDeclarations } from '../../connectors/registry.js';
import { info, line, printJson, success } from '../render.js';
import { runInteractive } from '../interactive.js';

/**
 * Renders the post-merge settings of one connector as a plan line: explicit
 * paths as `key=value`, manifest-fed leaves as `key=<default>`.
 */
function summarizeSettings(settings, explicit) {
  const explicitSet = new Set(explicit);
  const format = (value) => (typeof value === 'string' ? value : JSON.stringify(value));
  const parts = [];
  for (const [key, value] of Object.entries(settings ?? {})) {
    const isPlainObject = value !== null && typeof value === 'object' && !Array.isArray(value);
    if (isPlainObject) {
      const children = Object.entries(value);
      const anyExplicit = children.some(([subkey]) => explicitSet.has(`${key}.${subkey}`));
      if (!anyExplicit) {
        parts.push(`${key}=<default>`);
        continue;
      }
      for (const [subkey, sub] of children) {
        const path = `${key}.${subkey}`;
        parts.push(explicitSet.has(path) ? `${path}=${format(sub)}` : `${path}=<default>`);
      }
      continue;
    }
    parts.push(explicitSet.has(key) ? `${key}=${format(value)}` : `${key}=<default>`);
  }
  return parts.length > 0 ? `settings: ${parts.join(', ')}` : 'settings: (none)';
}

/**
 * `sdd init` — bootstraps `.sdd/canonical/` and the config, and is the single
 * declarative entry point for connectors: `--connector <id>…` seeds settings
 * from the manifests and deep-merges the `--<id>.<key>[.<subkey>]` overrides.
 * Re-init is idempotent (explicit values win, manifest defaults never
 * overwrite a user value). `--interactive` runs the TTY interview. Every
 * invalid id, flag or type is rejected BEFORE anything is written (INV-1,
 * INV-2, INV-4). `--force` overwrites the config and is refused during a
 * pending migration (INV-5 coexistence lock).
 */
export async function init({ cwd, flags }) {
  if (flags.force) assertNoCoexistence(cwd);

  const declaredIds = [...new Set(flags.connectors ?? [])];
  const settingsFlags = flags.settings ?? {};

  // Phase A — resolve declarations (pure): unknown ids, malformed flags,
  // invalid namespaces and non-coercible values throw before any write.
  const declarations = [];
  if (declaredIds.length > 0 || Object.keys(settingsFlags).length > 0) {
    declarations.push(...await resolveConnectorDeclarations(cwd, declaredIds, settingsFlags));
  }
  if (flags.interactive) {
    const interviewed = await runInteractive({ catalog: await listManifests(cwd) });
    declarations.push(...interviewed.connectors);
  }

  // Phase B — dry-run: preview the resolved config, write nothing (not even
  // the `.sdd/` skeleton).
  if (flags.dryRun) {
    const base = flags.force || !(await exists(configPath(cwd)))
      ? defaultConfig()
      : await loadConfig(cwd);
    printJson({ ...base, connectors: mergeConnectorConfigs(base.connectors, declarations) });
    line('\n  (dry-run: nothing was written)');
    return;
  }

  // Phase C — writes.
  if (declarations.length > 0) assertNoCoexistence(cwd);

  for (const dir of standardLayout(cwd)) {
    await ensureDir(dir);
  }

  const file = configPath(cwd);
  const configExisted = await exists(file);
  let config;
  if (configExisted && !flags.force) {
    config = await loadConfig(cwd);
  } else {
    config = defaultConfig();
  }

  const mergedSettings = [];
  if (declarations.length > 0) {
    config.connectors = mergeConnectorConfigs(config.connectors, declarations);
    for (const declaration of declarations) {
      mergedSettings.push([declaration, getBackendConfig(config, declaration.id)]);
    }
  }

  if (!configExisted || flags.force || declarations.length > 0) {
    await writeConfig(cwd, config);
    success(configExisted && !flags.force ? 'Updated .sdd/config.json' : 'Created .sdd/config.json');
  } else {
    info('Config already present at .sdd/config.json (use --force to overwrite).');
  }

  for (const [declaration, entry] of mergedSettings) {
    success(`Connector "${declaration.id}" enabled`);
    info(summarizeSettings(entry?.settings, declaration.explicit));
  }

  success('Initialized .sdd/ (canonical model + markdown projections).');
}
