import { MigrationError } from '../../core/errors.js';
import { LEGACY_ROOT_DIRNAME, planMigration, runMigration } from '../../migrate/migrate.js';
import { heading, info, line, printJson, success } from '../render.js';

const KIND_LABELS = { vision: 'vision', initiative: 'initiative', feature: 'features', spec: 'specs' };

function artifactCounts(artifacts) {
  const byKind = {};
  for (const artifact of artifacts) byKind[artifact.kind] = (byKind[artifact.kind] ?? 0) + 1;
  const parts = Object.entries(byKind).map(([kind, count]) => `${count} ${KIND_LABELS[kind] ?? kind}`);
  return `${artifacts.length}${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`;
}

function divergenceLine(divergence) {
  if (divergence.type === 'state-mismatch') {
    return `${divergence.kind} ${divergence.slug}: state-mismatch (metadata "${divergence.expected}", directory "${divergence.actual}")`;
  }
  if (divergence.type === 'position-mismatch') {
    return `${divergence.kind} ${divergence.slug}: position-mismatch (expected "${divergence.expected}", actual "${divergence.actual}")`;
  }
  if (divergence.type === 'unresolved-relations') {
    return `${divergence.kind} ${divergence.slug}: unresolved-relations (BLOCKING — ${divergence.actual})`;
  }
  return `${divergence.kind} ${divergence.slug}: legacy-residue (${divergence.actual ?? 'never reconstructed'})`;
}

function printPlan(plan) {
  heading(`Migration plan (layout: ${plan.layout}, source: ${plan.sourceRoot})`);

  const byKind = {};
  for (const artifact of plan.artifacts) byKind[artifact.kind] = (byKind[artifact.kind] ?? 0) + 1;
  const parts = Object.entries(byKind).map(([kind, count]) => `${count} ${KIND_LABELS[kind] ?? kind}`);
  info(`artifacts     ${plan.artifacts.length}${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`);

  if (plan.divergences.length === 0) info('divergences   0');
  else {
    info(`divergences   ${plan.divergences.length}`);
    for (const divergence of plan.divergences) line(`    · ${divergenceLine(divergence)}`);
  }

  const occurrences = plan.rewrites.reduce((sum, entry) => sum + entry.occurrences, 0);
  if (plan.rewrites.length === 0) info('rewrites      0 token rewrite');
  else {
    info(`rewrites      ${occurrences} token rewrite(s) across ${plan.rewrites.length} file(s)`);
    for (const entry of plan.rewrites.slice(0, 3)) line(`    · e.g. ${entry.file} (${entry.occurrences})`);
  }

  const bare = plan.unrewritten.reduce((sum, entry) => sum + entry.occurrences, 0);
  if (bare > 0) info(`unrewritten   ${bare} bare \`.specs\` mention(s) — listed, never rewritten`);

  if (plan.configWarnings.length === 0) info('config        0 warning(s)');
  else {
    info(`config        ${plan.configWarnings.length} warning(s)`);
    for (const warning of plan.configWarnings) line(`    · ${warning}`);
  }

  for (const removal of plan.removals) info(`removals      ${removal}`);
}

function printResult(result) {
  heading(`Workspace migrated to .sdd/ (source: ${LEGACY_ROOT_DIRNAME}/)`);
  info(`artifacts     ${result.artifacts}`);
  const occurrences = result.rewrites.reduce((sum, entry) => sum + entry.occurrences, 0);
  info(`rewrites      ${occurrences} token rewrite(s) across ${result.rewrites.length} file(s)`);
  for (const divergence of result.divergences) line(`    · ${divergenceLine(divergence)}`);
  info(`removed       ${result.removedRoot}`);
  success('A second `sdd migrate` is a no-op.');
}

/**
 * `sdd migrate [--dry-run] [--json]` — converts any identifiable legacy
 * workspace (v2 model, v3-canonical under `.specs/`) into `.sdd/` by FULL
 * reconstruction from the metadata, guarded by the strict gate
 * (validate = 0 finding, render --check = 0 drift), then retires `.specs/`.
 */
export async function migrate({ cwd, flags }) {
  if (flags.dryRun) {
    const plan = await planMigration(cwd);
    if (plan.layout === 'unsupported') throw new MigrationError(plan.detail);
    if (plan.layout === 'migrated') {
      info('Workspace already migrated (.sdd/).');
      line('  (dry-run: nothing was written)');
      return;
    }

    if (flags.json) {
      printJson({ status: 'planned', ...plan });
      return;
    }
    printPlan(plan);
    line('\n(dry-run: nothing was written)');
    return;
  }

  const result = await runMigration(cwd);
  if (flags.json) {
    printJson(result);
    return;
  }

  if (result.status === 'noop') {
    info('Workspace already migrated (.sdd/) — nothing to do.');
    return;
  }
  printResult(result);
}