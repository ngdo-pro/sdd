import { STATE_DIRS } from '../core/paths.js';

/** Path of the state directory for a canonical state. */
export function stateDirOf(state) {
  return state ? STATE_DIRS[state] : null;
}

function requireInitiative(meta) {
  const slug = meta.relations?.initiative;
  if (!slug) {
    throw new Error(`${meta.kind} "${meta.slug}" is missing relations.initiative (required to locate its files).`);
  }
  return slug;
}

/**
 * Model-relative POSIX paths for an artifact's canonical files.
 * @returns {{ dir: string, meta: string, body: string }}
 */
export function modelRelativePaths(meta, { initiativeState } = {}) {
  const dir = STATE_DIRS[meta.state];

  switch (meta.kind) {
    case 'vision':
      return { dir: '', meta: 'vision.json', body: 'vision.md' };
    case 'spec':
      return {
        dir: `specs/${dir}`,
        meta: `specs/${dir}/${meta.slug}.json`,
        body: `specs/${dir}/${meta.slug}.md`,
      };
    case 'initiative':
      return {
        dir: `initiatives/${dir}/${meta.slug}`,
        meta: `initiatives/${dir}/${meta.slug}/${meta.slug}.json`,
        body: `initiatives/${dir}/${meta.slug}/${meta.slug}.md`,
      };
    case 'feature': {
      const initiativeSlug = requireInitiative(meta);
      const initState = STATE_DIRS[initiativeState ?? 'planned'];
      const base = `initiatives/${initState}/${initiativeSlug}/${dir}`;
      return { dir: base, meta: `${base}/${meta.slug}.json`, body: `${base}/${meta.slug}.md` };
    }
    default:
      throw new Error(`Unknown artifact kind "${meta.kind}".`);
  }
}

/**
 * Projection-relative POSIX path (the generated markdown humans read).
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
      const initiativeSlug = requireInitiative(meta);
      const initState = STATE_DIRS[initiativeState ?? 'planned'];
      return `initiatives/${initState}/${initiativeSlug}/${dir}/${meta.slug}.md`;
    }
    default:
      throw new Error(`Unknown artifact kind "${meta.kind}".`);
  }
}
