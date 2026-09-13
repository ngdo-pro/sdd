import path from 'node:path';
import fsp from 'node:fs/promises';

/**
 * Legacy v2 layout scanners — relocated from `src/core/artifact.js` by the
 * feature 03 rework so `core/` knows nothing about state-encoded paths.
 * These listers READ the pre-v3 markdown/model layout under the literal
 * legacy root `.specs/` and are consumed only by `spec import` (markdown
 * workspaces). The legacy root is intentionally a literal: `SPECS_DIRNAME`
 * switched to `.sdd/`, and the legacy source must stay readable during a
 * migration. Never grow this file beyond migration needs.
 */

/** Legacy workspace root — also the token rewritten by the migration (`.specs/` → `.sdd/`). */
export const LEGACY_ROOT_DIRNAME = '.specs';

/** Legacy v2 model store directory name. */
export const MODEL_DIRNAME = 'model';

/** State → directory name in the legacy v2 layout (archived directory is `archive`). */
export const STATE_DIRS = {
  planned: 'planned',
  active: 'active',
  archived: 'archive',
};

/** Directory name → canonical state. */
export const STATE_BY_DIR = {
  planned: 'planned',
  active: 'active',
  archive: 'archived',
};

const SPEC_FILE_RE = /^(\d{3,4})-(.+)\.md$/;

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

/** Lists legacy v2 specs across state directories (`.specs/specs/<state>/<NNNN-slug>.md`). */
export async function listSpecs(cwd) {
  const root = path.join(cwd, LEGACY_ROOT_DIRNAME, 'specs');
  const artifacts = [];
  for (const state of Object.keys(STATE_DIRS)) {
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

/** Lists legacy v2 initiatives (`.specs/initiatives/<state>/<slug>/README.md`). */
export async function listInitiatives(cwd) {
  const root = path.join(cwd, LEGACY_ROOT_DIRNAME, 'initiatives');
  const artifacts = [];
  for (const state of Object.keys(STATE_DIRS)) {
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

/** Lists legacy v2 features (`.specs/initiatives/<initState>/<slug>/<featState>/<file>.md`). */
export async function listFeatures(cwd) {
  const root = path.join(cwd, LEGACY_ROOT_DIRNAME, 'initiatives');
  const artifacts = [];
  for (const initiativeState of Object.keys(STATE_DIRS)) {
    const initiativeDir = path.join(root, STATE_DIRS[initiativeState]);
    for (const initiativeEntry of await readdirSafe(initiativeDir)) {
      if (!initiativeEntry.isDirectory()) continue;
      const initiativeSlug = initiativeEntry.name;
      for (const featureState of Object.keys(STATE_DIRS)) {
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

/** Lists the legacy root-level vision markdown (`.specs/vision.md`). */
export async function listVision(cwd) {
  const file = path.join(cwd, LEGACY_ROOT_DIRNAME, 'vision.md');
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

function toPosix(value) {
  return value.split(path.sep).join('/');
}

async function exists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}