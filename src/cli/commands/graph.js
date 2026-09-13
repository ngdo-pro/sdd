import { buildIndex, writeIndex } from '../../model/index.js';
import { loadModel } from '../../model/store.js';
import { buildGraph } from '../../model/graph.js';
import { assertNoCoexistence } from '../../migrate/migrate.js';
import { heading, info, printJson, success, table } from '../render.js';

/**
 * `sdd graph [--json] [--write]` — inspects the artifact graph.
 * `--write` regenerates `.sdd/canonical/index.json` (guarded by the
 * coexistence lock, INV-5); plain reads are exempt.
 */
export async function graph({ cwd, flags }) {
  if (flags.write) assertNoCoexistence(cwd);
  const artifacts = await loadModel(cwd);
  const index = buildIndex(artifacts);

  if (flags.write) {
    await writeIndex(cwd, artifacts);
    if (!flags.json) success('Wrote .sdd/canonical/index.json');
  }

  if (flags.json) {
    printJson(index);
    return;
  }

  const graph = buildGraph(artifacts);
  heading(`Model: ${artifacts.length} artifact(s)`);
  info(`index: .sdd/canonical/index.json${flags.write ? '' : ' (use --write to regenerate)'}`);

  const rows = artifacts
    .slice()
    .sort((a, b) => `${a.kind}:${a.slug}`.localeCompare(`${b.kind}:${b.slug}`))
    .map((artifact) => {
      const progress = graph.progressOf(artifact.slug);
      const children = progress.children > 0 ? `${progress.completed}/${progress.children}` : '';
      return [
        artifact.kind,
        artifact.id,
        artifact.state ?? '—',
        graph.isComplete(artifact) ? '✔' : '·',
        children,
        (artifact.title ?? '').slice(0, 40),
      ];
    });
  table(rows, ['kind', 'id', 'state', 'done', 'children', 'title']);
}
