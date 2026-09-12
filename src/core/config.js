import fsp from 'node:fs/promises';
import { ConfigError } from './errors.js';
import { CONFIG_FILENAME, configPath, exists, relativeTo } from './paths.js';

/**
 * Default settings for the built-in Linear backend.
 * `stateMap` maps canonical framework states to Linear workflow state names.
 */
export const DEFAULT_LINEAR_SETTINGS = {
  teamKey: '',
  kindMap: {
    initiative: 'initiative',
    feature: 'feature',
    spec: 'issue',
  },
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

/** Baseline configuration: filesystem is always available and required. */
export function defaultConfig() {
  return {
    version: 1,
    sourceOfTruth: 'filesystem',
    backends: [
      { id: 'filesystem', type: 'filesystem', enabled: true, required: true },
      {
        id: 'linear',
        type: 'linear',
        enabled: false,
        settings: structuredClone(DEFAULT_LINEAR_SETTINGS),
      },
    ],
  };
}

function mergeBackends(baseList, rawList) {
  const result = baseList.map((entry) => structuredClone(entry));
  if (!Array.isArray(rawList)) return result;

  for (const entry of rawList) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') continue;
    const index = result.findIndex((candidate) => candidate.id === entry.id);
    if (index === -1) {
      result.push(structuredClone(entry));
      continue;
    }
    const current = result[index];
    const merged = { ...current, ...entry };
    const settings = { ...(current.settings ?? {}), ...(entry.settings ?? {}) };
    if (Object.keys(settings).length > 0) merged.settings = settings;
    else delete merged.settings;
    result[index] = merged;
  }
  return result;
}

/** Normalizes a raw (possibly partial) config onto framework defaults. */
export function normalizeConfig(raw = {}) {
  const base = defaultConfig();
  const merged = { ...base, ...raw };
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
  const missing = ids.filter((id) => !getBackendConfig(config, id));
  if (missing.length > 0) {
    throw new ConfigError(`Unknown backend(s): ${missing.join(', ')}. Available: ${config.backends.map((b) => b.id).join(', ')}.`);
  }
}

export { CONFIG_FILENAME };
