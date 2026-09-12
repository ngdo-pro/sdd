import { UsageError } from '../../core/errors.js';
import { loadConfig } from '../../core/config.js';
import { createBackends, getSourceBackend } from '../../backends/registry.js';
import { loadRemoteMap, saveRemoteMap } from '../../core/remote-map.js';
import { normalizeState } from '../../core/transitions.js';
import { arrow, heading, info, line, printJson, success } from '../render.js';

/**
 * `spec move <ref> --to <state>` — the core movement.
 * Applies a lifecycle transition to every selected backend.
 */
export async function move({ cwd, positionals, flags }) {
  const reference = positionals[0];
  if (!reference) {
    throw new UsageError('Usage: spec move <ref> --to <planned|active|archived>');
  }

  const toState = normalizeState(flags.to);
  if (!toState) {
    throw new UsageError(`Invalid or missing --to value "${flags.to ?? ''}" (expected: planned, active, archived).`);
  }

  const config = await loadConfig(cwd);
  const backends = await createBackends(cwd, config, { only: flags.backends });
  const source = getSourceBackend(backends, config);
  const artifact = await source.resolve(reference, { kind: flags.kind });

  const remoteMap = await loadRemoteMap(cwd);
  const results = [];
  for (const backend of backends) {
    const result = await backend.transition(artifact, toState, { remoteMap, dryRun: flags.dryRun });
    results.push({ backend: backend.id, ...result });
  }
  if (!flags.dryRun) await saveRemoteMap(cwd, remoteMap);

  if (flags.json) {
    printJson({ artifact, to: toState, results });
    return;
  }

  heading(`Moving ${artifact.kind} ${artifact.slug}`);
  info(`${artifact.state ?? '—'} ${arrow()} ${toState}`);
  for (const result of results) {
    if (result.planned) {
      line(`  ${result.backend}: would move ${result.from} ${arrow()} ${result.to}${result.state ? ` (${result.state})` : ''}`);
    } else if (result.moved) {
      const detail = result.remoteRef ? `${result.remoteRef} ${arrow()} ${result.state}` : `${result.from} ${arrow()} ${result.to}`;
      success(`${result.backend}: ${detail}`);
    } else {
      info(`${result.backend}: already ${toState}`);
    }
  }
  if (flags.dryRun) line('\n  (dry-run: nothing was written)');
}
