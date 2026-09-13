import { loadConfig } from '../../core/config.js';
import { assertNoCoexistence } from '../../migrate/migrate.js';
import { loadModel } from '../../model/store.js';
import { writeIndex } from '../../model/index.js';
import { refresh } from '../context.js';
import { heading, info, printJson, success, table, warn } from '../render.js';

const DRIFT_STATUSES = new Set(['stale', 'missing', 'unexpected']);

/**
 * `sdd render [--check] [--dry-run]` — regenerates every markdown projection
 * under `.sdd/generated/` (and the index) from the canonical model.
 * `--check` is the read-only CI guard over `generated/` (exit 1 on stale,
 * missing or unexpected). `--dry-run` previews the full write plan without
 * writing anything. Reads pass through the coexistence lock freely; only the
 * writing mode is guarded (INV-5).
 */
export async function render({ cwd, flags }) {
  const writing = !flags.check && !flags.dryRun;
  if (writing) assertNoCoexistence(cwd);
  const config = await loadConfig(cwd);
  const artifacts = await loadModel(cwd);

  if (artifacts.length === 0) {
    warn('The model is empty. Run `sdd import` or `sdd upsert` first.');
    return;
  }

  if (config.projections?.markdown === false) {
    // No markdown projection is written or verified; the index is still
    // regenerated (except in check/dry-run modes, which write nothing).
    if (!flags.check && !flags.dryRun) await writeIndex(cwd, artifacts);
    if (flags.json) {
      printJson({ check: Boolean(flags.check), results: [] });
      return;
    }
    heading('Markdown projections are disabled (`projections.markdown: false`)');
    info(flags.check
      ? 'Nothing to check — 0 projection verified.'
      : flags.dryRun
        ? '(dry-run: nothing was written)'
        : 'Only the index was regenerated; no markdown projection was written.');
    return;
  }

  // `--check` takes precedence: it is read-only, so a concurrent --dry-run is meaningless.
  const results = await refresh(cwd, artifacts, {
    check: flags.check,
    dryRun: Boolean(flags.dryRun) && !flags.check,
    config,
  });
  const drifted = results.filter((entry) => DRIFT_STATUSES.has(entry.status));

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
    info(`${drifted.length} projection(s) out of date. Run \`sdd render\`.`);
    process.exitCode = 1;
    return;
  }

  if (flags.dryRun) {
    heading(`Planned ${results.length} projection change(s)`);
    const changed = results.filter((entry) => entry.status !== 'unchanged');
    if (changed.length === 0) info('Everything already up to date.');
    else table(changed.map((entry) => [entry.kind, entry.slug, entry.status, entry.path]), ['kind', 'slug', 'status', 'path']);
    info('(dry-run: nothing was written)');
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
