import { findByRef } from '../../model/store.js';
import { heading, line, printJson, success, warn } from '../render.js';
import { loadContext, persistArtifact, refresh } from '../context.js';

/**
 * `spec sync [<ref>]` — reconciles remote mirrors with the canonical model.
 * Creates missing remote artifacts (`--create`) and realigns their state.
 */
export async function sync({ cwd, positionals, flags }) {
  const { artifacts, mirrors } = await loadContext(cwd, { only: flags.backends });

  if (mirrors.length === 0) {
    warn('No remote mirror enabled. Use `spec backend enable <id>`.');
    return;
  }

  const reference = positionals[0];
  const targets = reference ? [findByRef(artifacts, reference, { kind: flags.kind })] : artifacts;
  const dirty = new Set();
  const report = [];

  for (const artifact of targets) {
    if (artifact.state === null || artifact.state === undefined) continue;

    for (const mirror of mirrors) {
      const entry = { artifact: artifact.slug, kind: artifact.kind, backend: mirror.id, action: null, ok: true };
      try {
        if (!artifact.remote?.[mirror.id]) {
          if (!flags.create) {
            entry.action = 'skipped (not linked — use --create)';
            report.push(entry);
            continue;
          }
          const created = await mirror.create(artifact, { dryRun: flags.dryRun });
          entry.action = created.planned ? 'would create' : `created ${created.remoteRef}`;
          if (created.remoteRef) {
            artifact.remote = { ...artifact.remote, [mirror.id]: created.remoteRef };
            dirty.add(artifact);
          }
        }
        if (!artifact.remote?.[mirror.id]) {
          report.push(entry);
          continue;
        }
        const transition = await mirror.transition(artifact, artifact.state, { dryRun: flags.dryRun });
        entry.action = entry.action ?? (transition.moved ? `state ${transition.state}` : 'in sync');
      } catch (error) {
        entry.ok = false;
        entry.action = error.message;
      }
      report.push(entry);
    }
  }

  if (!flags.dryRun) {
    for (const artifact of dirty) {
      await persistArtifact(cwd, artifacts, artifact, { previous: artifact.model });
    }
    await refresh(cwd, artifacts);
  }

  if (flags.json) {
    printJson(report);
    return;
  }

  heading(`Sync: ${report.length} operation(s)`);
  for (const entry of report) {
    const label = `${entry.artifact} [${entry.backend}]`;
    if (!entry.ok) warn(`${label}: ${entry.action}`);
    else if (entry.action?.startsWith('skipped')) line(`  · ${label}: ${entry.action}`);
    else success(`${label}: ${entry.action}`);
  }
  if (flags.dryRun) line('\n  (dry-run: nothing was written)');
}
