import { findByRef } from '../../model/store.js';
import { assertNoCoexistence } from '../../migrate/migrate.js';
import { heading, line, printJson, success, warn } from '../render.js';
import { loadContext, persistArtifact, refresh } from '../context.js';

/**
 * `sdd sync [<ref>]` — reconciles remote mirrors with the canonical model.
 * Creates missing remote artifacts (`--create`) and realigns their state.
 * Writes are locked during a pending migration (INV-5).
 */
export async function sync({ cwd, positionals, flags }) {
  if (!flags.dryRun) assertNoCoexistence(cwd);
  const { artifacts, mirrors } = await loadContext(cwd, { only: flags.connectors });

  if (mirrors.length === 0) {
    warn('No remote mirror enabled. Use `sdd connectors enable <id>`.');
    return;
  }

  const reference = positionals[0];
  const targets = reference ? [findByRef(artifacts, reference, { kind: flags.kind })] : artifacts;
  const dirty = new Set();
  const report = [];

  for (const artifact of targets) {
    if (artifact.state === null || artifact.state === undefined) continue;

    for (const mirror of mirrors) {
      const entry = { artifact: artifact.slug, kind: artifact.kind, connector: mirror.id, action: null, ok: true };
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

  // INV-2 (spec 007): per-connector aggregation — a connector succeeded when at
  // least one of its operations did not error. When every enabled mirror failed
  // (and at least one operation was attempted), the command exits 1 through
  // `process.exitCode` — never a thrown error, the per-artifact report stands.
  const succeededConnectors = new Set(report.filter((entry) => entry.ok).map((entry) => entry.connector));
  const failedConnectors = mirrors.filter((mirror) => !succeededConnectors.has(mirror.id)).length;
  const allFailed = !flags.dryRun && mirrors.length > 0 && report.length > 0 && failedConnectors === mirrors.length;

  if (!flags.dryRun) {
    for (const artifact of dirty) {
      await persistArtifact(cwd, artifact, { previous: artifact.model });
    }
    await refresh(cwd, artifacts);
  }

  if (flags.json) {
    printJson(report);
    if (allFailed) process.exitCode = 1;
    return;
  }

  heading(`Sync: ${report.length} operation(s)`);
  for (const entry of report) {
    const label = `${entry.artifact} [${entry.connector}]`;
    if (!entry.ok) warn(`${label}: ${entry.action}`);
    else if (entry.action?.startsWith('skipped')) line(`  · ${label}: ${entry.action}`);
    else success(`${label}: ${entry.action}`);
  }
  if (allFailed) {
    warn(`all enabled mirrors failed (${failedConnectors}/${mirrors.length})`);
    process.exitCode = 1;
  }
  if (flags.dryRun) line('\n  (dry-run: nothing was written)');
}
