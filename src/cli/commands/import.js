import { assertNoCoexistence } from '../../migrate/migrate.js';
import { importMarkdown } from '../../migrate/import.js';
import { heading, info, line, printJson, warn } from '../render.js';

/**
 * `spec import [--dry-run]` — converts legacy `.specs/` markdown documents
 * into the canonical model under `.sdd/`, then regenerates projections and
 * the index through the shared strict gate (retiring `.specs/` on success).
 * A JSON model anywhere refuses the import (exit 2 — run `spec migrate`),
 * and during coexistence the command is locked (INV-5) — `spec migrate` is
 * the recovery path in both cases.
 */
export async function importArtifacts({ cwd, flags }) {
  assertNoCoexistence(cwd); // INV-5: import is a mutating command (even --dry-run previews a locked conversion)

  const outcome = await importMarkdown(cwd, { force: flags.force, dryRun: flags.dryRun });

  if (outcome.dryRun) {
    if (flags.json) {
      printJson(outcome);
      return;
    }
    heading(`Planned import of ${outcome.results.length} document(s)`);
    for (const entry of outcome.results) info(`${entry.kind} ${entry.slug}: planned`);
    for (const rewrite of outcome.rewrites) info(`token rewrite: ${rewrite.file} (${rewrite.occurrences})`);
    for (const removal of outcome.removals) info(`removal: ${removal}`);
    line('\n(dry-run: nothing was written)');
    return;
  }

  if (outcome.results.length === 0) {
    warn('No markdown documents found to import.');
    return;
  }

  if (flags.json) {
    printJson({ imported: outcome.results, artifacts: outcome.artifacts });
    return;
  }

  heading(`Imported ${outcome.results.filter((entry) => entry.status === 'imported').length} document(s)`);
  for (const entry of outcome.results) {
    line(`  · ${entry.kind} ${entry.slug}: ${entry.status}`);
  }
  info(`${outcome.artifacts} artifact(s) in the model. Projections regenerated.`);
  info('Run `spec render --check` in CI to guard against drift.');
}