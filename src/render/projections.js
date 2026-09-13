import path from 'node:path';
import fsp from 'node:fs/promises';
import { ensureDir, exists, generatedRoot, specsRoot, toPosix } from '../core/paths.js';
import { buildGraph } from '../model/graph.js';
import { renderDocument } from './markdown.js';

/**
 * Markdown horizons owned by the render step: the `generated/` namespace plus
 * the legacy v2 tree (`specs/`, `initiatives/`, `vision.md`). The three v2
 * entries are only a transitional cutover sweep — no expected projection
 * lives there anymore; they are retired with the feature 03 rework.
 */
const MANAGED = ['generated', 'specs', 'initiatives', 'vision.md'];

async function readdirSafe(directory) {
  try {
    return await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function readIfExists(file) {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** Collects every markdown file under `directory`, as specs-root-relative POSIX paths. */
async function collectMarkdown(root, directory) {
  const found = [];

  async function walk(current) {
    for (const entry of await readdirSafe(current)) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && entry.name.endsWith('.md')) found.push(toPosix(path.relative(root, absolute)));
    }
  }

  await walk(directory);
  return found;
}

/**
 * Removes empty directories bottom-up within a managed subtree, stopping at
 * `baseDirectory` — the traversed root itself is never removed, and the walk
 * never climbs above the horizon it started from (watchout §6).
 */
async function pruneEmptyDirectories(directory, baseDirectory) {
  for (const entry of await readdirSafe(directory)) {
    if (entry.isDirectory()) await pruneEmptyDirectories(path.join(directory, entry.name), baseDirectory);
  }

  if (directory === baseDirectory) return;
  if ((await readdirSafe(directory)).length === 0) await fsp.rm(directory, { recursive: true, force: true });
}

/**
 * Deletes framework-managed markdown that is no longer a projected artifact:
 * orphans under `generated/` plus the legacy v2 tree swept during the cutover
 * (git is the safety net). With `dryRun`, the removals are only listed.
 * Knowledge and canonical documents are never touched.
 */
async function pruneStaleProjections(cwd, expected, { dryRun = false } = {}) {
  const root = specsRoot(cwd);
  const removed = [];

  const candidates = [];
  for (const relative of MANAGED) {
    const absolute = path.join(root, relative);
    if (!(await exists(absolute))) continue;
    const stats = await fsp.stat(absolute);
    if (stats.isDirectory()) candidates.push(...await collectMarkdown(root, absolute));
    else if (relative.endsWith('.md')) candidates.push(relative);
  }

  for (const relative of candidates) {
    if (expected.has(relative)) continue;
    if (!dryRun) await fsp.rm(path.join(root, relative), { force: true });
    removed.push(relative);
  }

  if (dryRun) return removed;

  // Empty-directory pruning stays inside each managed horizon: `generated/`
  // itself is preserved (it is a valid root entry), while the transient v2
  // directories disappear entirely once swept.
  await pruneEmptyDirectories(generatedRoot(cwd), generatedRoot(cwd));
  for (const directory of ['specs', 'initiatives']) {
    await pruneEmptyDirectories(path.join(root, directory), root);
  }

  return removed;
}

/**
 * Markdown files under `generated/` that the model no longer projects. With
 * `check` they are reported as drift (`unexpected`) instead of being deleted;
 * the v2 sweep is a write-only behaviour and is never inspected here.
 */
async function collectUnexpectedProjections(cwd, expected) {
  const root = specsRoot(cwd);
  const generated = await collectMarkdown(root, generatedRoot(cwd));
  return generated.filter((relative) => !expected.has(relative));
}

/**
 * Regenerates every markdown projection under `.specs/generated/` from the
 * model. With `check`, nothing is written and drift is reported instead
 * (stale, missing, unexpected — `generated/` only). With `dryRun`, the full
 * write plan (cutover sweep included) is computed without touching the disk.
 * @returns {Promise<Array<{ slug: string, kind: string, status: string, path: string }>>}
 */
export async function renderProjections(cwd, artifacts, { check = false, prune = true, dryRun = false } = {}) {
  const graph = buildGraph(artifacts);
  const root = specsRoot(cwd);
  const results = [];

  for (const artifact of artifacts) {
    if (!artifact.projection) continue; // un-derivable path — reported by `validate` (graph-integrity)
    const target = path.join(root, artifact.projection);
    const content = renderDocument(artifact, graph);
    const current = await readIfExists(target);

    if (current === content) {
      results.push({ slug: artifact.slug, kind: artifact.kind, status: 'unchanged', path: artifact.projection });
      continue;
    }

    const status = current === null ? 'created' : 'updated';
    if (check) {
      results.push({
        slug: artifact.slug,
        kind: artifact.kind,
        status: current === null ? 'missing' : 'stale',
        path: artifact.projection,
      });
      continue;
    }
    if (!dryRun) {
      await ensureDir(path.dirname(target));
      await fsp.writeFile(target, content, 'utf8');
    }
    results.push({ slug: artifact.slug, kind: artifact.kind, status, path: artifact.projection });
  }

  const expected = new Set(artifacts.filter((artifact) => artifact.projection).map((artifact) => artifact.projection));

  if (prune) {
    if (check) {
      // `--check` only covers `generated/`: unexpected files are reported, the
      // v2 sweep stays a write-only behaviour (arbitrated, watchout §6).
      for (const relative of await collectUnexpectedProjections(cwd, expected)) {
        results.push({ slug: relative, kind: 'orphan', status: 'unexpected', path: relative });
      }
    } else {
      for (const relative of await pruneStaleProjections(cwd, expected, { dryRun })) {
        results.push({ slug: relative, kind: 'orphan', status: 'removed', path: relative });
      }
    }
  }

  return results;
}
