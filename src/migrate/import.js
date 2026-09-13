import path from 'node:path';
import fsp from 'node:fs/promises';
import { UsageError } from '../core/errors.js';
import { canonicalRoot, exists } from '../core/paths.js';
import { modelRelativePaths } from '../model/layout.js';
import { createMeta } from '../model/schema.js';
import { loadModel, saveArtifact } from '../model/store.js';
import { extractParentInitiative, extractSpecSlugs, parseArtifactDocument } from './parse.js';
import { LEGACY_ROOT_DIRNAME, listFeatures, listInitiatives, listSpecs } from './v2-layout.js';
import { gateAndRetire } from './migrate.js';

const TOKEN_RE = /\.specs\//g;

async function readFileSafe(file) {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

function pruneNulls(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null && value !== undefined));
}

function countTokens(content) {
  return (content.match(TOKEN_RE) ?? []).length;
}

/** Literal root-token rewrite applied to every imported document (INV-3). */
function rewriteTokens(content) {
  return content.replace(TOKEN_RE, '.sdd/');
}

/** Rewrites the root token across an imported body and its field values. */
function rewriteParsed(parsed) {
  return {
    ...parsed,
    body: rewriteTokens(parsed.body ?? ''),
    fields: Object.fromEntries(
      Object.entries(parsed.fields ?? {}).map(([key, value]) => [
        key,
        typeof value === 'string' ? rewriteTokens(value) : value,
      ]),
    ),
  };
}

/**
 * A JSON model in the legacy root forbids `spec import`: the importer derives
 * its destinations from markdown document content, which would violate INV-2
 * on top of an existing model — `spec migrate` owns that conversion.
 */
async function assertNoJsonModel(cwd) {
  const canonicalIndex = path.join(cwd, LEGACY_ROOT_DIRNAME, 'canonical', 'index.json');
  const modelIndex = path.join(cwd, LEGACY_ROOT_DIRNAME, 'model', 'index.json');
  if ((await exists(canonicalIndex)) || (await exists(modelIndex))) {
    throw new UsageError(
      'A JSON model already exists (.specs/canonical/index.json or .specs/model/index.json) — '
      + 'run `spec migrate` instead: it reconstructs .sdd/ from the model metadata.',
    );
  }
}

/**
 * Imports legacy `.specs/` markdown documents into the canonical model under
 * `.sdd/`, then finishes through the shared strict gate: index + projections
 * regenerated, `validate`/`render --check` enforced, `.specs/` retired on
 * success (failure marker otherwise).
 *
 * Relations are derived from the CONTENT (`## 6.` → spec; Parent Initiative
 * block → feature), never from the disk position. Bodies and field values
 * are token-rewritten (`.specs/` → `.sdd/`). Refuses (exit 2) when a JSON
 * model exists — `spec migrate` owns that conversion.
 *
 * @returns {Promise<object>} `{ dryRun, results, rewrites?, removals?, artifacts? }`
 */
export async function importMarkdown(cwd, { force = false, dryRun = false } = {}) {
  await assertNoJsonModel(cwd);

  const specs = await listSpecs(cwd);
  const initiatives = await listInitiatives(cwd);
  const features = await listFeatures(cwd);

  // Features reference their specs in the generated `## 6.` section and
  // declare their initiative in the Parent Initiative block — both derived
  // from CONTENT (INV-2), never from the position on disk.
  const specToFeature = new Map();
  const featureToInitiative = new Map();
  for (const feature of features) {
    const body = await readFileSafe(path.join(cwd, feature.path));
    for (const slug of extractSpecSlugs(body)) specToFeature.set(slug, feature.slug);
    featureToInitiative.set(feature.slug, extractParentInitiative(body));
  }

  const documents = [];
  for (const entry of specs) {
    const parsed = parseArtifactDocument(await readFileSafe(path.join(cwd, entry.path)), 'spec');
    const featureSlug = specToFeature.get(entry.slug) ?? null;
    documents.push({
      kind: 'spec',
      slug: entry.slug,
      title: parsed.title ?? entry.slug,
      state: entry.state,
      relations: { feature: featureSlug, initiative: featureToInitiative.get(featureSlug) ?? null },
      parsed,
      source: entry.path,
    });
  }
  for (const entry of features) {
    const parsed = parseArtifactDocument(await readFileSafe(path.join(cwd, entry.path)), 'feature');
    documents.push({
      kind: 'feature',
      slug: entry.slug,
      title: parsed.title ?? entry.slug,
      state: entry.state,
      relations: { initiative: featureToInitiative.get(entry.slug) ?? entry.meta?.initiative ?? null },
      parsed,
      source: entry.path,
    });
  }
  for (const entry of initiatives) {
    const parsed = parseArtifactDocument(await readFileSafe(path.join(cwd, entry.path)), 'initiative');
    documents.push({
      kind: 'initiative',
      slug: entry.slug,
      title: parsed.title ?? entry.slug,
      state: entry.state,
      relations: {},
      parsed,
      source: entry.path,
    });
  }

  const visionFile = path.join(cwd, LEGACY_ROOT_DIRNAME, 'vision.md');
  if (await exists(visionFile)) {
    const parsed = parseArtifactDocument(await fsp.readFile(visionFile, 'utf8'), 'vision');
    documents.push({
      kind: 'vision',
      slug: 'vision',
      title: parsed.title ?? 'Product Vision',
      state: null,
      relations: {},
      parsed,
      source: '.specs/vision.md',
    });
  }

  // INV-2: every imported artifact must land on a derivable canonical path.
  const unresolved = [];
  for (const document of documents) {
    try {
      modelRelativePaths(createMeta({
        kind: document.kind,
        slug: document.slug,
        title: document.title,
        state: document.state,
        relations: pruneNulls(document.relations ?? {}),
      }));
    } catch {
      unresolved.push(document);
    }
  }
  if (unresolved.length > 0) {
    const labels = unresolved.map((entry) => `${entry.kind} ${entry.slug}`).join(', ');
    throw new UsageError(
      `${unresolved.length} document(s) have no derivable parent (${labels}) — `
      + 'restore or link the missing feature/initiative documents before importing.',
    );
  }

  // Token rewrites (INV-3): bodies and field values, every rewrite listed.
// Token rewrites (INV-3): bodies, string field values — counted BEFORE the
// rewrite (the rewritten content no longer carries the legacy token).
const rewrites = [];
for (const document of documents) {
  const parsed = document.parsed ?? {};
  const occurrences = countTokens(parsed.body ?? '')
    + Object.values(parsed.fields ?? {})
      .reduce((sum, value) => sum + (typeof value === 'string' ? countTokens(value) : 0), 0);
  document.rewritten = rewriteParsed(parsed);
  if (occurrences > 0) rewrites.push({ file: document.source, occurrences });
}

  if (dryRun) {
    return {
      dryRun: true,
      results: documents.map((document) => ({ kind: document.kind, slug: document.slug, status: 'planned' })),
      rewrites,
      removals: [`${LEGACY_ROOT_DIRNAME}/ (whole tree, after strict gate)`],
    };
  }

  if (documents.length === 0) {
    // Nothing to convert: never run the finish (gate + source retirement)
    // over an empty conversion — the CLI reports "nothing to import".
    return { dryRun: false, results: [], artifacts: (await loadModel(cwd)).length, rewrites: [] };
  }

  const results = [];
  for (const document of documents) {
    const candidate = createMeta({
      kind: document.kind,
      slug: document.slug,
      title: document.title,
      state: document.state,
      relations: pruneNulls(document.relations ?? {}),
      fields: document.rewritten.fields ?? {},
    });

    const relativeMeta = modelRelativePaths(candidate).meta;
    if (!force && (await exists(path.join(canonicalRoot(cwd), relativeMeta)))) {
      results.push({ kind: document.kind, slug: document.slug, status: 'skipped' });
      continue;
    }

    await saveArtifact(cwd, candidate, document.rewritten.body);
    results.push({ kind: document.kind, slug: document.slug, status: 'imported' });
  }

  // Shared finish (INV-4): index + projections + strict gate + source removal.
  const artifacts = await loadModel(cwd);
  await gateAndRetire(cwd, artifacts);

  return { dryRun: false, results, artifacts: artifacts.length, rewrites };
}