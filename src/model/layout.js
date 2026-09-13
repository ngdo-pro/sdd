import { STATE_DIRS } from '../core/paths.js';

/** Path of the state directory for a canonical state (interim v2 projections). */
export function stateDirOf(state) {
  return state ? STATE_DIRS[state] : null;
}

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
 * Projection-relative POSIX path (the generated markdown humans read).
 * UNCHANGED interim v2 convention (state-encoded) until feature 02 ships the
 * `generated/` namespace. No caller threads `initiativeState` anymore: feature
 * projections default to the `planned` initiative segment.
 * @returns {string}
 */
export function projectionRelativePath(meta, { initiativeState } = {}) {
  const dir = STATE_DIRS[meta.state];

  switch (meta.kind) {
    case 'vision':
      return 'vision.md';
    case 'spec':
      return `specs/${dir}/${meta.slug}.md`;
    case 'initiative':
      return `initiatives/${dir}/${meta.slug}/README.md`;
    case 'feature': {
      const initiativeSlug = requireRelation(meta, 'initiative');
      const initState = STATE_DIRS[initiativeState ?? 'planned'];
      return `initiatives/${initState}/${initiativeSlug}/${dir}/${meta.slug}.md`;
    }
    default:
      throw new Error(`Unknown artifact kind "${meta.kind}".`);
  }
}
