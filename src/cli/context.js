import { loadConfig } from '../core/config.js';
import { createBackends } from '../backends/registry.js';
import { renderProjections } from '../render/projections.js';
import { writeIndex } from '../model/index.js';
import { buildGraph, cascadeCandidates } from '../model/graph.js';
import { initiativeStateFor, loadModel, moveArtifact, saveArtifact } from '../model/store.js';
import { projectionRelativePath } from '../model/layout.js';

/** Loads config, the canonical model and the enabled mirror backends. */
export async function loadContext(cwd, { only } = {}) {
  const config = await loadConfig(cwd);
  const artifacts = await loadModel(cwd);
  const mirrors = await createBackends(cwd, config, { only });
  return { config, artifacts, mirrors };
}

export function initiativeStateOf(artifacts, artifact) {
  const slug = artifact.kind === 'initiative' ? artifact.slug : artifact.relations?.initiative;
  return slug ? initiativeStateFor(artifacts, slug) : undefined;
}

/**
 * Persists an artifact into the model (relocating files if its state changed)
 * and returns the refreshed record.
 */
export async function persistArtifact(cwd, artifacts, artifact, { previous } = {}) {
  const initiativeState = initiativeStateOf(artifacts, artifact);
  const paths = await saveArtifact(cwd, artifact, artifact.body, { initiativeState, previous });
  return {
    ...artifact,
    model: { directory: paths.dir, meta: paths.meta, body: paths.body },
    projection: projectionRelativePath(artifact, { initiativeState }),
  };
}

/** Regenerates every markdown projection and the index manifest. */
export async function refresh(cwd, artifacts, { check = false } = {}) {
  const projections = await renderProjections(cwd, artifacts, { check });
  if (!check) await writeIndex(cwd, artifacts);
  return projections;
}

/**
 * Archives every active parent whose children are all complete, bottom-up.
 * Mutates the passed `artifacts` array in place so callers keep a fresh view.
 * @returns {Promise<Array<{ slug: string, kind: string, planned?: boolean }>>}
 */
export async function runCascade(cwd, artifacts, { dryRun = false } = {}) {
  const archived = [];

  if (dryRun) {
    for (const { artifact } of cascadeCandidates(buildGraph(artifacts))) {
      archived.push({ slug: artifact.slug, kind: artifact.kind, planned: true });
    }
    return archived;
  }

  for (;;) {
    const candidates = cascadeCandidates(buildGraph(artifacts));
    if (candidates.length === 0) break;

    for (const { artifact } of candidates) {
      const moved = await moveArtifact(cwd, artifact, 'archived', {
        initiativeState: initiativeStateOf(artifacts, artifact),
      });
      const index = artifacts.findIndex((entry) => entry.slug === artifact.slug && entry.kind === artifact.kind);
      if (index !== -1) artifacts[index] = moved;
      archived.push({ slug: moved.slug, kind: moved.kind });
    }
  }

  return archived;
}
