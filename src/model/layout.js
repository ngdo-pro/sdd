import { GENERATED_DIRNAME } from '../core/paths.js';

function requireRelation(meta, relation) {
  const value = meta.relations?.[relation];
  if (!value) {
    throw new Error(`${meta.kind} "${meta.slug}" is missing relations.${relation} (required to locate its files).`);
  }
  return value;
}

/**
 * Canonical model-relative POSIX paths for an artifact's files. The layout is
 * stateless: paths derive exclusively from slugs/ids and `relations` — no
 * lifecycle segment ever appears (INV-1).
 * @returns {{ dir: string, meta: string, body: string }}
 */
export function modelRelativePaths(meta) {
  switch (meta.kind) {
    case 'vision':
      return { dir: '', meta: 'vision.json', body: 'vision.md' };
    case 'initiative':
      return {
        dir: `initiatives/${meta.slug}`,
        meta: `initiatives/${meta.slug}/${meta.slug}.json`,
        body: `initiatives/${meta.slug}/${meta.slug}.md`,
      };
    case 'feature': {
      const initiativeSlug = requireRelation(meta, 'initiative');
      const base = `initiatives/${initiativeSlug}/features/${meta.slug}`;
      return { dir: base, meta: `${base}/${meta.slug}.json`, body: `${base}/${meta.slug}.md` };
    }
    case 'spec': {
      const initiativeSlug = requireRelation(meta, 'initiative');
      const featureSlug = requireRelation(meta, 'feature');
      const base = `initiatives/${initiativeSlug}/features/${featureSlug}/specs`;
      // File name is the bare id (INV-5): specs are nested, not state-bucketed.
      return { dir: base, meta: `${base}/${meta.id}.json`, body: `${base}/${meta.id}.md` };
    }
    default:
      throw new Error(`Unknown artifact kind "${meta.kind}".`);
  }
}

/**
 * Projection-relative POSIX path under the `generated/` namespace — every
 * markdown projection lives there, vision included. Paths derive from slugs/
 * ids and `relations` alone: no lifecycle segment ever appears, so a `spec
 * move` regenerates content at the same path instead of renaming files.
 * Features and specs are flattened at the initiative level to optimise
 * reading; spec file names are the bare id (INV-5, uniqueness enforced by
 * the `spec-id-uniqueness` rule).
 * @returns {string}
 */
export function projectionRelativePath(meta) {
  switch (meta.kind) {
    case 'vision':
      return `${GENERATED_DIRNAME}/vision.md`;
    case 'spec': {
      const initiativeSlug = requireRelation(meta, 'initiative');
      return `${GENERATED_DIRNAME}/initiatives/${initiativeSlug}/specs/${meta.id}.md`;
    }
    case 'initiative':
      return `${GENERATED_DIRNAME}/initiatives/${meta.slug}/README.md`;
    case 'feature': {
      const initiativeSlug = requireRelation(meta, 'initiative');
      return `${GENERATED_DIRNAME}/initiatives/${initiativeSlug}/features/${meta.slug}.md`;
    }
    default:
      throw new Error(`Unknown artifact kind "${meta.kind}".`);
  }
}
