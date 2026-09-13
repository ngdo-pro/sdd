import { loadConfig } from '../../core/config.js';
import { UsageError } from '../../core/errors.js';
import { assertNoCoexistence } from '../../migrate/migrate.js';
import { loadModel } from '../../model/store.js';
import { writeIndex } from '../../model/index.js';
import { renderSite } from '../../render/site.js';
import { refresh } from '../context.js';
import { heading, info, printJson, success, table, warn } from '../render.js';

const DRIFT_STATUSES = new Set(['stale', 'missing', 'unexpected']);

/**
 * `spec render [--check] [--dry-run] [--site]` — regenerates every markdown
 * projection under `.sdd/generated/` (and the index) from the canonical
 * model, or the static consumption site under `.sdd/site/` with `--site`.
 * `--check` is the read-only CI guard over `generated/` (exit 1 on stale,
 * missing or unexpected — it never inspects `site/`). `--dry-run` previews
 * the full write plan without writing anything. `--site` is an autonomous
 * writing mode: it loads no config (independent of `projections.markdown`)
 * and writes nothing outside `.sdd/site/`. Reads pass through the
 * coexistence lock freely; only the writing modes are guarded (INV-5).
 */
export async function render({ cwd, flags }) {
  if (flags.site) {
    // 1. Flag conflict: a demand-regenerated artifact has nothing to preview
    //    or guard (INV-4: --check covers generated/ only).
    if (flags.check || flags.dryRun) {
      throw new UsageError(
        '`--site` cannot be combined with `--check` or `--dry-run`: the site is regenerated on demand, '
        + 'there is nothing to preview and nothing to guard (the drift check covers .sdd/generated/ only).',
      );
    }
    // 2. Coexistence guard — the site is a mutating write.
    assertNoCoexistence(cwd);
    // 3. The model only: no config is ever loaded (the site is independent
    //    of projections.markdown), no index read, no projection parsed.
    const artifacts = await loadModel(cwd);
    if (artifacts.length === 0) {
      // 4. Empty model: warn, write nothing, leave a pre-existing site/ intact.
      warn('The model is empty — nothing was written (an existing .sdd/site/ is left intact).');
      return;
    }
    // 5. Full purge + rebuild inside .sdd/site/.
    const results = await renderSite(cwd, artifacts);
    if (flags.json) {
      printJson({ site: true, results });
      return;
    }
    heading(`Rendered ${results.length} site page(s) into .sdd/site/`);
    table(results.map((entry) => [entry.kind, entry.slug, entry.path]), ['kind', 'slug', 'path']);
    return;
  }

  const writing = !flags.check && !flags.dryRun;
  if (writing) assertNoCoexistence(cwd);
  const config = await loadConfig(cwd);
  const artifacts = await loadModel(cwd);

  if (artifacts.length === 0) {
    warn('The model is empty. Run `spec import` or `spec upsert` first.');
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
    info(`${drifted.length} projection(s) out of date. Run \`spec render\`.`);
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
