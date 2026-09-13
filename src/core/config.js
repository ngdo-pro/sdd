import fsp from 'node:fs/promises';
import { ConfigError } from './errors.js';
import { CONFIG_FILENAME, configPath, exists, relativeTo } from './paths.js';

/** Current configuration schema version (v2 = model-first). */
export const CONFIG_VERSION = 2;

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
 * Baseline configuration. The canonical model (`.specs/canonical/`) is always
 * the source of truth; `backends` only lists optional remote mirrors.
 */
export function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    sourceOfTruth: 'model',
    projections: { markdown: true },
    backends: [
      {
        id: 'linear',
        type: 'linear',
        enabled: false,
        settings: structuredClone(DEFAULT_LINEAR_SETTINGS),
      },
    ],
  };
}

/** The filesystem is intrinsic in v2 — legacy entries are dropped. */
function isIntrinsicBackend(entry) {
  return entry?.type === 'filesystem' || entry?.id === 'filesystem';
}

/**
 * Merges backend settings one level deep, so partial overrides such as
 * `labels: { spec: "spec" }` keep the other default label mappings.
 */
function mergeSettings(current = {}, incoming = {}) {
  const merged = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    const isPlainObject = value !== null && typeof value === 'object' && !Array.isArray(value);
    merged[key] = isPlainObject ? { ...(current[key] ?? {}), ...value } : value;
  }
  return merged;
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
  return result;
}

/** Normalizes a raw (possibly partial or v1) config onto the v2 defaults. */
export function normalizeConfig(raw = {}) {
  const base = defaultConfig();
  const merged = { ...base, ...raw };
  merged.version = CONFIG_VERSION;
  merged.sourceOfTruth = 'model';
  merged.projections = { markdown: true, ...(raw.projections ?? {}) };
  merged.backends = mergeBackends(base.backends, raw.backends);
  return merged;
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
  return config.backends.find((backend) => backend.id === id) ?? null;
}

/** Backends considered for an operation: explicit `only` filter or enabled ones. */
export function selectBackendConfigs(config, { only } = {}) {
  if (Array.isArray(only) && only.length > 0) {
    return config.backends.filter((backend) => only.includes(backend.id));
  }
  return config.backends.filter((backend) => backend.enabled);
}

export function assertKnownBackends(config, ids) {
  const known = config.backends.map((backend) => backend.id);
  const missing = ids.filter((id) => !known.includes(id));
  if (missing.length > 0) {
    throw new ConfigError(`Unknown backend(s): ${missing.join(', ')}. Available: ${known.join(', ') || 'none'}.`);
  }
}

export { CONFIG_FILENAME };

