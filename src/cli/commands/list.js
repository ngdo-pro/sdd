import { normalizeState } from '../../core/transitions.js';
import { buildGraph } from '../../model/graph.js';
import { heading, printJson, table, warn } from '../render.js';
import { loadContext } from '../context.js';

/** `spec list [--kind k] [--state s]` — lists artifacts from the model. */
export async function list({ cwd, flags }) {
  const { artifacts } = await loadContext(cwd);

  const state = flags.state ? normalizeState(flags.state) : undefined;
  const filtered = artifacts
    .filter((artifact) => (flags.kind ? artifact.kind === flags.kind : true))
    .filter((artifact) => (state ? artifact.state === state : true))
    .sort((a, b) => `${a.kind}:${a.slug}`.localeCompare(`${b.kind}:${b.slug}`));

  if (flags.json) {
    printJson(filtered);
    return;
  }

  heading(`${filtered.length} artifact(s)`);
  if (filtered.length === 0) {
    warn('Nothing found.');
    return;
  }

  const graph = buildGraph(artifacts);
  table(
    filtered.map((artifact) => {
      const progress = graph.progressOf(artifact.slug);
      return [
        artifact.kind,
        artifact.id,
        artifact.state ?? '—',
        graph.isComplete(artifact) ? '✔' : '·',
        progress.children > 0 ? `${progress.completed}/${progress.children}` : '',
        (artifact.title ?? '').slice(0, 50),
      ];
    }),
    ['kind', 'id', 'state', 'done', 'children', 'title'],
  );
}
