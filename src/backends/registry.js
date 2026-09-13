import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BackendError } from '../core/errors.js';
import { exists, isDir } from '../core/paths.js';
import { selectBackendConfigs } from '../core/config.js';
import createLinearBackend from './linear.js';

/** Built-in backend types shipped with the framework. */
const BUILTIN_FACTORIES = {
  linear: createLinearBackend,
};

/**
 * Directory holding pluggable extension backends.
 * Any `extensions/<id>/backend.js` default export is discovered automatically.
 */
const EXTENSIONS_DIR = fileURLToPath(new URL('../../extensions/', import.meta.url));

/**
 * Discovers third-party backends under `extensions/<id>/backend.js`.
 * Folders starting with `_` or `.` are treated as templates/private and skipped.
 */
export async function discoverExtensionFactories(extensionsDir = EXTENSIONS_DIR) {
  const factories = {};
  if (!(await isDir(extensionsDir))) return factories;

  const { readdir } = await import('node:fs/promises');
  for (const entry of await readdir(extensionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const backendFile = path.join(extensionsDir, entry.name, 'backend.js');
    if (!(await exists(backendFile))) continue;
    try {
      const module = await import(pathToFileURL(backendFile).href);
      if (typeof module.default === 'function') factories[entry.name] = module.default;
    } catch (error) {
      process.emitWarning(`Failed to load extension backend "${entry.name}": ${error.message}`);
    }
  }
  return factories;
}

export async function resolveFactories(extensionsDir) {
  const extensions = await discoverExtensionFactories(extensionsDir);
  return { ...BUILTIN_FACTORIES, ...extensions };
}

/** Instantiates every mirror backend selected by the configuration. */
export async function createBackends(cwd, config, { only, extensionsDir } = {}) {
  const factories = await resolveFactories(extensionsDir);
  const selected = selectBackendConfigs(config, { only });

  const instances = [];
  for (const backendConfig of selected) {
    const factory = factories[backendConfig.type] ?? factories[backendConfig.id];
    if (!factory) {
      throw new BackendError(
        `Unknown backend type "${backendConfig.type}" for id "${backendConfig.id}". Known types: ${Object.keys(factories).join(', ')}.`,
      );
    }
    instances.push(factory({ cwd, config, backendConfig }));
  }
  return instances;
}

export { BUILTIN_FACTORIES };

