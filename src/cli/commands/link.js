import { UsageError } from '../../core/errors.js';
import { loadConfig } from '../../core/config.js';
import { createBackends, getSourceBackend } from '../../backends/registry.js';
import { arrow, heading, info, line, printJson, success } from '../render.js';

/**
 * `spec link <ref>` — wires an artifact into its parent document.
 *   spec link <spec-ref>    --feature <ref>
 *   spec link <feature-ref> [--initiative <slug>]
 */
export async function link({ cwd, positionals, flags }) {
  const reference = positionals[0];
  if (!reference) {
    throw new UsageError('Usage: spec link <ref> [--feature <ref>] [--initiative <slug>]');
  }

  const config = await loadConfig(cwd);
  const backends = await createBackends(cwd, config, { only: flags.backends });
  const source = getSourceBackend(backends, config);
  const child = await source.resolve(reference, { kind: flags.kind });

  let parent;
  let relation;
  if (child.kind === 'spec') {
    if (!flags.feature) throw new UsageError('Linking a spec requires --feature <ref>.');
    parent = await source.resolve(flags.feature, { kind: 'feature' });
    relation = 'spec-of-feature';
  } else if (child.kind === 'feature') {
    const initiativeRef = flags.initiative ?? child.meta?.initiative;
    if (!initiativeRef) throw new UsageError('Linking a feature requires --initiative <slug>.');
    parent = await source.resolve(initiativeRef, { kind: 'initiative' });
    relation = 'feature-of-initiative';
  } else {
    throw new UsageError(`Cannot link kind "${child.kind}". Supported kinds: spec, feature.`);
  }

  const results = [];
  for (const backend of backends) {
    if (!backend.capabilities?.link) {
      results.push({ backend: backend.id, linked: false, skipped: true });
      continue;
    }
    const result = await backend.link({ child, parent, relation }, { dryRun: flags.dryRun });
    results.push({ backend: backend.id, ...result });
  }

  if (flags.json) {
    printJson({ child, parent, relation, results });
    return;
  }

  heading(`Linking ${child.kind} ${child.slug} ${arrow()} ${parent.kind} ${parent.slug}`);
  for (const result of results) {
    if (result.skipped) info(`${result.backend}: link not supported, skipped`);
    else if (result.planned) line(`  ${result.backend}: would update ${result.parent}`);
    else if (result.alreadyLinked) info(`${result.backend}: already linked`);
    else if (result.linked) success(`${result.backend}: updated ${result.parent}`);
  }
}
