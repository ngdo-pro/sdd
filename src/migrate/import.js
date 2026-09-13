import path from 'node:path';
import fsp from 'node:fs/promises';
import { listFeatures, listInitiatives, listSpecs } from '../core/artifact.js';
import { SPECS_DIRNAME, canonicalRoot, exists } from '../core/paths.js';
import { modelRelativePaths } from '../model/layout.js';
import { createMeta } from '../model/schema.js';
import { saveArtifact } from '../model/store.js';
import { extractSpecSlugs, parseArtifactDocument } from './parse.js';

// FROZEN v2 scanner, kept on minimal life-support until the feature 03
// rework (`spec migrate`): it still READS the legacy v2 markdown layout, but
// writes through the stateless v3 store, so specs need a fully derived
// `relations` (feature + initiative) and the skip-check resolves canonical
// paths. Do not grow this file.

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

/**
 * Imports existing `.specs/` markdown documents into the canonical model.
 * Existing model files are preserved unless `force` is set.
 * @returns {Promise<Array<{ slug: string, status: string }>>}
 */
export async function importMarkdown(cwd, { force = false } = {}) {
  const specs = await listSpecs(cwd);
  const initiatives = await listInitiatives(cwd);
  const features = await listFeatures(cwd);

  // Features reference their specs in the generated `## 6.` section — reuse
  // that to rebuild the spec → feature → initiative relations the model needs.
  const specToFeature = new Map();
  for (const feature of features) {
    const content = await readFileSafe(path.join(cwd, feature.path));
    for (const slug of extractSpecSlugs(content)) specToFeature.set(slug, feature.slug);
  }
  const featureToInitiative = new Map(
    features.map((feature) => [feature.slug, feature.meta?.initiative ?? null]),
  );

  const results = [];

  async function persist({ kind, slug, title, state, relations }, parsed) {
    const candidate = createMeta({
      kind,
      slug,
      title: parsed.title ?? title,
      state,
      relations: pruneNulls(relations ?? {}),
      fields: parsed.fields,
    });

    let relativeMeta = null;
    try {
      relativeMeta = modelRelativePaths(candidate).meta;
    } catch {
      relativeMeta = null; // un-derivable (incomplete relations): always import
    }

    if (!force && relativeMeta && (await exists(path.join(canonicalRoot(cwd), relativeMeta)))) {
      results.push({ slug, kind, status: 'skipped' });
      return;
    }

    await saveArtifact(cwd, candidate, parsed.body);
    results.push({ slug, kind, status: 'imported' });
  }

  const visionFile = path.join(cwd, SPECS_DIRNAME, 'vision.md');
  if (await exists(visionFile)) {
    const parsed = parseArtifactDocument(await fsp.readFile(visionFile, 'utf8'), 'vision');
    await persist({ kind: 'vision', slug: 'vision', title: 'Product Vision' }, parsed);
  }

  for (const initiative of initiatives) {
    const parsed = parseArtifactDocument(await readFileSafe(path.join(cwd, initiative.path)), 'initiative');
    await persist(
      { kind: 'initiative', slug: initiative.slug, title: initiative.slug, state: initiative.state },
      parsed,
    );
  }

  for (const feature of features) {
    const parsed = parseArtifactDocument(await readFileSafe(path.join(cwd, feature.path)), 'feature');
    await persist(
      {
        kind: 'feature',
        slug: feature.slug,
        title: feature.slug,
        state: feature.state,
        relations: { initiative: feature.meta?.initiative },
      },
      parsed,
    );
  }

  for (const spec of specs) {
    const parsed = parseArtifactDocument(await readFileSafe(path.join(cwd, spec.path)), 'spec');
    const featureSlug = specToFeature.get(spec.slug) ?? null;
    await persist(
      {
        kind: 'spec',
        slug: spec.slug,
        title: spec.slug,
        state: spec.state,
        relations: { feature: featureSlug, initiative: featureToInitiative.get(featureSlug) ?? null },
      },
      parsed,
    );
  }

  return results;
}
