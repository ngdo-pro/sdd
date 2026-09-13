import { loadConfig } from '../core/config.js';
import { createBackends } from '../connectors/registry.js';
import { renderProjections } from '../render/projections.js';
import { writeIndex } from '../model/index.js';
import { buildGraph, cascadeCandidates } from '../model/graph.js';
import { loadModel, moveArtifact, saveArtifact } from '../model/store.js';
import { projectionRelativePath } from '../model/layout.js';

/** Loads config, the canonical model and the enabled mirror connectors. */
export async function loadContext(cwd, { only } = {}) {
  const config = await loadConfig(cwd);
  const artifacts = await loadModel(cwd);
  const mirrors = await createBackends(cwd, config, { only });
  return { config, artifacts, mirrors };
}

/**
 * Persists an artifact into the canonical model (relocating files only when
 * its `relations` changed) and returns the refreshed record. No lifecycle
 * state is threaded: paths are stateless.
 */
export async function persistArtifact(cwd, artifact, { previous } = {}) {
  const paths = await saveArtifact(cwd, artifact, artifact.body, { previous });
  return {
    ...artifact,
    model: { directory: paths.dir, meta: paths.meta, body: paths.body },
    projection: projectionRelativePath(artifact),
  };
}

/**
 * Regenerates every markdown projection and the index manifest. The config
 * drives markdown projections: `projections.markdown === false` writes no
 * projection at all (the index is still regenerated, except in check mode).
 * A `null` config falls back to `loadConfig` — the CLI tolerates a config.json
 * without the `projections` key (defaults to enabled, INV-4).
 */
export async function refresh(cwd, artifacts, { check = false, dryRun = false, config = null } = {}) {
  const active = config ?? await loadConfig(cwd);
  const projections = active.projections?.markdown === false
    ? []
    : await renderProjections(cwd, artifacts, { check, dryRun });
  if (!check && !dryRun) await writeIndex(cwd, artifacts);
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
      const moved = await moveArtifact(cwd, artifact, 'archived');
      const index = artifacts.findIndex((entry) => entry.slug === artifact.slug && entry.kind === artifact.kind);
      if (index !== -1) artifacts[index] = moved;
      archived.push({ slug: moved.slug, kind: moved.kind });
    }
  }

  return archived;
}
