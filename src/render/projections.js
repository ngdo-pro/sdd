import path from 'node:path';
import fsp from 'node:fs/promises';
import { ensureDir, exists, specsRoot, toPosix } from '../core/paths.js';
import { buildGraph } from '../model/graph.js';
import { renderDocument } from './markdown.js';

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
async function collectMarkdown(cwd, directory) {
  const root = specsRoot(cwd);
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

/** Removes empty directories bottom-up, stopping at the specs root. */
async function pruneEmptyDirectories(cwd, directory) {
  const root = specsRoot(cwd);
  const entries = await readdirSafe(directory);

  for (const entry of entries) {
    if (entry.isDirectory()) await pruneEmptyDirectories(cwd, path.join(directory, entry.name));
  }

  if (directory === root) return;
  if ((await readdirSafe(directory)).length === 0) await fsp.rm(directory, { recursive: true, force: true });
}

/**
 * Deletes framework-managed markdown that is no longer a projected artifact
 * (e.g. the previous location of a moved artefact). Knowledge and decision
 * documents are never touched.
 */
async function pruneStaleProjections(cwd, expected) {
  const root = specsRoot(cwd);
  const managed = ['specs', 'initiatives', 'vision.md'];
  const removed = [];

  const candidates = [];
  for (const relative of managed) {
    const absolute = path.join(root, relative);
    if (await exists(absolute)) {
      const stats = await fsp.stat(absolute);
      if (stats.isDirectory()) candidates.push(...await collectMarkdown(cwd, absolute));
      else if (relative.endsWith('.md')) candidates.push(relative);
    }
  }

  for (const relative of candidates) {
    if (expected.has(relative)) continue;
    await fsp.rm(path.join(root, relative), { force: true });
    removed.push(relative);
  }

  for (const directory of ['specs', 'initiatives']) {
    await pruneEmptyDirectories(cwd, path.join(root, directory));
  }

  return removed;
}

/**
 * Regenerates every markdown projection under `.specs/` from the model.
 * With `check`, nothing is written and drift is reported instead.
 * @returns {Promise<Array<{ slug: string, kind: string, status: string, path: string }>>}
 */
export async function renderProjections(cwd, artifacts, { check = false, prune = true } = {}) {
  const graph = buildGraph(artifacts);
  const root = specsRoot(cwd);
  const results = [];

  for (const artifact of artifacts) {
    const target = path.join(root, artifact.projection);
    const content = renderDocument(artifact, graph);
    const current = await readIfExists(target);

    if (current === content) {
      results.push({ slug: artifact.slug, kind: artifact.kind, status: 'unchanged', path: artifact.projection });
      continue;
    }
    if (check) {
      results.push({
        slug: artifact.slug,
        kind: artifact.kind,
        status: current === null ? 'missing' : 'stale',
        path: artifact.projection,
      });
      continue;
    }

    await ensureDir(path.dirname(target));
    await fsp.writeFile(target, content, 'utf8');
    results.push({
      slug: artifact.slug,
      kind: artifact.kind,
      status: current === null ? 'created' : 'updated',
      path: artifact.projection,
    });
  }

  if (!check && prune) {
    const expected = new Set(artifacts.map((artifact) => artifact.projection));
    const removed = await pruneStaleProjections(cwd, expected);
    for (const relative of removed) {
      results.push({ slug: relative, kind: 'orphan', status: 'removed', path: relative });
    }
  }

  return results;
}