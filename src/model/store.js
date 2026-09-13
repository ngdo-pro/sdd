import path from 'node:path';
import fsp from 'node:fs/promises';
import {
  STATE_DIRS,
  STATE_BY_DIR,
  STATES,
  ensureDir,
  exists,
  modelRoot,
} from '../core/paths.js';
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

async function hydrate(root, metaRel, bodyRel, { initiativeState } = {}) {
  const meta = normalizeMeta(await readJson(path.join(root, metaRel)), null);
  const body = await readBodyOrEmpty(path.join(root, bodyRel));
  return {
    ...meta,
    body,
    model: { directory: modelRelPathsFor(meta, initiativeState).dir, meta: metaRel, body: bodyRel },
    projection: projectionRelativePath(meta, { initiativeState }),
  };
}

function modelRelPathsFor(meta, initiativeState) {
  return modelRelativePaths(meta, { initiativeState });
}

/**
 * Loads every canonical artifact from `.specs/model/`.
 * @returns {Promise<Array>} hydrated artifacts (metadata + body + paths)
 */
export async function loadModel(cwd) {
  const root = modelRoot(cwd);
  const artifacts = [];

  if (await exists(path.join(root, 'vision.json'))) {
    artifacts.push(await hydrate(root, 'vision.json', 'vision.md'));
  }

  for (const state of STATES) {
    const stateDir = STATE_DIRS[state];
    const specsDir = path.join(root, 'specs', stateDir);
    for (const entry of await readdirSafe(specsDir)) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const base = entry.name.replace(/\.json$/, '');
      artifacts.push(await hydrate(root, `specs/${stateDir}/${base}.json`, `specs/${stateDir}/${base}.md`));
    }

    const initiativesDir = path.join(root, 'initiatives', stateDir);
    for (const initiativeEntry of await readdirSafe(initiativesDir)) {
      if (!initiativeEntry.isDirectory()) continue;
      const slug = initiativeEntry.name;
      const initiativeMeta = `initiatives/${stateDir}/${slug}/${slug}.json`;
      if (await exists(path.join(root, initiativeMeta))) {
        artifacts.push(await hydrate(root, initiativeMeta, `initiatives/${stateDir}/${slug}/${slug}.md`));
      }

      for (const featureEntry of await readdirSafe(path.join(initiativesDir, slug))) {
        const featureState = STATE_BY_DIR[featureEntry.name];
        if (!featureEntry.isDirectory() || !featureState) continue;
        const featureDir = path.join(initiativesDir, slug, featureEntry.name);
        for (const file of await readdirSafe(featureDir)) {
          if (!file.isFile() || !file.name.endsWith('.json')) continue;
          const base = file.name.replace(/\.json$/, '');
          const metaRel = `initiatives/${stateDir}/${slug}/${featureEntry.name}/${base}.json`;
          artifacts.push(await hydrate(root, metaRel, metaRel.replace(/\.json$/, '.md'), { initiativeState: state }));
        }
      }
    }
  }

  return artifacts;
}

/** Returns the lifecycle state of an initiative by slug, or undefined. */
export function initiativeStateFor(artifacts, slug) {
  return artifacts.find((artifact) => artifact.kind === 'initiative' && artifact.slug === slug)?.state;
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

/** Removes empty directories upwards, never touching the model root. */
async function pruneEmptyDirs(root, directory) {
  let current = directory;
  while (current.startsWith(root) && current !== root) {
    if ((await readdirSafe(current)).length > 0) break;
    await fsp.rm(current, { recursive: true, force: true });
    current = path.dirname(current);
  }
}

/**
 * Persists metadata + body at the canonical location, relocating the files when
 * the artifact's state changed (`previous` carries the old model paths).
 * @returns {Promise<{ dir: string, meta: string, body: string }>}
 */
export async function saveArtifact(cwd, meta, body, { initiativeState, previous } = {}) {
  const root = modelRoot(cwd);
  const paths = modelRelativePaths(meta, { initiativeState });
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

/** Moves an artifact to another lifecycle state and returns the updated record. */
export async function moveArtifact(cwd, artifact, toState, { initiativeState } = {}) {
  const nextMeta = {
    ...artifact,
    state: toState,
    updatedAt: new Date().toISOString().slice(0, 10),
  };
  const paths = await saveArtifact(cwd, nextMeta, artifact.body, {
    initiativeState,
    previous: artifact.model,
  });
  return {
    ...nextMeta,
    model: { directory: paths.dir, meta: paths.meta, body: paths.body },
    projection: projectionRelativePath(nextMeta, { initiativeState }),
  };
}

/** Deletes an artifact from the canonical store. */
export async function deleteArtifact(cwd, artifact) {
  const root = modelRoot(cwd);
  await removeFile(root, artifact.model?.meta);
  await removeFile(root, artifact.model?.body);
}

