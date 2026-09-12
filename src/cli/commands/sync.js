import { loadConfig } from '../../core/config.js';
import { createBackends, getSourceBackend } from '../../backends/registry.js';
import { loadRemoteMap, saveRemoteMap, getRemoteRef } from '../../core/remote-map.js';
import { listArtifacts } from '../../core/artifact.js';
import { heading, info, line, printJson, success, warn } from '../render.js';

/**
 * `spec sync [<ref>]` — reconciles local artifacts with remote backends.
 * Creates missing remote artifacts (`--create`) and realigns their state.
 */
export async function sync({ cwd, positionals, flags }) {
  const config = await loadConfig(cwd);
  const backends = await createBackends(cwd, config, { only: flags.backends });
  const source = getSourceBackend(backends, config);
  const remoteBackends = backends.filter((backend) => backend.remote);

  if (remoteBackends.length === 0) {
    warn('No remote backend enabled. Use `spec backend enable linear`.');
    return;
  }

  const reference = positionals[0];
  const artifacts = reference
    ? [await source.resolve(reference, { kind: flags.kind })]
    : await listArtifacts(cwd, { kind: flags.kind });

  const remoteMap = await loadRemoteMap(cwd);
  const report = [];

  for (const artifact of artifacts) {
    if (artifact.state === null || artifact.state === undefined) continue;
    for (const backend of remoteBackends) {
      const linked = getRemoteRef(remoteMap, artifact.path, backend.id);
      const entry = { artifact: artifact.path, backend: backend.id, action: null, ok: true };

      try {
        if (!linked) {
          if (!flags.create) {
            entry.action = 'skipped (not linked, use --create)';
            report.push(entry);
            continue;
          }
          const created = await backend.create(artifact, { remoteMap, dryRun: flags.dryRun });
          entry.action = created.planned ? `would create` : `created ${created.remoteRef}`;
        }
        const transition = await backend.transition(artifact, artifact.state, { remoteMap, dryRun: flags.dryRun });
        entry.action = entry.action ?? (transition.moved ? `state ${transition.state}` : 'in sync');
      } catch (error) {
        entry.ok = false;
        entry.action = error.message;
      }
      report.push(entry);
    }
  }

  if (!flags.dryRun) await saveRemoteMap(cwd, remoteMap);

  if (flags.json) {
    printJson(report);
    return;
  }

  heading(`Sync ${report.length} operation(s)`);
  for (const entry of report) {
    if (!entry.ok) warn(`${entry.artifact} [${entry.backend}]: ${entry.action}`);
    else success(`${entry.artifact} [${entry.backend}]: ${entry.action}`);
  }
  if (flags.dryRun) line('\n  (dry-run: nothing was written)');
}
