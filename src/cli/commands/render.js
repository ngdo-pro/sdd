import { loadModel } from '../../model/store.js';
import { refresh } from '../context.js';
import { heading, info, printJson, success, table, warn } from '../render.js';

/**
 * `spec render [--check]` — regenerates every markdown projection (and the
 * index) from the canonical model. With `--check`, reports drift and exits 1.
 */
export async function render({ cwd, flags }) {
  const artifacts = await loadModel(cwd);

  if (artifacts.length === 0) {
    warn('The model is empty. Run `spec import` or `spec upsert` first.');
    return;
  }

  const results = await refresh(cwd, artifacts, { check: flags.check });
  const drifted = results.filter((entry) => entry.status === 'stale' || entry.status === 'missing');

  if (flags.json) {
    printJson({ check: flags.check, results });
    if (flags.check && drifted.length > 0) process.exitCode = 1;
    return;
  }

  if (flags.check) {
    heading(`Checking ${results.length} projection(s)`);
    if (drifted.length === 0) {
      success('All projections are up to date with the model.');
      return;
    }
    for (const entry of drifted) warn(`${entry.path} is ${entry.status}`);
    info(`${drifted.length} projection(s) out of date. Run \`spec render\`.`);
    process.exitCode = 1;
    return;
  }

  heading(`Rendered ${results.length} projection(s)`);
  const changed = results.filter((entry) => entry.status !== 'unchanged');
  if (changed.length === 0) {
    info('Everything already up to date.');
    return;
  }
  table(changed.map((entry) => [entry.kind, entry.slug, entry.status, entry.path]), ['kind', 'slug', 'status', 'path']);
}
