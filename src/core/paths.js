import path from 'node:path';
import fsp from 'node:fs/promises';

/** Root directory holding every specification artifact. */
export const SPECS_DIRNAME = '.specs';

/** Project-level framework configuration file (relative to `.specs/`). */
export const CONFIG_FILENAME = 'config.json';

/** Local mapping table between local artifact paths and remote backend refs. */
export const REMOTE_MAP_FILENAME = '.remote-map.json';

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
export const KINDS = ['vision', 'initiative', 'feature', 'spec', 'decision', 'knowledge'];

/** Kinds that own a lifecycle state (and therefore support transitions). */
export const STATEFUL_KINDS = ['initiative', 'feature', 'spec'];

export function specsRoot(cwd) {
  return path.join(cwd, SPECS_DIRNAME);
}

export function configPath(cwd) {
  return path.join(specsRoot(cwd), CONFIG_FILENAME);
}

export function remoteMapPath(cwd) {
  return path.join(specsRoot(cwd), REMOTE_MAP_FILENAME);
}

/** Directory layout bootstrapped by `spec init`. */
export function standardLayout(cwd) {
  const root = specsRoot(cwd);
  return [
    root,
    path.join(root, 'specs', 'planned'),
    path.join(root, 'specs', 'active'),
    path.join(root, 'specs', 'archive'),
    path.join(root, 'initiatives', 'planned'),
    path.join(root, 'initiatives', 'active'),
    path.join(root, 'initiatives', 'archive'),
    path.join(root, 'decisions', 'product'),
    path.join(root, 'decisions', 'architecture'),
    path.join(root, 'knowledge', 'domains'),
  ];
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
