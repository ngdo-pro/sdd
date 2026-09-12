import { loadConfig } from '../../core/config.js';
import { createBackends, getSourceBackend } from '../../backends/registry.js';
import { normalizeState } from '../../core/transitions.js';
import { listArtifacts } from '../../core/artifact.js';
import { heading, printJson, table, warn } from '../render.js';

/** `spec list [--kind k] [--state s] [--backend id]` */
export async function list({ cwd, flags }) {
  const config = await loadConfig(cwd);
  const backends = await createBackends(cwd, config, { only: flags.backends });

  const remoteOnly = Array.isArray(flags.backends) && flags.backends.length > 0;
  const target = remoteOnly
    ? backends[0]
    : getSourceBackend(backends, config);

  const state = flags.state ? normalizeState(flags.state) : undefined;
  const artifacts = await target.list({ kind: flags.kind, state });

  if (flags.json) {
    printJson(artifacts);
    return;
  }

  heading(`${artifacts.length} artifact(s) via ${target.id}`);
  if (artifacts.length === 0) {
    warn('Nothing found.');
    return;
  }

  const rows = artifacts.map((artifact) => [
    artifact.kind,
    artifact.id,
    artifact.state ?? '—',
    (artifact.title ?? '').slice(0, 60),
  ]);
  table(rows, ['kind', 'id', 'state', 'title']);
}

export { listArtifacts };
