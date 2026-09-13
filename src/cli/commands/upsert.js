import path from 'node:path';
import fsp from 'node:fs/promises';
import { UsageError } from '../../core/errors.js';
import { KINDS } from '../../core/paths.js';
import { normalizeState } from '../../core/transitions.js';
import { assertNoCoexistence } from '../../migrate/migrate.js';
import { createMeta } from '../../model/schema.js';
import { findByRef } from '../../model/store.js';
import { heading, info, printJson, success } from '../render.js';
import { loadContext, persistArtifact, refresh } from '../context.js';

async function readSource(from) {
  if (!from) return null;
  if (from === '-') {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
  }
  return fsp.readFile(path.resolve(from), 'utf8');
}

function parseFieldFlags(entries = []) {
  const fields = {};
  for (const entry of entries) {
    const separator = entry.indexOf('=');
    if (separator === -1) throw new UsageError(`Invalid --field "${entry}" (expected Key=Value).`);
    fields[entry.slice(0, separator).trim()] = entry.slice(separator + 1).trim();
  }
  return fields;
}

/**
 * Resolves the parent feature of a spec and derives `relations.initiative`
 * from it. The canonical path is not derivable without a fully linked parent,
 * so any failure aborts before a single byte is written.
 */
function requireParentFeature(artifacts, featureRef) {
  if (!featureRef) {
    throw new UsageError('spec requires --feature <ref> (its canonical path derives from the parent feature).');
  }
  let parent;
  try {
    parent = findByRef(artifacts, featureRef, { kind: 'feature' });
  } catch (error) {
    throw new UsageError(`No feature found for "${featureRef}" — nothing was written. (${error.message})`);
  }
  if (!parent.relations?.initiative) {
    throw new UsageError(`Feature "${parent.slug}" has no parent initiative; run \`spec link ${parent.slug} --initiative <slug>\` first.`);
  }
  return parent;
}

/**
 * `spec upsert <kind> --slug <slug> [--from <file|->] …`
 * Creates or updates an artifact at its definitive canonical location, then
 * re-projects. Specs must be attached to their parent feature (`--feature`);
 * `relations.initiative` is always derived from it.
 */
export async function upsert({ cwd, positionals, flags }) {
  assertNoCoexistence(cwd); // INV-5: mutations are locked while .specs/ + .sdd/ coexist
  const kind = positionals[0] ?? flags.kind;
  if (!kind || !KINDS.includes(kind)) {
    throw new UsageError(`Usage: spec upsert <${KINDS.join('|')}> --slug <slug> [--from <file|->]`);
  }
  const slug = flags.slug ?? (kind === 'vision' ? 'vision' : undefined);
  if (!slug) throw new UsageError('Missing --slug.');

  const { artifacts } = await loadContext(cwd);

  let existing = null;
  try {
    existing = findByRef(artifacts, slug, { kind });
  } catch {
    existing = null;
  }

  const parent = kind === 'spec' ? requireParentFeature(artifacts, flags.feature) : null;

  const sourceBody = await readSource(flags.from);
  const fields = parseFieldFlags(flags.field);
  const state = flags.state ? normalizeState(flags.state) : undefined;

  const base = existing
    ?? createMeta({ kind, slug, title: flags.title ?? slug, state: state ?? undefined });

  const updated = {
    ...base,
    title: flags.title ?? base.title,
    state: kind === 'vision' ? null : (state ?? base.state ?? 'planned'),
    relations: kind === 'spec'
      ? { feature: parent.slug, initiative: parent.relations.initiative }
      : {
        ...base.relations,
        ...(flags.feature ? { feature: flags.feature } : {}),
        ...(flags.initiative ? { initiative: flags.initiative } : {}),
      },
    fields: { ...base.fields, ...fields },
    progress: { ...base.progress, ...(flags.done ? { done: true } : {}) },
    body: sourceBody ?? base.body ?? '',
    updatedAt: new Date().toISOString().slice(0, 10),
  };

  const persisted = await persistArtifact(cwd, updated, { previous: existing?.model });
  await refresh(cwd, [...artifacts.filter((entry) => entry.slug !== persisted.slug || entry.kind !== persisted.kind), persisted]);

  if (flags.json) {
    printJson({ action: existing ? 'updated' : 'created', artifact: persisted });
    return;
  }

  heading(`${existing ? 'Updated' : 'Created'} ${kind} ${persisted.slug}`);
  info(`meta: ${persisted.model.meta}`);
  info(`body: ${persisted.model.body}`);
  success(`projection: ${persisted.projection}`);
}
