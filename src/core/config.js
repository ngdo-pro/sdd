import fsp from 'node:fs/promises';
import { ConfigError } from './errors.js';
import { CONFIG_FILENAME, configPath, exists, relativeTo } from './paths.js';

/** Current configuration schema version (v3 = `.sdd/` root, migrated layout). */
export const CONFIG_VERSION = 3;

/**
 * Default settings for the built-in Linear mirror.
 * `stateMap` maps canonical states to Linear workflow state names.
 */
export const DEFAULT_LINEAR_SETTINGS = {
  teamKey: '',
  stateMap: {
    planned: 'Backlog',
    active: 'In Progress',
    archived: 'Done',
  },
  labels: {
    initiative: 'initiative',
    feature: 'feature',
    spec: 'spec',
  },
  createOnMove: false,
};

/**
 * Baseline configuration. The canonical model (`.sdd/canonical/`) is always
 * the source of truth; `connectors` only lists optional remote mirrors.
 */
export function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    sourceOfTruth: 'model',
    projections: { markdown: true },
    connectors: [
      {
        id: 'linear',
        type: 'linear',
        enabled: false,
        settings: structuredClone(DEFAULT_LINEAR_SETTINGS),
      },
    ],
  };
}

/** The filesystem and the local model are intrinsic — never listed in `connectors[]`. */
function isIntrinsicBackend(entry) {
  const type = entry?.type;
  const id = entry?.id;
  return type === 'filesystem' || id === 'filesystem' || type === 'local' || id === 'local';
}

/**
 * Expands dotted override keys (`{ 'labels.spec': 'X' }`) into nested objects
 * (`{ labels: { spec: 'X' } }`) before the deep merge.
 */
function expandDottedOverrides(overrides) {
  const expanded = {};
  for (const [key, value] of Object.entries(overrides ?? {})) {
    const parts = key.split('.');
    let cursor = expanded;
    for (const part of parts.slice(0, -1)) {
      cursor = cursor[part] ??= {};
    }
    cursor[parts[parts.length - 1]] = value;
  }
  return expanded;
}

/** Deep-merges plain-object branches; scalars and arrays replace wholesale. */
function mergeValues(current, incoming) {
  const merged = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    const isPlainObject = value !== null && typeof value === 'object' && !Array.isArray(value);
    merged[key] = isPlainObject
      ? mergeValues(
        current[key] !== null && typeof current[key] === 'object' && !Array.isArray(current[key]) ? current[key] : {},
        value,
      )
      : value;
  }
  return merged;
}

/**
 * Deep, typed settings merge (INV-2): `{ 'labels.spec': 'SPEC' }` lands in
 * `settings.labels.spec` while the sibling defaults stay intact. Pure —
 * neither `base` nor `overrides` is mutated (the shared `defaultConfig()`
 * must never be corrupted).
 */
export function mergeSettingOverrides(base = {}, overrides = {}) {
  return mergeValues(base ?? {}, expandDottedOverrides(overrides ?? {}));
}

/**
 * Traces the part of a declaration worth merging: explicitly set paths always
 * win, manifest defaults only fill paths absent from the existing settings —
 * they never overwrite a user value (INV-3).
 */
function pickDeclarationSettings(declaration, currentSettings, explicit) {
  const picked = {};
  const hasPath = (settings, dottedPath) => {
    let cursor = settings;
    for (const part of dottedPath.split('.')) {
      if (cursor === null || typeof cursor !== 'object' || !(part in cursor)) return false;
      cursor = cursor[part];
    }
    return true;
  };
  for (const [key, value] of Object.entries(declaration.settings ?? {})) {
    if (explicit.has(key)) {
      picked[key] = value;
      continue;
    }
    const isPlainObject = value !== null && typeof value === 'object' && !Array.isArray(value);
    if (isPlainObject) {
      const nested = {};
      for (const [subkey, sub] of Object.entries(value)) {
        if (explicit.has(`${key}.${subkey}`) || !hasPath(currentSettings, `${key}.${subkey}`)) {
          nested[subkey] = sub;
        }
      }
      if (Object.keys(nested).length > 0) picked[key] = nested;
      continue;
    }
    if (!hasPath(currentSettings, key)) picked[key] = value;
  }
  return picked;
}

/**
 * Idempotent merge of declarative connector entries onto `connectors[]`
 * (INV-3): explicit values (flags or interview) win, manifest defaults never
 * overwrite a user value, a connector never declared is added and never
 * removed, intrinsic entries (`local`, `filesystem`) are skipped, and the
 * result is sorted by id so the on-disk diff stays stable.
 */
export function mergeConnectorConfigs(existing = [], incoming = []) {
  const result = existing
    .filter((entry) => !isIntrinsicBackend(entry))
    .map((entry) => structuredClone(entry));

  for (const declaration of incoming ?? []) {
    if (!declaration || typeof declaration.id !== 'string' || isIntrinsicBackend(declaration)) continue;
    const explicit = new Set(declaration.explicit ?? []);
    const index = result.findIndex((entry) => entry.id === declaration.id);

    if (index === -1) {
      const entry = {
        id: declaration.id,
        type: declaration.type ?? declaration.id,
        enabled: declaration.enabled ?? true,
      };
      const settings = pickDeclarationSettings(declaration, undefined, explicit);
      if (Object.keys(settings).length > 0) entry.settings = settings;
      result.push(entry);
      continue;
    }

    const merged = { ...result[index] };
    if (typeof declaration.enabled === 'boolean') merged.enabled = declaration.enabled;
    const picked = pickDeclarationSettings(declaration, merged.settings, explicit);
    if (Object.keys(picked).length > 0) {
      merged.settings = mergeSettingOverrides(merged.settings ?? {}, picked);
    }
    result[index] = merged;
  }

  return result.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/**
 * Merges connector settings (deep, so partial overrides such as
 * `labels: { spec: "spec" }` keep the other default label mappings).
 */
function mergeSettings(current = {}, incoming = {}) {
  return mergeSettingOverrides(current, incoming);
}

function mergeBackends(baseList, rawList) {
  const result = baseList.map((entry) => structuredClone(entry));
  if (!Array.isArray(rawList)) return result;

  for (const entry of rawList) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') continue;
    if (isIntrinsicBackend(entry)) continue;

    const index = result.findIndex((candidate) => candidate.id === entry.id);
    if (index === -1) {
      result.push(structuredClone(entry));
      continue;
    }
    const current = result[index];
    const merged = { ...current, ...entry };
    const settings = mergeSettings(current.settings, entry.settings);
    if (Object.keys(settings).length > 0) merged.settings = settings;
    else delete merged.settings;
    result[index] = merged;
  }
  // Stable on-disk order: `connectors[]` is always sorted by id, so repeated
  // load → write cycles do not churn the config diff.
  return result.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/** Normalizes a raw (possibly partial or legacy) config onto the v3 defaults. */
export function normalizeConfig(raw = {}) {
  const base = defaultConfig();
  const merged = { ...base, ...raw };
  merged.version = CONFIG_VERSION;
  merged.sourceOfTruth = 'model';
  merged.projections = { markdown: true, ...(raw.projections ?? {}) };
  merged.connectors = mergeBackends(base.connectors, raw.connectors);
  return merged;
}

const KNOWN_CONFIG_KEYS = ['version', 'sourceOfTruth', 'projections', 'connectors'];

/**
 * Converts a legacy config onto the v3 schema (INV-3 of `sdd migrate`):
 * drops unknown top-level keys and intrinsic `filesystem` connectors — each
 * removal listed as a warning — and forces `version` to 3. Known keys are
 * preserved; defaults fill the gaps.
 * @returns {{ config: object, warnings: string[] }}
 */
export function convertConfig(raw = {}) {
  const warnings = [];
  const cleaned = { ...raw };
  for (const key of Object.keys(cleaned)) {
    if (!KNOWN_CONFIG_KEYS.includes(key)) {
      warnings.push(`unknown top-level key "${key}" dropped`);
      delete cleaned[key];
    }
  }
  if (Array.isArray(cleaned.connectors)) {
    const kept = [];
    for (const entry of cleaned.connectors) {
      if (isIntrinsicBackend(entry)) {
        warnings.push(`legacy connector "${entry?.id ?? entry?.type ?? 'filesystem'}" dropped (the filesystem is intrinsic in v3)`);
        continue;
      }
      kept.push(entry);
    }
    cleaned.connectors = kept;
  }
  return { config: normalizeConfig(cleaned), warnings };
}

export async function loadConfig(cwd) {
  const file = configPath(cwd);
  if (!(await exists(file))) return defaultConfig();
  let parsed;
  try {
    parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (error) {
    throw new ConfigError(`Invalid JSON in ${relativeTo(cwd, file)}: ${error.message}`);
  }
  return normalizeConfig(parsed);
}

export async function writeConfig(cwd, config) {
  await fsp.writeFile(configPath(cwd), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function getBackendConfig(config, id) {
  return config.connectors.find((connector) => connector.id === id) ?? null;
}

/** Connectors considered for an operation: explicit `only` filter or enabled ones. */
export function selectBackendConfigs(config, { only } = {}) {
  if (Array.isArray(only) && only.length > 0) {
    return config.connectors.filter((connector) => only.includes(connector.id));
  }
  return config.connectors.filter((connector) => connector.enabled);
}

export function assertKnownBackends(config, ids) {
  const known = config.connectors.map((connector) => connector.id);
  const missing = ids.filter((id) => !known.includes(id));
  if (missing.length > 0) {
    throw new ConfigError(`Unknown connector(s): ${missing.join(', ')}. Available: ${known.join(', ') || 'none'}.`);
  }
}

export { CONFIG_FILENAME };

