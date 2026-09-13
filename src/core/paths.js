import path from 'node:path';
import fsp from 'node:fs/promises';

/** Root directory holding every specification artifact (projections). */
export const SPECS_DIRNAME = '.specs';

/** Canonical model store (JSON metadata + markdown bodies). */
export const MODEL_DIRNAME = 'model';

/** Generated manifest mapping artifact ids to their model files. */
export const INDEX_FILENAME = 'index.json';

/** Project-level framework configuration file (relative to `.specs/`). */
export const CONFIG_FILENAME = 'config.json';

/** Canonical lifecycle states, in order. */
export const STATES = ['planned', 'active', 'archived'];

/** State → directory name (note: the archived directory is `archive`). */
export const STATE_DIRS = {
  planned: 'planned',
  active: 'active',
  archived: 'archive',
};

/** Directory name → canonical state. */
export const STATE_BY_DIR = {
  planned: 'planned',
  active: 'active',
  archive: 'archived',
};

/** Every artifact kind known to the framework. */
export const KINDS = ['vision', 'initiative', 'feature', 'spec'];

/** Kinds that own a lifecycle state (and therefore support transitions). */
export const STATEFUL_KINDS = ['initiative', 'feature', 'spec'];

const SPEC_SLUG_RE = /^(\d{3})-(.+)$/;

export function specsRoot(cwd) {
  return path.join(cwd, SPECS_DIRNAME);
}

export function modelRoot(cwd) {
  return path.join(cwd, SPECS_DIRNAME, MODEL_DIRNAME);
}

export function indexFilePath(cwd) {
  return path.join(modelRoot(cwd), INDEX_FILENAME);
}

export function configPath(cwd) {
  return path.join(specsRoot(cwd), CONFIG_FILENAME);
}

/** Directory layout bootstrapped by `spec init`. */
export function standardLayout(cwd) {
  const specs = specsRoot(cwd);
  const model = modelRoot(cwd);
  return [
    specs,
    model,
    path.join(model, 'specs', 'planned'),
    path.join(model, 'specs', 'active'),
    path.join(model, 'specs', 'archive'),
    path.join(model, 'initiatives', 'planned'),
    path.join(model, 'initiatives', 'active'),
    path.join(model, 'initiatives', 'archive'),
    path.join(specs, 'specs', 'planned'),
    path.join(specs, 'specs', 'active'),
    path.join(specs, 'specs', 'archive'),
    path.join(specs, 'initiatives', 'planned'),
    path.join(specs, 'initiatives', 'active'),
    path.join(specs, 'initiatives', 'archive'),
    path.join(specs, 'decisions', 'product'),
    path.join(specs, 'decisions', 'architecture'),
    path.join(specs, 'knowledge', 'domains'),
  ];
}

/**
 * Splits a spec slug into its 3-digit id and remainder.
 * @returns {{ id: string, suffix: string } | null}
 */
export function parseSpecSlug(slug) {
  const match = String(slug ?? '').match(SPEC_SLUG_RE);
  return match ? { id: match[1], suffix: match[2] } : null;
}

/** Normalize a path to POSIX separators for portable artifacts. */
export function toPosix(value) {
  return value.split(path.sep).join('/');
}

export function relativeTo(cwd, absolute) {
  return toPosix(path.relative(cwd, absolute));
}

export async function exists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function isDir(target) {
  try {
    return (await fsp.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

export async function ensureDir(target) {
  await fsp.mkdir(target, { recursive: true });
}

export async function removeDir(target) {
  await fsp.rm(target, { recursive: true, force: true });
}

