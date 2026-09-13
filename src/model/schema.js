import { parseSpecSlug } from '../core/paths.js';

/** Current canonical model metadata version (v3 = stateless canonical layout). */
export const META_VERSION = 3;

const DEFAULT_FIELDS = {
  initiative: { 'Initiative Slug': null, Owner: 'TBD' },
};

export function slugify(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
}

/** Derives the immutable artifact id from its kind and slug. */
export function deriveId(kind, slug) {
  if (kind === 'spec') {
    const parsed = parseSpecSlug(slug);
    return parsed ? parsed.id : null;
  }
  return slug;
}

/** Builds a fresh, normalized artifact metadata object. */
export function createMeta({
  kind,
  slug,
  title,
  state,
  relations = {},
  fields = {},
  remote = {},
  progress = {},
  now = new Date().toISOString().slice(0, 10),
} = {}) {
  if (!kind) throw new Error('createMeta requires a kind.');
  if (!slug) throw new Error('createMeta requires a slug.');

  const id = deriveId(kind, slug);
  if (kind === 'spec' && !id) {
    throw new Error(`Spec slug "${slug}" must start with a 3- or 4-digit id (e.g. 042-login).`);
  }

  return {
    version: META_VERSION,
    kind,
    id,
    slug,
    title: title ?? slug,
    state: kind === 'vision' ? null : (state ?? 'planned'),
    relations: { ...relations },
    fields: { ...fields },
    remote: { ...remote },
    progress: { done: false, ...progress },
    createdAt: now,
    updatedAt: now,
  };
}

/** Normalizes a raw metadata object read from disk (tolerant to missing keys). */
export function normalizeMeta(raw, fallbackSlug) {
  const kind = raw.kind;
  const slug = raw.slug ?? fallbackSlug;
  const meta = createMeta({
    kind,
    slug,
    title: raw.title,
    state: raw.state,
    relations: raw.relations,
    fields: raw.fields,
    remote: raw.remote,
    progress: raw.progress,
  });
  if (raw.createdAt) meta.createdAt = raw.createdAt;
  if (raw.updatedAt) meta.updatedAt = raw.updatedAt;
  meta.version = META_VERSION;
  return meta;
}

/** True when the artifact may carry a lifecycle state. */
export function isStateful(kind) {
  return kind !== 'vision';
}

export function defaultFieldsFor(kind) {
  return { ...(DEFAULT_FIELDS[kind] ?? {}) };
}

/** Picks only the canonical, persistable metadata keys, in a stable order. */
export function serializeMeta(meta) {
  return {
    version: META_VERSION,
    kind: meta.kind,
    id: meta.id,
    slug: meta.slug,
    title: meta.title,
    state: meta.state ?? null,
    relations: meta.relations ?? {},
    fields: meta.fields ?? {},
    remote: meta.remote ?? {},
    progress: meta.progress ?? { done: false },
    createdAt: meta.createdAt ?? null,
    updatedAt: meta.updatedAt ?? null,
  };
}
