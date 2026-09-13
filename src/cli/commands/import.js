import { importMarkdown } from '../../migrate/import.js';
import { loadModel } from '../../model/store.js';
import { refresh } from '../context.js';
import { heading, info, printJson, success, table, warn } from '../render.js';

/**
 * `spec import` — migrates existing `.specs/` markdown documents into the
 * canonical model, then regenerates projections and the index.
 */
export async function importArtifacts({ cwd, flags }) {
  const results = await importMarkdown(cwd, { force: flags.force });

  if (results.length === 0) {
    warn('No markdown documents found to import.');
    return;
  }

  const artifacts = await loadModel(cwd);
  await refresh(cwd, artifacts);

  if (flags.json) {
    printJson({ imported: results, artifacts: artifacts.length });
    return;
  }

  heading(`Imported ${results.filter((entry) => entry.status === 'imported').length} document(s)`);
  table(results.map((entry) => [entry.kind, entry.slug, entry.status]), ['kind', 'slug', 'status']);
  info(`${artifacts.length} artifact(s) in the model. Projections regenerated.`);
  success('Run `spec render --check` in CI to guard against drift.');
}
