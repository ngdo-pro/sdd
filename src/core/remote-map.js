import fsp from 'node:fs/promises';
import { exists, remoteMapPath } from './paths.js';

/**
 * The remote map links a local artifact (by POSIX relative path) to the
 * identifiers it owns on remote backends, e.g.
 *
 * ```json
 * {
 *   ".specs/specs/active/012-auth.md": { "linear": "ENG-142" }
 * }
 * ```
 *
 * The local filesystem remains the source of truth; this file is only a
 * deterministic, committable pointer table so syncs stay idempotent.
 */
export async function loadRemoteMap(cwd) {
  const file = remoteMapPath(cwd);
  if (!(await exists(file))) return {};
  try {
    const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveRemoteMap(cwd, map) {
  const file = remoteMapPath(cwd);
  await fsp.writeFile(file, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
}

export function getRemoteRef(map, localPath, backendId) {
  return map?.[localPath]?.[backendId] ?? null;
}

export function setRemoteRef(map, localPath, backendId, ref) {
  map[localPath] ??= {};
  map[localPath][backendId] = ref;
  return map;
}
