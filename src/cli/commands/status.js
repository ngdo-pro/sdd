import { STATES } from '../../core/paths.js';
import { findByRef } from '../../model/store.js';
import { buildGraph } from '../../model/graph.js';
import { heading, info, printJson, table } from '../render.js';
import { loadContext } from '../context.js';

/** `spec status [<ref>]` — model state, derived progress and remote mirrors. */
export async function status({ cwd, positionals, flags }) {
  const { config, artifacts, mirrors } = await loadContext(cwd, { only: flags.backends });
  const graph = buildGraph(artifacts);
  const reference = positionals[0];

  if (reference) {
    const artifact = findByRef(artifacts, reference, { kind: flags.kind });
    const progress = graph.progressOf(artifact.slug);
    const mirrorStates = config.backends.map((backend) => ({
      backend: backend.id,
      enabled: backend.enabled,
      ref: artifact.remote?.[backend.id] ?? '—',
    }));

    if (flags.json) {
      printJson({ artifact, progress, mirrors: mirrorStates });
      return;
    }

    heading(`${artifact.kind}: ${artifact.title}`);
    info(`slug      ${artifact.slug}`);
    info(`id        ${artifact.id}`);
    info(`state     ${artifact.state ?? 'n/a'}`);
    info(`complete  ${graph.isComplete(artifact) ? 'yes' : 'no'}${progress.children > 0 ? ` (${progress.completed}/${progress.children} children)` : ''}`);
    info(`meta      .sdd/canonical/${artifact.model.meta}`);
    info(`body      .sdd/canonical/${artifact.model.body}`);
    info(`projection .sdd/${artifact.projection}`);
    for (const mirror of mirrorStates) {
      info(`${mirror.backend.padEnd(9)} ${mirror.ref}${mirror.enabled ? '' : ' (disabled)'}`);
    }
    return;
  }

  const counts = STATES.map((state) => [
    state,
    artifacts.filter((artifact) => artifact.state === state).length,
  ]);

  if (flags.json) {
    printJson({
      sourceOfTruth: config.sourceOfTruth,
      total: artifacts.length,
      byState: Object.fromEntries(counts),
      backends: config.backends,
      mirrors: mirrors.map((mirror) => mirror.id),
    });
    return;
  }

  heading('Spec Framework status');
  info(`source of truth  ${config.sourceOfTruth} (.sdd/canonical/)`);
  info(`projections      markdown ${config.projections?.markdown === false ? 'off' : 'on'}`);
  info(`mirrors          ${config.backends.length === 0 ? 'none' : config.backends.map((backend) => `${backend.id}${backend.enabled ? '' : ' (off)'}`).join(', ')}`);
  const linked = artifacts.filter((artifact) => Object.keys(artifact.remote ?? {}).length > 0);
  if (linked.length > 0) info(`linked remotely  ${linked.length}/${artifacts.length}`);
  table([...counts, ['total', artifacts.length]], ['state', 'artifacts']);
}
