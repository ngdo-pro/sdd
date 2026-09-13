import path from 'node:path';
import fsp from 'node:fs/promises';
import { canonicalRoot, ensureDir } from '../core/paths.js';
import { modelRelativePaths, projectionRelativePath } from './layout.js';
import { normalizeMeta, serializeMeta } from './schema.js';
import { ResolutionError } from '../core/errors.js';

async function readdirSafe(dir) {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function readJson(file) {
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}

async function readBodyOrEmpty(file) {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

function safeProjection(meta) {
  try {
    return projectionRelativePath(meta);
  } catch {
    // Relations are incomplete (un-derivable path): `validate` reports it as a
    // graph-integrity finding; the artifact still loads for inspection.
    return null;
  }
}

/** Hydrates a model record from its on-disk metadata/body pair. */
async function hydrate(root, metaRel, bodyRel) {
  const meta = normalizeMeta(await readJson(path.join(root, metaRel)), null);
  const body = await readBodyOrEmpty(path.join(root, bodyRel));
  return {
    ...meta,
    body,
    model: { directory: path.posix.dirname(metaRel) === '.' ? '' : path.posix.dirname(metaRel), meta: metaRel, body: bodyRel },
    projection: safeProjection(meta),
  };
}

/**
 * Loads every canonical artifact from `.sdd/canonical/` (recursive walk of
 * `initiatives/**`, vision at the root). The layout is stateless: whatever a
 * file's directory says, its identity comes from the metadata itself.
 * @returns {Promise<Array>} hydrated artifacts (metadata + body + paths)
 */
export async function loadModel(cwd) {
  const root = canonicalRoot(cwd);
  const artifacts = [];

  if (await exists(path.join(root, 'vision.json'))) {
    artifacts.push(await hydrate(root, 'vision.json', 'vision.md'));
  }

  const initiativesDir = path.join(root, 'initiatives');
  async function walk(directory) {
    for (const entry of await readdirSafe(directory)) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const metaRel = toPosixRelative(root, absolute);
      artifacts.push(await hydrate(root, metaRel, metaRel.replace(/\.json$/, '.md')));
    }
  }
  await walk(initiativesDir);

  return artifacts;
}

function toPosixRelative(root, absolute) {
  return absolute.slice(root.length + 1).split(path.sep).join('/');
}

async function exists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

/** Resolves a reference (id, slug, or model/projection path) into an artifact. */
export function findByRef(artifacts, reference, { kind } = {}) {
  if (!reference) throw new ResolutionError('A reference is required (id, slug, or path).');
  const cleaned = String(reference).trim().replace(/\.(json|md)$/, '').replace(/^\.\//, '');
  const basename = cleaned.split('/').pop();

  const pool = kind ? artifacts.filter((artifact) => artifact.kind === kind) : artifacts;

  if (cleaned.includes('/')) {
    const byPathForm = pool.find((artifact) => artifact.model.meta === `${cleaned}.json`
      || artifact.model.body === `${cleaned}.md`
      || artifact.projection === `${cleaned}.md`
      || artifact.model.meta.replace(/\.json$/, '').endsWith(cleaned));
    if (byPathForm) return byPathForm;
  }

  const exact = pool.find((artifact) => artifact.slug === basename || artifact.id === basename);
  if (exact) return exact;

  const suffixed = pool.filter((artifact) => artifact.slug.endsWith(`-${basename}`));
  if (suffixed.length === 1) return suffixed[0];
  if (suffixed.length > 1) {
    throw new ResolutionError(`Ambiguous reference "${reference}" (${suffixed.map((a) => a.slug).join(', ')}). Use --kind.`);
  }

  throw new ResolutionError(`No artifact found for reference "${reference}".`);
}

async function removeFile(root, relative) {
  if (!relative) return;
  const absolute = path.join(root, relative);
  await fsp.rm(absolute, { force: true });
  await pruneEmptyDirs(root, path.dirname(absolute));
}

/** Removes empty directories upwards, never touching the canonical root. */
async function pruneEmptyDirs(root, directory) {
  let current = directory;
  while (current.startsWith(root) && current !== root) {
    if ((await readdirSafe(current)).length > 0) break;
    await fsp.rm(current, { recursive: true, force: true });
    current = path.dirname(current);
  }
}

/**
 * Persists metadata + body at the canonical location, creating directories on
 * demand (INV-3). Files are relocated only when `relations` changed — never
 * for a lifecycle transition (`previous` carries the old model paths).
 * @returns {Promise<{ dir: string, meta: string, body: string }>}
 */
export async function saveArtifact(cwd, meta, body, { previous } = {}) {
  const root = canonicalRoot(cwd);
  const paths = modelRelativePaths(meta);
  const metaAbsolute = path.join(root, paths.meta);
  const bodyAbsolute = path.join(root, paths.body);

  await ensureDir(path.dirname(metaAbsolute));
  await fsp.writeFile(metaAbsolute, `${JSON.stringify(serializeMeta(meta), null, 2)}\n`, 'utf8');

  const normalizedBody = body === '' || body.endsWith('\n') ? body : `${body}\n`;
  await fsp.writeFile(bodyAbsolute, normalizedBody, 'utf8');

  if (previous && (previous.meta !== paths.meta || previous.body !== paths.body)) {
    await removeFile(root, previous.meta);
    await removeFile(root, previous.body);
  }

  return paths;
}

/**
 * Moves an artifact to another lifecycle state: mutates `state` + `updatedAt`
 * in place (INV-2) — zero files are relocated, index and projections are
 * regenerated by the callers.
 */
export async function moveArtifact(cwd, artifact, toState) {
  const nextMeta = {
    ...artifact,
    state: toState,
    updatedAt: new Date().toISOString().slice(0, 10),
  };
  const paths = await saveArtifact(cwd, nextMeta, artifact.body, { previous: artifact.model });
  return {
    ...nextMeta,
    model: { directory: paths.dir, meta: paths.meta, body: paths.body },
    projection: projectionRelativePath(nextMeta),
  };
}

/** Deletes an artifact from the canonical store. */
export async function deleteArtifact(cwd, artifact) {
  const root = canonicalRoot(cwd);
  await removeFile(root, artifact.model?.meta);
  await removeFile(root, artifact.model?.body);
}
