import { UsageError } from '../../core/errors.js';
import { findByRef } from '../../model/store.js';
import { arrow, heading, info, printJson, success } from '../render.js';
import { loadContext, persistArtifact, refresh } from '../context.js';

/**
 * `spec link <ref>` — records a parent relation in the canonical model.
 *   spec link <spec-ref>    --feature <ref>
 *   spec link <feature-ref> --initiative <slug>
 *
 * The parent's roadmap sections are then regenerated from the graph.
 */
export async function link({ cwd, positionals, flags }) {
  const reference = positionals[0];
  if (!reference) {
    throw new UsageError('Usage: spec link <ref> [--feature <ref>] [--initiative <slug>]');
  }

  const { artifacts } = await loadContext(cwd);
  const child = findByRef(artifacts, reference, { kind: flags.kind });

  let relation = null;
  let parentRef = null;

  if (child.kind === 'spec') {
    if (!flags.feature) throw new UsageError('Linking a spec requires --feature <ref>.');
    relation = 'feature';
    parentRef = flags.feature;
  } else if (child.kind === 'feature') {
    parentRef = flags.initiative ?? child.relations?.initiative;
    if (!parentRef) throw new UsageError('Linking a feature requires --initiative <slug>.');
    relation = 'initiative';
  } else {
    throw new UsageError(`Cannot link kind "${child.kind}". Supported kinds: spec, feature.`);
  }

  const parent = findByRef(artifacts, parentRef, { kind: relation });
  if (child.relations?.[relation] === parent.slug) {
    info(`${child.kind} ${child.slug} is already linked to ${relation} ${parent.slug}.`);
    return;
  }

  const updated = {
    ...child,
    relations: { ...child.relations, [relation]: parent.slug },
    updatedAt: new Date().toISOString().slice(0, 10),
  };

  const persisted = flags.dryRun
    ? updated
    : await persistArtifact(cwd, artifacts, updated, { previous: child.model });

  if (!flags.dryRun) {
    const index = artifacts.findIndex((entry) => entry.slug === child.slug && entry.kind === child.kind);
    if (index !== -1) artifacts[index] = persisted;
    await refresh(cwd, artifacts);
  }

  if (flags.json) {
    printJson({ artifact: persisted.slug, relation, parent: parent.slug, dryRun: flags.dryRun });
    return;
  }

  heading(`Linking ${child.kind} ${child.slug} ${arrow()} ${parent.kind} ${parent.slug}`);
  if (flags.dryRun) info('(dry-run: nothing was written)');
  else success(`${parent.kind} ${parent.slug} roadmap regenerated.`);
}
