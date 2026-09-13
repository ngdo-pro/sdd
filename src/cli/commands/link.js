import { UsageError } from '../../core/errors.js';
import { findByRef } from '../../model/store.js';
import { arrow, heading, info, printJson, success } from '../render.js';
import { loadContext, persistArtifact, refresh } from '../context.js';

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Resolves the parent feature of a spec; the initiative is always derived
 * from it (never passed independently).
 */
function requireParentFeature(artifacts, featureRef) {
  if (!featureRef) throw new UsageError('Linking a spec requires --feature <ref>.');
  let parent;
  try {
    parent = findByRef(artifacts, featureRef, { kind: 'feature' });
  } catch (error) {
    throw new UsageError(`No feature found for "${featureRef}" — nothing was written. (${error.message})`);
  }
  if (!parent.relations?.initiative) {
    throw new UsageError(`Feature "${parent.slug}" has no parent initiative; link it to an initiative first.`);
  }
  return parent;
}

/**
 * `spec link <ref>` — records a parent relation in the canonical model.
 *   spec link <spec-ref>    --feature <ref>     (initiative derived from the feature)
 *   spec link <feature-ref> --initiative <slug> (relocates the feature AND its specs)
 *
 * Relocation follows `previous`: parent first, then descendant specs, so the
 * tree never keeps orphans at the old location.
 */
export async function link({ cwd, positionals, flags }) {
  const reference = positionals[0];
  if (!reference) {
    throw new UsageError('Usage: spec link <ref> [--feature <ref>] [--initiative <slug>]');
  }

  const { artifacts } = await loadContext(cwd);
  const child = findByRef(artifacts, reference, { kind: flags.kind });

  let relation = null;
  let parent = null;
  let updated = null;
  let descendants = [];

  if (child.kind === 'spec') {
    relation = 'feature';
    parent = requireParentFeature(artifacts, flags.feature);
    if (child.relations?.feature === parent.slug && child.relations?.initiative === parent.relations.initiative) {
      info(`${child.kind} ${child.slug} is already linked to ${relation} ${parent.slug}.`);
      return;
    }
    updated = {
      ...child,
      relations: { feature: parent.slug, initiative: parent.relations.initiative },
      updatedAt: today(),
    };
  } else if (child.kind === 'feature') {
    relation = 'initiative';
    const parentRef = flags.initiative ?? child.relations?.initiative;
    if (!parentRef) throw new UsageError('Linking a feature requires --initiative <slug>.');
    try {
      parent = findByRef(artifacts, parentRef, { kind: 'initiative' });
    } catch (error) {
      throw new UsageError(`No initiative found for "${parentRef}" — nothing was written. (${error.message})`);
    }
    if (child.relations?.initiative === parent.slug) {
      info(`${child.kind} ${child.slug} is already linked to ${relation} ${parent.slug}.`);
      return;
    }
    updated = {
      ...child,
      relations: { ...child.relations, initiative: parent.slug },
      updatedAt: today(),
    };
    // Specs follow their feature: the initiative segment of their canonical
    // path is derived from `relations.initiative`, so it must be re-derived.
    descendants = artifacts
      .filter((artifact) => artifact.kind === 'spec' && artifact.relations?.feature === child.slug)
      .map((spec) => ({
        ...spec,
        relations: { ...spec.relations, initiative: parent.slug },
        updatedAt: today(),
      }));
  } else {
    throw new UsageError(`Cannot link kind "${child.kind}". Supported kinds: spec, feature.`);
  }

  const persisted = flags.dryRun ? updated : await persistArtifact(cwd, updated, { previous: child.model });
  const persistedDescendants = flags.dryRun
    ? descendants
    : [];
  if (!flags.dryRun) {
    for (const descendant of descendants) {
      persistedDescendants.push(await persistArtifact(cwd, descendant, { previous: descendant.model }));
    }
  }

  if (!flags.dryRun) {
    const replace = (record) => {
      const index = artifacts.findIndex((entry) => entry.slug === record.slug && entry.kind === record.kind);
      if (index !== -1) artifacts[index] = record;
    };
    replace(persisted);
    for (const descendant of persistedDescendants) replace(descendant);
    await refresh(cwd, artifacts);
  }

  if (flags.json) {
    printJson({
      artifact: persisted.slug,
      relation,
      parent: parent.slug,
      relocated: persistedDescendants.map((entry) => entry.slug),
      dryRun: flags.dryRun,
    });
    return;
  }

  heading(`Linking ${child.kind} ${child.slug} ${arrow()} ${parent.kind} ${parent.slug}`);
  for (const descendant of persistedDescendants) {
    info(`relocated spec ${descendant.slug} ${arrow()} ${descendant.model.meta}`);
  }
  if (flags.dryRun) info('(dry-run: nothing was written)');
  else success(`${parent.kind} ${parent.slug} roadmap regenerated.`);
}
