import { loadConfig } from '../../core/config.js';
import { createBackends, getSourceBackend } from '../../backends/registry.js';
import { loadRemoteMap, getRemoteRef } from '../../core/remote-map.js';
import { listArtifacts } from '../../core/artifact.js';
import { STATES } from '../../core/paths.js';
import { heading, info, line, printJson, table } from '../render.js';

/** `spec status [<ref>]` — shows local state plus every remote mirror. */
export async function status({ cwd, positionals, flags }) {
  const config = await loadConfig(cwd);
  const backends = await createBackends(cwd, config, { only: flags.backends });
  const source = getSourceBackend(backends, config);
  const remoteBackends = backends.filter((backend) => backend.remote);
  const remoteMap = await loadRemoteMap(cwd);
  const reference = positionals[0];

  if (reference) {
    const artifact = await source.resolve(reference, { kind: flags.kind });
    const mirrors = remoteBackends.map((backend) => ({
      backend: backend.id,
      ref: getRemoteRef(remoteMap, artifact.path, backend.id) ?? '—',
    }));

    if (flags.json) {
      printJson({ artifact, mirrors });
      return;
    }

    heading(`${artifact.kind}: ${artifact.title ?? artifact.slug}`);
    info(`slug    ${artifact.slug}`);
    info(`state   ${artifact.state ?? 'n/a'}`);
    info(`path    ${artifact.path}`);
    for (const mirror of mirrors) info(`${mirror.backend.padEnd(8)}${mirror.ref}`);
    return;
  }

  const artifacts = await listArtifacts(cwd, { kind: flags.kind });
  const counts = STATES.map((state) => [
    state,
    String(artifacts.filter((artifact) => artifact.state === state).length),
  ]);

  if (flags.json) {
    printJson({ total: artifacts.length, byState: Object.fromEntries(counts), backends: config.backends });
    return;
  }

  heading('Spec Framework status');
  info(`source of truth   ${config.sourceOfTruth}`);
  info(`backends          ${config.backends.map((backend) => `${backend.id}${backend.enabled ? '' : ' (off)'}`).join(', ')}`);
  if (remoteBackends.length > 0) {
    const linked = artifacts.filter((artifact) => remoteBackends.some((backend) => getRemoteRef(remoteMap, artifact.path, backend.id)));
    info(`remote mirrors    ${linked.length}/${artifacts.length} artifacts linked`);
  }
  line('');
  table(counts, ['state', 'artifacts']);
}
