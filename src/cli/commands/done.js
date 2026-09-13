import { UsageError } from '../../core/errors.js';
import { canTransition } from '../../core/transitions.js';
import { findByRef, moveArtifact } from '../../model/store.js';
import { buildGraph } from '../../model/graph.js';
import { arrow, heading, info, printJson, success } from '../render.js';
import { initiativeStateOf, loadContext, persistArtifact, refresh, runCascade } from '../context.js';

/**
 * `spec done <ref>` — marks an artifact delivered and archives it, then
 * optionally archives parents whose children are all complete (`--cascade`).
 * `--undo` reopens it.
 */
export async function done({ cwd, positionals, flags }) {
  const reference = positionals[0];
  if (!reference) throw new UsageError('Usage: spec done <ref> [--undo] [--cascade] [--dry-run]');

  const { artifacts } = await loadContext(cwd);
  const artifact = findByRef(artifacts, reference, { kind: flags.kind });

  const target = !flags.undo;
  const updated = {
    ...artifact,
    progress: { ...artifact.progress, done: target },
    updatedAt: new Date().toISOString().slice(0, 10),
  };

  let persisted = artifact;
  const transitions = [];

  if (!flags.dryRun) {
    persisted = await persistArtifact(cwd, artifacts, updated, { previous: artifact.model });

    // Completing archives the artifact; reopening brings it back to active.
    const desiredState = flags.undo ? 'active' : 'archived';
    if (persisted.state && persisted.state !== desiredState && canTransition(persisted.state, desiredState)) {
      const before = persisted.state;
      persisted = await moveArtifact(cwd, persisted, desiredState, {
        initiativeState: initiativeStateOf(artifacts, persisted),
      });
      transitions.push(`${before} ${arrow()} ${desiredState}`);
    }

    const index = artifacts.findIndex((entry) => entry.slug === artifact.slug && entry.kind === artifact.kind);
    if (index !== -1) artifacts[index] = persisted;
  }

  const cascade = flags.cascade ? await runCascade(cwd, artifacts, { dryRun: flags.dryRun }) : [];
  if (!flags.dryRun) await refresh(cwd, artifacts);

  if (flags.json) {
    printJson({ artifact: persisted.slug, done: target, transitions, cascade });
    return;
  }

  heading(`${target ? 'Completed' : 'Reopened'} ${artifact.kind} ${artifact.slug}`);
  for (const transition of transitions) info(transition);
  for (const entry of cascade) {
    if (entry.planned) info(`would cascade-archive ${entry.kind} ${entry.slug}`);
    else success(`${entry.kind} ${entry.slug} archived (all children complete)`);
  }

  const archived = new Set(cascade.map((entry) => entry.slug));
  const graph = buildGraph(artifacts);
  const parent = graph.parentOf(persisted);
  if (parent && !archived.has(parent.slug)) {
    const progress = graph.progressOf(parent.slug);
    info(`${parent.kind} ${parent.slug}: ${progress.completed}/${progress.children} children complete ${arrow()} ${progress.complete ? 'ready to archive (use --cascade)' : 'in progress'}`);
  }
}
