import { UsageError } from '../../core/errors.js';
import { assertTransition, normalizeState } from '../../core/transitions.js';
import { assertNoCoexistence } from '../../migrate/migrate.js';
import { findByRef, moveArtifact } from '../../model/store.js';
import { arrow, heading, info, line, printJson, success, warn } from '../render.js';
import { loadContext, persistArtifact, refresh, runCascade } from '../context.js';

/**
 * `sdd move <ref> --to <state>` — a metadata-only lifecycle transition
 * (zero files relocated), mirrored onto every enabled remote connector.
 */
export async function move({ cwd, positionals, flags }) {
  const reference = positionals[0];
  if (!reference) {
    throw new UsageError('Usage: sdd move <ref> --to <planned|active|archived>');
  }
  const toState = normalizeState(flags.to);
  if (!toState) {
    throw new UsageError(`Invalid or missing --to value "${flags.to ?? ''}" (expected: planned, active, archived).`);
  }
  if (!flags.dryRun) assertNoCoexistence(cwd); // INV-5: mutations locked during coexistence

  const { artifacts, mirrors } = await loadContext(cwd, { only: flags.connectors });
  const artifact = findByRef(artifacts, reference, { kind: flags.kind });

  const mustMove = assertTransition(artifact, toState) === true;

  // Mirrors first: a failing remote leaves the model untouched.
  const mirrorResults = [];
  const remoteRefs = {};
  for (const mirror of mirrors) {
    try {
      const result = await mirror.transition(artifact, toState, { dryRun: flags.dryRun });
      mirrorResults.push({ connector: mirror.id, ...result });
      if (result.remoteRef) remoteRefs[mirror.id] = result.remoteRef;
    } catch (error) {
      mirrorResults.push({ connector: mirror.id, error: error.message });
    }
  }

  // INV-2 (spec 007): every enabled mirror failed (zero successful result) ⇒
  // the command exits 1 through `process.exitCode` — never a thrown error, the
  // per-mirror report stands. Partial success or no mirror ⇒ exit 0.
  const succeededCount = mirrorResults.filter((result) => !result.error).length;
  const failedCount = mirrorResults.length - succeededCount;
  const allFailed = !flags.dryRun && mirrors.length > 0 && succeededCount === 0;

  const next = { ...artifact, remote: { ...artifact.remote, ...remoteRefs } };
  let moved = next;

  if (!flags.dryRun) {
    moved = mustMove
      ? await moveArtifact(cwd, next, toState)
      : await persistArtifact(cwd, next, { previous: artifact.model });

    const index = artifacts.findIndex((entry) => entry.slug === artifact.slug && entry.kind === artifact.kind);
    if (index !== -1) artifacts[index] = moved;
  }

  const cascade = flags.cascade ? await runCascade(cwd, artifacts, { dryRun: flags.dryRun }) : [];
  if (!flags.dryRun) await refresh(cwd, artifacts);

  if (flags.json) {
    printJson({ artifact: moved.slug, from: artifact.state, to: toState, mirrors: mirrorResults, cascade });
    if (allFailed) process.exitCode = 1;
    return;
  }

  heading(`Moving ${artifact.kind} ${artifact.slug}`);
  info(`${artifact.state ?? '—'} ${arrow()} ${toState}`);
  if (!mustMove) info('already in this state');

  for (const result of mirrorResults) {
    if (result.error) warn(`${result.connector}: ${result.error}`);
    else if (result.planned) line(`  ${result.connector}: would move to ${result.state ?? toState}`);
    else if (result.moved) success(`${result.connector}: ${result.remoteRef ?? ''} ${arrow()} ${result.state ?? toState}`.trim());
    else info(`${result.connector}: already up to date`);
  }

  for (const entry of cascade) {
    if (entry.planned) info(`would cascade-archive ${entry.kind} ${entry.slug}`);
    else success(`${entry.kind} ${entry.slug} archived (all children complete)`);
  }

  if (allFailed) {
    warn(`all enabled mirrors failed (${failedCount}/${mirrors.length})`);
    process.exitCode = 1;
  }

  if (flags.dryRun) line('\n  (dry-run: nothing was written)');
}
