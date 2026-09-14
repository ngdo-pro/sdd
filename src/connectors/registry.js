import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ConnectorError, UsageError } from '../core/errors.js';
import { exists, isDir } from '../core/paths.js';
import { mergeSettingOverrides, selectBackendConfigs } from '../core/config.js';
import createLinearBackend from './linear.js';

/** Built-in connector types shipped with the framework. */
const BUILTIN_FACTORIES = {
  linear: createLinearBackend,
};

/**
 * Directory holding pluggable extension connectors.
 * Any `extensions/<id>/connector.js` default export is discovered automatically.
 */
const EXTENSIONS_DIR = fileURLToPath(new URL('../../extensions/', import.meta.url));

/** Workspace-local extension directory, part of the catalog like the bundled one. */
const WORKSPACE_EXTENSIONS_DIRNAME = 'extensions';

/** Setting types a manifest may declare (`settingTypes`, retrocompatible when absent). */
const SETTING_TYPES = new Set(['string', 'boolean', 'number', 'object']);

/**
 * Discovers third-party connectors under `extensions/<id>/connector.js`.
 * Folders starting with `_` or `.` are treated as templates/private and skipped.
 */
export async function discoverExtensionFactories(extensionsDir = EXTENSIONS_DIR) {
  const factories = {};
  if (!(await isDir(extensionsDir))) return factories;

  for (const entry of await fsp.readdir(extensionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const connectorFile = path.join(extensionsDir, entry.name, 'connector.js');
    if (!(await exists(connectorFile))) continue;
    try {
      const module = await import(pathToFileURL(connectorFile).href);
      if (typeof module.default === 'function') factories[entry.name] = module.default;
    } catch (error) {
      process.emitWarning(`Failed to load extension connector "${entry.name}": ${error.message}`);
    }
  }
  return factories;
}

export async function resolveFactories(extensionsDir) {
  const extensions = await discoverExtensionFactories(extensionsDir);
  return { ...BUILTIN_FACTORIES, ...extensions };
}

/** Instantiates every mirror connector selected by the configuration. */
export async function createBackends(cwd, config, { only, extensionsDir } = {}) {
  const factories = await resolveFactories(extensionsDir);
  const selected = selectBackendConfigs(config, { only });

  const instances = [];
  for (const connectorConfig of selected) {
    const factory = factories[connectorConfig.type] ?? factories[connectorConfig.id];
    if (!factory) {
      throw new ConnectorError(
        `Unknown connector type "${connectorConfig.type}" for id "${connectorConfig.id}". Known types: ${Object.keys(factories).join(', ')}.`,
      );
    }
    instances.push(factory({ cwd, config, connectorConfig }));
  }
  return instances;
}

/**
 * Catalog of declarable connector ids: built-ins plus every extension folder
 * shipping an `extension.json` (workspace `extensions/` first, then bundled).
 * Template/private folders (`_`, `.`) are excluded.
 */
export async function listCatalogIds(cwd, { extensionsDir } = {}) {
  const ids = new Set(Object.keys(BUILTIN_FACTORIES));
  for (const dir of [path.join(cwd ?? '.', WORKSPACE_EXTENSIONS_DIRNAME), extensionsDir ?? EXTENSIONS_DIR]) {
    if (!(await isDir(dir))) continue;
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      if (await exists(path.join(dir, entry.name, 'extension.json'))) ids.add(entry.name);
    }
  }
  return [...ids].sort();
}

/**
 * Optional manifest `hint` (spec 007): a guidance string the CLI may surface
 * when a connector's `requiredSettings` are incomplete. Absent or blank ⇒
 * `null` (retrocompatible — manifests never required the field).
 */
export function manifestHint(manifest) {
  const hint = manifest?.hint;
  return typeof hint === 'string' && hint.trim().length > 0 ? hint : null;
}

/** Fills the retrocompatible defaults: absent `settingTypes`/`requiredSettings`. */
function normalizeManifest(raw) {
  return {
    ...raw,
    settings: raw.settings ?? {},
    settingTypes: raw.settingTypes ?? {},
    requiredSettings: raw.requiredSettings ?? [],
  };
}

/**
 * Reads one connector manifest (`extension.json`) from the catalog.
 * Returns `null` when the id ships no manifest — unknown ids stay the
 * caller's decision (`manifestFor` rejects them, config-only entries do not).
 */
export async function findManifest(cwd, id, { extensionsDir } = {}) {
  if (typeof id !== 'string' || id.length === 0) return null;
  const directories = [
    path.join(cwd ?? '.', WORKSPACE_EXTENSIONS_DIRNAME),
    extensionsDir ?? EXTENSIONS_DIR,
  ];
  for (const dir of directories) {
    const file = path.join(dir, id, 'extension.json');
    if (!(await exists(file))) continue;
    let raw;
    try {
      raw = JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch (error) {
      throw new UsageError(`Invalid manifest for connector "${id}" (${file}): ${error.message}`);
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new UsageError(`Invalid manifest for connector "${id}" (${file}): expected a JSON object.`);
    }
    return normalizeManifest(raw);
  }
  return null;
}

/**
 * Resolves the manifest of a declarable connector (INV-1): an id absent from
 * the catalog throws UsageError before anything is written.
 */
export async function manifestFor(cwd, id, options = {}) {
  const manifest = await findManifest(cwd, id, options);
  if (!manifest) {
    const known = await listCatalogIds(cwd, options);
    throw new UsageError(`Unknown connector "${id}". Catalog: ${known.join(', ') || 'none'}.`);
  }
  return manifest;
}

/** Every resolved manifest of the catalog, sorted by id (interview catalog). */
export async function listManifests(cwd, { extensionsDir } = {}) {
  const manifests = [];
  for (const id of await listCatalogIds(cwd, { extensionsDir })) {
    const manifest = await findManifest(cwd, id, { extensionsDir });
    if (manifest) manifests.push(manifest);
  }
  return manifests;
}

/**
 * Coerces one raw setting value into its manifest-declared type (INV-2).
 * Booleans are strict (`true`/`false` only — `1`/`0`/`yes`/`no` rejected),
 * numbers must be numeric, objects expect their leaves set via subkeys.
 */
export function coerceSetting(id, key, raw, type) {
  const label = `${id}.${key}`;
  const effective = type ?? 'string';
  if (!SETTING_TYPES.has(effective)) {
    throw new UsageError(`Unknown type "${type}" for ${label} (expected: string | boolean | number | object).`);
  }
  if (effective === 'boolean') {
    if (raw === true || raw === 'true') return true;
    if (raw === false || raw === 'false') return false;
    throw new UsageError(`Invalid boolean for ${label}: ${JSON.stringify(raw)} (strict "true" or "false" only).`);
  }
  if (effective === 'number') {
    const text = raw === null || raw === undefined ? '' : String(raw).trim();
    const value = text === '' ? Number.NaN : Number(text);
    if (!Number.isFinite(value)) {
      throw new UsageError(`Invalid number for ${label}: ${JSON.stringify(raw)}.`);
    }
    return value;
  }
  if (effective === 'object') {
    throw new UsageError(`${label} is an object setting: set its leaves with --${id}.${key}.<subkey>=<value>.`);
  }
  return String(raw);
}

/** Coerces one dotted setting path (`teamKey` or `labels.spec`) via the manifest types. */
function coerceSettingPath(id, settingPath, raw, settingTypes) {
  const parts = settingPath.split('.');
  if (parts.length > 2) {
    throw new UsageError(`Setting "--${id}.${settingPath}" exceeds the supported depth (key + subkey).`);
  }
  const [key, subkey] = parts;
  if (subkey === undefined) return coerceSetting(id, key, raw, settingTypes[key]);
  const declared = settingTypes[key];
  if (declared !== undefined && declared !== 'object') {
    throw new UsageError(`"${id}.${key}" is declared "${declared}": use --${id}.${key}=<value> without subkey.`);
  }
  // Repeated flags (`--linear.mcp.args=-y --linear.mcp.args=npx`) arrive as an
  // array of occurrences — coerced into an array of string leaves (spec 005).
  if (Array.isArray(raw)) return raw.map((item) => String(item));
  return coerceSetting(id, settingPath, raw, 'string');
}

/**
 * Builds declarative connector entries from `--connector` ids + dotted
 * settings flags (INV-1, INV-2): manifest seed ⊕ coerced overrides, with the
 * explicitly set paths traced for the idempotent merge. Pure — every invalid
 * id, namespace or value throws UsageError before anything is written.
 * `requireManifest: false` tolerates config-only connectors (no manifest →
 * overrides coerced as strings, no defaults seeded).
 */
export async function resolveConnectorDeclarations(cwd, ids, settingsFlags = {}, { extensionsDir, requireManifest = true } = {}) {
  const declared = [...new Set(ids ?? [])];
  const grouped = new Map(declared.map((id) => [id, []]));

  for (const [namespaced, raw] of Object.entries(settingsFlags)) {
    const separator = namespaced.indexOf('.');
    if (separator === -1) {
      throw new UsageError(`Setting "--${namespaced}" is missing its connector namespace: use --<id>.${namespaced}=<value>.`);
    }
    const namespace = namespaced.slice(0, separator);
    if (!grouped.has(namespace)) {
      const expected = declared.join(', ') || 'none declared';
      throw new UsageError(`Settings namespace "${namespace}" does not match any --connector declaration (${expected}).`);
    }
    grouped.get(namespace).push([namespaced.slice(separator + 1), raw]);
  }

  const declarations = [];
  for (const id of declared) {
    const manifest = await findManifest(cwd, id, { extensionsDir });
    if (!manifest) {
      if (requireManifest) {
        const known = await listCatalogIds(cwd, { extensionsDir });
        throw new UsageError(`Unknown connector "${id}". Catalog: ${known.join(', ') || 'none'}.`);
      }
      declarations.push({ id, settings: {}, explicit: [], enabled: true });
      continue;
    }
    let settings = structuredClone(manifest.settings);
    const explicit = [];
    for (const [settingPath, raw] of grouped.get(id)) {
      const value = coerceSettingPath(id, settingPath, raw, manifest.settingTypes);
      explicit.push(settingPath);
      settings = mergeSettingOverrides(settings, { [settingPath]: value });
    }
    declarations.push({ id, type: manifest.type ?? id, settings, explicit, enabled: true });
  }
  return declarations;
}

export { BUILTIN_FACTORIES };
