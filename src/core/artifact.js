import path from 'node:path';
import fsp from 'node:fs/promises';
import { ResolutionError } from './errors.js';
import {
  SPECS_DIRNAME,
  STATES,
  STATE_DIRS,
  STATE_BY_DIR,
  exists,
  isDir,
  toPosix,
} from './paths.js';

const SPEC_FILE_RE = /^(\d{3})-(.+)\.md$/;

async function readTitle(absolutePath) {
  try {
    const content = await fsp.readFile(absolutePath, 'utf8');
    const match = content.match(/^#\s+(.+?)\s*$/m);
    return match ? match[1].replace(/^#\s*/, '') : null;
  } catch {
    return null;
  }
}

async function readdirSafe(dir) {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function listSpecs(cwd) {
  const root = path.join(cwd, SPECS_DIRNAME, 'specs');
  const artifacts = [];
  for (const state of STATES) {
    const dir = path.join(root, STATE_DIRS[state]);
    for (const entry of await readdirSafe(dir)) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const match = entry.name.match(SPEC_FILE_RE);
      if (!match) continue;
      const absolute = path.join(dir, entry.name);
      artifacts.push({
        kind: 'spec',
        id: match[1],
        slug: `${match[1]}-${match[2]}`,
        title: await readTitle(absolute),
        state,
        path: toPosix(path.relative(cwd, absolute)),
      });
    }
  }
  return artifacts;
}

export async function listInitiatives(cwd) {
  const root = path.join(cwd, SPECS_DIRNAME, 'initiatives');
  const artifacts = [];
  for (const state of STATES) {
    const dir = path.join(root, STATE_DIRS[state]);
    for (const entry of await readdirSafe(dir)) {
      if (!entry.isDirectory()) continue;
      const readme = path.join(dir, entry.name, 'README.md');
      if (!(await exists(readme))) continue;
      artifacts.push({
        kind: 'initiative',
        id: entry.name,
        slug: entry.name,
        title: await readTitle(readme),
        state,
        path: toPosix(path.relative(cwd, readme)),
      });
    }
  }
  return artifacts;
}

export async function listFeatures(cwd) {
  const root = path.join(cwd, SPECS_DIRNAME, 'initiatives');
  const artifacts = [];
  for (const initiativeState of STATES) {
    const initiativeDir = path.join(root, STATE_DIRS[initiativeState]);
    for (const initiativeEntry of await readdirSafe(initiativeDir)) {
      if (!initiativeEntry.isDirectory()) continue;
      const initiativeSlug = initiativeEntry.name;
      for (const featureState of STATES) {
        const featureDir = path.join(initiativeDir, initiativeSlug, STATE_DIRS[featureState]);
        for (const entry of await readdirSafe(featureDir)) {
          if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
          const absolute = path.join(featureDir, entry.name);
          const slug = entry.name.replace(/\.md$/, '');
          artifacts.push({
            kind: 'feature',
            id: slug,
            slug,
            title: await readTitle(absolute),
            state: featureState,
            path: toPosix(path.relative(cwd, absolute)),
            meta: { initiative: initiativeSlug, initiativeState },
          });
        }
      }
    }
  }
  return artifacts;
}

async function listVision(cwd) {
  const file = path.join(cwd, SPECS_DIRNAME, 'vision.md');
  if (!(await exists(file))) return [];
  return [{
    kind: 'vision',
    id: 'vision',
    slug: 'vision',
    title: await readTitle(file),
    state: null,
    path: toPosix(path.relative(cwd, file)),
  }];
}

/** Lists every artifact, optionally filtered by `kind` and/or `state`. */
export async function listArtifacts(cwd, { kind, state } = {}) {
  const collectors = {
    spec: listSpecs,
    initiative: listInitiatives,
    feature: listFeatures,
    vision: listVision,
  };

  const kinds = kind ? [kind] : ['spec', 'initiative', 'feature'];
  const groups = await Promise.all(kinds.map((entry) => collectors[entry]?.(cwd) ?? []));
  const flat = groups.flat();
  return state ? flat.filter((artifact) => artifact.state === state) : flat;
}

/**
 * Classifies a workspace-relative markdown path into an artifact descriptor.
 * Returns `null` when the path does not match any known layout.
 */
export async function classifyRelativePath(cwd, relativePath) {
  const parts = toPosix(relativePath).split('/');
  if (parts[0] !== SPECS_DIRNAME) return null;

  if (parts.length === 2 && parts[1] === 'vision.md') {
    const absolute = path.join(cwd, relativePath);
    return {
      kind: 'vision',
      id: 'vision',
      slug: 'vision',
      title: await readTitle(absolute),
      state: null,
      path: toPosix(relativePath),
    };
  }

  // .specs/specs/<state>/<file>
  if (parts[1] === 'specs' && parts.length === 4) {
    const state = STATE_BY_DIR[parts[2]];
    const match = parts[3].match(SPEC_FILE_RE);
    if (!state || !match) return null;
    const absolute = path.join(cwd, relativePath);
    return {
      kind: 'spec',
      id: match[1],
      slug: `${match[1]}-${match[2]}`,
      title: await readTitle(absolute),
      state,
      path: toPosix(relativePath),
    };
  }

  // .specs/initiatives/<state>/<slug>/README.md
  if (parts[1] === 'initiatives' && parts.length === 5 && parts[4] === 'README.md') {
    const state = STATE_BY_DIR[parts[2]];
    if (!state) return null;
    const absolute = path.join(cwd, relativePath);
    return {
      kind: 'initiative',
      id: parts[3],
      slug: parts[3],
      title: await readTitle(absolute),
      state,
      path: toPosix(relativePath),
    };
  }

  // .specs/initiatives/<state>/<slug>/<feature-state>/<file>.md
  if (parts[1] === 'initiatives' && parts.length === 6) {
    const featureState = STATE_BY_DIR[parts[4]];
    if (!featureState) return null;
    const slug = parts[5].replace(/\.md$/, '');
    const absolute = path.join(cwd, relativePath);
    return {
      kind: 'feature',
      id: slug,
      slug,
      title: await readTitle(absolute),
      state: featureState,
      path: toPosix(relativePath),
      meta: { initiative: parts[3], initiativeState: STATE_BY_DIR[parts[2]] },
    };
  }

  return null;
}

/**
 * Resolves a user reference into an artifact descriptor.
 * Supported forms: `042`, `42-auth`, `auth-login`, `.specs/specs/active/042-auth.md`.
 */
export async function resolveArtifact(cwd, reference, { kind } = {}) {
  if (!reference || typeof reference !== 'string') {
    throw new ResolutionError('A reference is required (spec ID, slug, or path).');
  }

  const byPath = await resolveByPath(cwd, reference);
  if (byPath && (!kind || byPath.kind === kind)) return byPath;

  const candidates = await listArtifacts(cwd, kind ? { kind } : {});
  const cleaned = reference.trim().replace(/^\.\//, '').replace(/\.md$/, '');

  const idMatch = cleaned.match(/^(\d{1,3})(?:-(.+))?$/);
  if (idMatch) {
    const id = idMatch[1].padStart(3, '0');
    const suffix = idMatch[2];
    const found = candidates.find(
      (artifact) => artifact.kind === 'spec' && artifact.id === id && (!suffix || artifact.slug === `${id}-${suffix}`),
    );
    if (found) return found;
  }

  const exact = candidates.filter(
    (artifact) => artifact.slug === cleaned || artifact.id === cleaned,
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw ambiguousReference(reference, exact);

  // Fall back to a slug suffix match (`login` → `042-login`).
  const suffixed = candidates.filter((artifact) => artifact.slug.endsWith(`-${cleaned}`));
  if (suffixed.length === 1) return suffixed[0];
  if (suffixed.length > 1) throw ambiguousReference(reference, suffixed);

  throw new ResolutionError(`No artifact found for reference "${reference}".`);
}

function ambiguousReference(reference, matches) {
  const labels = matches.map((artifact) => `${artifact.kind}:${artifact.slug}`).join(', ');
  return new ResolutionError(
    `Ambiguous reference "${reference}" matches multiple artifacts (${labels}). Use --kind to disambiguate.`,
  );
}

async function resolveByPath(cwd, reference) {
  const looksLikePath = reference.includes('/') || reference.endsWith('.md');
  if (!looksLikePath) return null;

  const absolute = path.isAbsolute(reference) ? reference : path.join(cwd, reference);
  if (!(await exists(absolute))) return null;
  const relativePath = toPosix(path.relative(cwd, absolute));
  return classifyRelativePath(cwd, relativePath);
}

export { isDir };

