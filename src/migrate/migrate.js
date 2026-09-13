import path from 'node:path';
import { existsSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { MigrationError } from '../core/errors.js';
import { convertConfig, writeConfig } from '../core/config.js';
import {
  SPECS_DIRNAME,
  canonicalRoot,
  ensureDir,
  exists,
  isDir,
  removeDir,
  specsRoot,
} from '../core/paths.js';
import { modelRelativePaths, projectionRelativePath } from '../model/layout.js';
import { computeFindings } from '../model/audit.js';
import { renderProjections } from '../render/projections.js';
import { saveArtifact } from '../model/store.js';
import { writeIndex } from '../model/index.js';
import { normalizeMeta } from '../model/schema.js';
import { extractParentInitiative, extractSpecSlugs } from './parse.js';
import { LEGACY_ROOT_DIRNAME, MODEL_DIRNAME, STATE_BY_DIR, STATE_DIRS } from './v2-layout.js';

export { LEGACY_ROOT_DIRNAME };

const LEGACY_CANONICAL = `${LEGACY_ROOT_DIRNAME}/canonical`;
const LEGACY_MODEL = `${LEGACY_ROOT_DIRNAME}/${MODEL_DIRNAME}`;
const FAILURE_MARKER = '.migration-failed.json';
const DRIFT_STATUSES = new Set(['stale', 'missing', 'unexpected']);

const TOKEN_RE = /\.specs\//g;
/** Bare `.specs` mentions WITHOUT the trailing slash — listed, never rewritten. */
const BARE_MENTION_RE = /\.specs(?![\w/])/g;
/** Lifecycle-directory names that may encode a state in legacy paths. */
const LIFECYCLE_DIR_NAMES = new Set(Object.values(STATE_DIRS));

async function readdirSafe(directory) {
  try {
    return await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function readBodyOrEmpty(file) {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

async function readJsonOrNull(file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function countTokens(content) {
  return (content.match(TOKEN_RE) ?? []).length;
}

function countBareMentions(content) {
  return (content.match(BARE_MENTION_RE) ?? []).length;
}

/** Mechanical, literal token rewrite: `.specs/` → `.sdd/` (INV-3). Idempotent. */
function rewriteTokens(content) {
  return content.replace(TOKEN_RE, '.sdd/');
}

function tokenSample(content) {
  const match = content.match(/.{0,30}\.specs\/.{0,30}/);
  if (!match) return '.specs/… → .sdd/…';
  return `${match[0]} → ${match[0].replace('.specs/', '.sdd/')}`;
}

/**
 * Rewrites the root token across a body and every string field value.
 * @returns {{ body: string, fields: object, occurrences: number }}
 */
function rewriteArtifactContent(meta, body) {
  let occurrences = countTokens(body);
  const rewrittenBody = rewriteTokens(body);
  const fields = {};
  for (const [key, value] of Object.entries(meta.fields ?? {})) {
    if (typeof value === 'string' && countTokens(value) > 0) {
      occurrences += countTokens(value);
      fields[key] = rewriteTokens(value);
    } else {
      fields[key] = value;
    }
  }
  return { body: rewrittenBody, fields, occurrences };
}

/** Recursively lists every `*.json` file under `directory` (absolute paths), excluding the index manifest. */
async function walkJsonFiles(directory) {
  const found = [];
  async function walk(current) {
    for (const entry of await readdirSafe(current)) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'index.json') found.push(absolute);
    }
  }
  if (await isDir(directory)) await walk(directory);
  return found;
}

/** Recursively lists every file under `directory` (absolute paths). */
async function walkFiles(directory) {
  const found = [];
  async function walk(current) {
    for (const entry of await readdirSafe(current)) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) found.push(absolute);
    }
  }
  if (await isDir(directory)) await walk(directory);
  return found;
}

/**
 * Detects the workspace layout deterministically (arbitrage 2): only
 * `config.json` / `index.json` markers are read — never a disk-shape
 * heuristic. Evaluation order: coexistence → migrated → v3-canonical →
 * v2-model → unsupported.
 * @returns {Promise<{ layout: string, sourceRoot: string | null, detail: string }>}
 */
export async function detectLayout(cwd) {
  const legacyRoot = path.join(cwd, LEGACY_ROOT_DIRNAME);
  const sddRoot = path.join(cwd, SPECS_DIRNAME);
  const legacyPresent = await isDir(legacyRoot);
  const sddPresent = await isDir(sddRoot);
  const sddCanonicalPresent = await isDir(path.join(sddRoot, 'canonical'));

  if (!legacyPresent) {
    if (sddCanonicalPresent) {
      return { layout: 'migrated', sourceRoot: null, detail: 'workspace already lives under .sdd/' };
    }
    if (sddPresent) {
      return {
        layout: 'unsupported',
        sourceRoot: null,
        detail: 'a partial .sdd/ exists without canonical/ and without a legacy source — restore the workspace from git.',
      };
    }
    return {
      layout: 'unsupported',
      sourceRoot: null,
      detail: 'no spec workspace found — run `sdd init` to bootstrap one.',
    };
  }

  const legacy = await classifyLegacyLayout(cwd);
  if (sddPresent) {
    if (legacy.layout === 'unsupported') return legacy;
    return {
      layout: 'coexistence',
      sourceRoot: legacy.sourceRoot,
      detail: '.specs/ and .sdd/ coexist (pending or failed migration) — rerun `sdd migrate`: it wipes .sdd/ and rebuilds it from the source.',
    };
  }
  return legacy;
}

/** Classifies a legacy `.specs/` root from its `index.json` markers only. */
async function classifyLegacyLayout(cwd) {
  const canonicalIndexPath = path.join(cwd, LEGACY_CANONICAL, 'index.json');
  const canonicalIndex = await readJsonOrNull(canonicalIndexPath);
  if (canonicalIndex) {
    if (canonicalIndex.version === 3) {
      return {
        layout: 'v3-canonical',
        sourceRoot: LEGACY_CANONICAL,
        detail: `canonical v3 model under ${LEGACY_CANONICAL} — direct metadata reconstruction`,
      };
    }
    return {
      layout: 'unsupported',
      sourceRoot: null,
      detail: `${LEGACY_CANONICAL}/index.json has unexpected version ${canonicalIndex.version} (expected 3) — restore it from git; refusing to guess the layout.`,
    };
  }
  if (await exists(canonicalIndexPath)) {
    return {
      layout: 'unsupported',
      sourceRoot: null,
      detail: `${LEGACY_CANONICAL}/index.json is unreadable — restore it from git; refusing to guess the layout.`,
    };
  }

  const modelIndexPath = path.join(cwd, LEGACY_MODEL, 'index.json');
  const modelIndex = await readJsonOrNull(modelIndexPath);
  if (modelIndex) {
    if (Number(modelIndex.version ?? 0) <= 2) {
      return {
        layout: 'v2-model',
        sourceRoot: LEGACY_MODEL,
        detail: `legacy v2 model under ${LEGACY_MODEL} — relations derived from content`,
      };
    }
    return {
      layout: 'unsupported',
      sourceRoot: null,
      detail: `${LEGACY_MODEL}/index.json has unexpected version ${modelIndex.version} — restore it from git; refusing to guess the layout.`,
    };
  }
  if (await exists(modelIndexPath)) {
    return {
      layout: 'unsupported',
      sourceRoot: null,
      detail: `${LEGACY_MODEL}/index.json is unreadable — restore it from git; refusing to guess the layout.`,
    };
  }

  const hasMarkdown = (await exists(path.join(cwd, LEGACY_ROOT_DIRNAME, 'specs')))
    || (await exists(path.join(cwd, LEGACY_ROOT_DIRNAME, 'initiatives')))
    || (await exists(path.join(cwd, LEGACY_ROOT_DIRNAME, 'vision.md')));
  return {
    layout: 'unsupported',
    sourceRoot: null,
    detail: hasMarkdown
      ? 'markdown-only workspace without an index.json — run `sdd import` to convert the markdown, or restore index.json from git.'
      : 'no model index and no markdown found — run `sdd init` to bootstrap a workspace, or restore the workspace from git.',
  };
}

/**
 * INV-5 coexistence guard: refuses every mutating CLI path while `.specs/`
 * and `.sdd/` coexist. Reads (`status`, `list`, `validate`, `render
 * --check`/`--dry-run`, `model` in read mode) are exempt and operate on
 * `.sdd/` exclusively. `sdd migrate` never calls it — it is the recovery
 * tool; `sdd import` goes through this guard in its command.
 */
export function assertNoCoexistence(cwd) {
  const legacyPresent = existsSync(path.join(cwd, LEGACY_ROOT_DIRNAME));
  const sddPresent = existsSync(path.join(cwd, SPECS_DIRNAME));
  if (legacyPresent && sddPresent) {
    throw new MigrationError(
      '.specs/ and .sdd/ coexist — the migration is pending or failed and every mutation is locked. '
      + 'Run `sdd migrate`: it rebuilds .sdd/ from scratch and retires .specs/.',
    );
  }
}

/** Loads one source artifact: normalized metadata + sibling body. */
async function loadSourceArtifact(cwd, jsonPath, rootDir) {
  const workspaceRelative = toPosix(path.relative(cwd, jsonPath));
  let raw;
  try {
    raw = JSON.parse(await fsp.readFile(jsonPath, 'utf8'));
  } catch (error) {
    throw new MigrationError(`unreadable artifact metadata "${workspaceRelative}" (${error.message}) — restore it from git.`);
  }
  if (!raw || typeof raw !== 'object' || typeof raw.kind !== 'string') {
    throw new MigrationError(`invalid artifact metadata "${workspaceRelative}" (missing kind) — restore it from git.`);
  }
  const meta = normalizeMeta(raw, raw.slug ?? null);
  const bodyPath = jsonPath.replace(/\.json$/, '.md');
  const body = await readBodyOrEmpty(bodyPath);
  return {
    meta,
    body,
    sourceMeta: workspaceRelative,
    sourceBody: toPosix(path.relative(cwd, bodyPath)),
    rootDir,
  };
}

/**
 * Loads every source artifact of a legacy layout, deriving the relations the
 * metadata lacks from document CONTENT (INV-2 — never from disk position).
 */
async function loadSourceArtifacts(cwd, layout) {
  const rootDir = layout === 'v3-canonical' ? LEGACY_CANONICAL : LEGACY_MODEL;
  const jsonFiles = await walkJsonFiles(path.join(cwd, rootDir));
  const records = [];
  for (const jsonPath of jsonFiles) {
    records.push(await loadSourceArtifact(cwd, jsonPath, rootDir));
  }

  if (layout === 'v2-model') {
    await deriveV2Relations(cwd, records);
  }
  return records;
}

/**
 * v2 relations completion: spec → feature via the generated `## 6.` section
 * of feature bodies, feature → initiative via the Parent Initiative block.
 * Metadata relations take precedence; content only fills the gaps.
 */
async function deriveV2Relations(cwd, records) {
  const features = records.filter((record) => record.meta.kind === 'feature');
  const specToFeature = new Map();
  const featureToInitiative = new Map();

  for (const feature of features) {
    const body = await readBodyOrEmpty(path.join(cwd, feature.sourceBody));
    for (const slug of extractSpecSlugs(body)) specToFeature.set(slug, feature.meta.slug);
    featureToInitiative.set(feature.meta.slug, extractParentInitiative(body));
  }

  for (const record of records) {
    if (record.meta.kind === 'feature') {
      record.meta.relations = {
        ...record.meta.relations,
        initiative: record.meta.relations?.initiative ?? featureToInitiative.get(record.meta.slug) ?? null,
      };
    }
    if (record.meta.kind === 'spec') {
      const derivedFeature = specToFeature.get(record.meta.slug);
      const featureSlug = record.meta.relations?.feature ?? derivedFeature ?? null;
      record.meta.relations = {
        ...record.meta.relations,
        feature: featureSlug,
        initiative: record.meta.relations?.initiative ?? featureToInitiative.get(featureSlug) ?? null,
      };
    }
  }
}

/** Last lifecycle-directory segment of a workspace-relative path, if any. */
function encodedStateSegment(workspaceRelative) {
  const segments = workspaceRelative.split('/');
  for (let index = segments.length - 2; index >= 1; index -= 1) {
    if (LIFECYCLE_DIR_NAMES.has(segments[index])) return segments[index];
  }
  return null;
}

async function legacyLayoutOf(cwd) {
  const detection = await detectLayout(cwd);
  return detection.sourceRoot === LEGACY_CANONICAL ? 'v3-canonical' : 'v2-model';
}

/** Legacy root entries that are never reconstructed (absorbed by the removal). */
async function legacyResidues(cwd, keep) {
  const entries = [];
  for (const entry of await readdirSafe(path.join(cwd, LEGACY_ROOT_DIRNAME))) {
    if (keep.includes(entry.name) || entry.name.startsWith('.')) continue;
    entries.push(entry.name);
  }
  return entries;
}

/**
 * Computes the migration plan: divergences (disk versus metadata), token
 * rewrites, config warnings and removals — everything is calculated, nothing
 * is written (INV-6).
 */
export async function planMigration(cwd) {
  const detection = await detectLayout(cwd);
  const plan = {
    layout: detection.layout,
    sourceRoot: detection.sourceRoot,
    detail: detection.detail,
    artifacts: [],
    divergences: [],
    rewrites: [],
    unrewritten: [],
    configWarnings: [],
    removals: [],
  };

  if (detection.layout !== 'v3-canonical' && detection.layout !== 'v2-model' && detection.layout !== 'coexistence') {
    return plan;
  }

  const layout = detection.layout === 'coexistence' ? await legacyLayoutOf(cwd) : detection.layout;
  const records = await loadSourceArtifacts(cwd, layout);
  plan.artifacts = records.map((record) => ({
    kind: record.meta.kind,
    slug: record.meta.slug,
    id: record.meta.id,
    state: record.meta.state,
    relations: record.meta.relations,
  }));

  // Divergences: state-mismatch (encoded lifecycle dir ≠ metadata state),
  // position-mismatch (source path ≠ derived destination), unresolved
  // relations (blocking). The destination ALWAYS follows the metadata.
  const slugs = new Set(plan.artifacts.map((artifact) => artifact.slug));
  for (const record of records) {
    let derived = null;
    try {
      derived = modelRelativePaths(record.meta);
    } catch {
      plan.divergences.push({
        kind: record.meta.kind,
        slug: record.meta.slug,
        type: 'unresolved-relations',
        expected: 'derivable canonical path',
        actual: 'incomplete relations (no parent feature/initiative derived)',
      });
      continue;
    }

    const stateDirName = encodedStateSegment(record.sourceMeta);
    if (stateDirName && STATE_BY_DIR[stateDirName] && STATE_BY_DIR[stateDirName] !== record.meta.state) {
      plan.divergences.push({
        kind: record.meta.kind,
        slug: record.meta.slug,
        type: 'state-mismatch',
        expected: record.meta.state,
        actual: stateDirName,
      });
    }

    if (record.rootDir === LEGACY_CANONICAL && record.sourceMeta !== `${LEGACY_CANONICAL}/${derived.meta}`) {
      plan.divergences.push({
        kind: record.meta.kind,
        slug: record.meta.slug,
        type: 'position-mismatch',
        expected: `.sdd/canonical/${derived.meta}`,
        actual: record.sourceMeta,
      });
    }

    for (const [relation, target] of Object.entries(record.meta.relations ?? {})) {
      if (target && !slugs.has(target)) {
        plan.divergences.push({
          kind: record.meta.kind,
          slug: record.meta.slug,
          type: 'unresolved-relations',
          expected: `existing ${relation}`,
          actual: `dangling ${relation} → "${target}"`,
        });
      }
    }
  }

  // Token rewrites (INV-3): bodies, string field values and knowledge markdown.
  for (const record of records) {
    const bodyTokens = countTokens(record.body);
    if (bodyTokens > 0) {
      plan.rewrites.push({ file: record.sourceBody, occurrences: bodyTokens, sample: tokenSample(record.body) });
    }
    const fieldValues = Object.values(record.meta.fields ?? {})
      .filter((value) => typeof value === 'string' && countTokens(value) > 0);
    if (fieldValues.length > 0) {
      plan.rewrites.push({
        file: record.sourceMeta,
        occurrences: fieldValues.reduce((sum, value) => sum + countTokens(value), 0),
        sample: tokenSample(fieldValues[0]),
      });
    }
    const bareBody = countBareMentions(record.body);
    if (bareBody > 0) plan.unrewritten.push({ file: record.sourceBody, occurrences: bareBody });
  }

  for (const file of await walkFiles(path.join(cwd, LEGACY_ROOT_DIRNAME, 'knowledge'))) {
    if (!file.endsWith('.md')) continue;
    const relative = toPosix(path.relative(cwd, file));
    const content = await fsp.readFile(file, 'utf8');
    const occurrences = countTokens(content);
    if (occurrences > 0) plan.rewrites.push({ file: relative, occurrences, sample: tokenSample(content) });
    const bare = countBareMentions(content);
    if (bare > 0) plan.unrewritten.push({ file: relative, occurrences: bare });
  }

  // Config conversion preview (INV-3, arbitrage 4).
  const rawConfig = await readJsonOrNull(path.join(cwd, LEGACY_ROOT_DIRNAME, 'config.json'));
  if (rawConfig) {
    const { warnings } = convertConfig(rawConfig);
    plan.configWarnings = warnings;
    if (rawConfig.version !== 3) {
      plan.divergences.push({
        kind: 'workspace',
        slug: 'config.json',
        type: 'legacy-residue',
        expected: 'version 3',
        actual: `version ${rawConfig.version}`,
      });
    }
  }

  const keep = layout === 'v3-canonical'
    ? ['canonical', 'config.json', 'knowledge']
    : [MODEL_DIRNAME, 'config.json', 'knowledge'];
  for (const name of await legacyResidues(cwd, keep)) {
    plan.divergences.push({
      kind: 'workspace',
      slug: name,
      type: 'legacy-residue',
      expected: null,
      actual: 'legacy entry — never reconstructed, absorbed by the source removal',
    });
  }

  plan.removals.push(`${LEGACY_ROOT_DIRNAME}/ (whole tree, after strict gate)`);
  if (detection.layout === 'coexistence') {
    plan.removals.unshift('.sdd/ (partial or marked workspace — wiped before rebuild, INV-1)');
  }

  return plan;
}

/**
 * Writes the strict-gate failure marker (INV-4). Dotfiles are tolerated by
 * the `root-layout` rule.
 */
async function writeFailureMarker(cwd, stage, message) {
  await ensureDir(specsRoot(cwd));
  const marker = { failedAt: new Date().toISOString(), stage, message };
  await fsp.writeFile(path.join(specsRoot(cwd), FAILURE_MARKER), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
}

/**
 * Strict gate (INV-4) + source retirement: `validate` must produce 0 finding
 * and `render --check` 0 drift on the migrated workspace — the same engines
 * as the commands, in-process (`computeFindings` + `renderProjections({check})`,
 * never the CLI commands which mutate `process.exitCode`). With
 * `projections.markdown === false` the render leg is vacuous (the index is
 * still regenerated), mirroring `sdd render --check`'s behaviour. Otherwise
 * the marker is written, the source is kept and a MigrationError (exit 1) is
 * raised. Shared by `sdd migrate` and the re-owned `sdd import` finish.
 */
export async function gateAndRetire(cwd, artifacts, { markdown = true } = {}) {
  const findings = await computeFindings(cwd);
  if (findings.length > 0) {
    await writeFailureMarker(cwd, 'validate', `${findings.length} finding(s)`);
    throw new MigrationError(
      `Strict gate failed (validate): ${findings.length} finding(s) — source kept, see .sdd/${FAILURE_MARKER}.`,
    );
  }

  await writeIndex(cwd, artifacts);
  if (markdown) {
    await renderProjections(cwd, artifacts);
    const drift = (await renderProjections(cwd, artifacts, { check: true }))
      .filter((entry) => DRIFT_STATUSES.has(entry.status));
    if (drift.length > 0) {
      await writeFailureMarker(cwd, 'render-check', `${drift.length} projection(s) out of date`);
      throw new MigrationError(
        `Strict gate failed (render --check): ${drift.length} projection(s) out of date — source kept, see .sdd/${FAILURE_MARKER}.`,
      );
    }
  }

  await removeDir(path.join(cwd, LEGACY_ROOT_DIRNAME));
}

function hydrateArtifact(meta, body) {
  const paths = modelRelativePaths(meta);
  let projection = null;
  try {
    projection = projectionRelativePath(meta);
  } catch {
    projection = null; // un-derivable — already blocked as unresolved-relations
  }
  return {
    ...meta,
    body,
    model: { directory: paths.dir, meta: paths.meta, body: paths.body },
    projection,
  };
}

/**
 * Copies `knowledge/**` from the legacy root into `.sdd/knowledge/`,
 * rewriting the root token in every markdown file (INV-3).
 */
async function copyKnowledge(cwd) {
  const source = path.join(cwd, LEGACY_ROOT_DIRNAME, 'knowledge');
  const target = path.join(cwd, SPECS_DIRNAME, 'knowledge');
  for (const file of await walkFiles(source)) {
    const relative = toPosix(path.relative(source, file));
    const destination = path.join(target, relative);
    await ensureDir(path.dirname(destination));
    const content = await fsp.readFile(file, 'utf8');
    const rewritten = file.endsWith('.md') ? rewriteTokens(content) : content;
    await fsp.writeFile(destination, rewritten, 'utf8');
  }
}

/**
 * Rebuilds `.sdd/` from scratch and retires the legacy root (INV-1). The
 * migration is a RECONSTRUCTION: every destination is derived from the source
 * metadata (`state`, `relations`) — the disk position is never a criterion.
 * A dry-run never reaches this function: the CLI prints `planMigration`
 * instead (INV-6).
 * @returns {Promise<{ status: string, layout: string, removedRoot: string | null,
 *   artifacts: number, divergences: Array, rewrites: Array, configWarnings: string[] }>}
 */
export async function runMigration(cwd) {
  const plan = await planMigration(cwd);

  if (plan.layout === 'migrated') {
    return {
      status: 'noop',
      layout: plan.layout,
      removedRoot: null,
      artifacts: 0,
      divergences: [],
      rewrites: [],
      configWarnings: [],
    };
  }
  if (plan.layout === 'unsupported') {
    throw new MigrationError(plan.detail);
  }

  const blocking = plan.divergences.filter((divergence) => divergence.type === 'unresolved-relations');
  if (blocking.length > 0) {
    throw new MigrationError(
      `${blocking.length} unresolved relation(s) — the graph would fail the strict gate. `
      + 'Fix the model first (preview the plan with `sdd migrate --dry-run`).',
    );
  }

  // INV-1: an existing .sdd/ (partial, marked, obsolete) is wiped — never merged.
  if (await isDir(specsRoot(cwd))) await removeDir(specsRoot(cwd));
  await ensureDir(canonicalRoot(cwd));

  // Config v3 (arbitrage 4): obsolete options dropped with warnings.
  const rawConfig = await readJsonOrNull(path.join(cwd, LEGACY_ROOT_DIRNAME, 'config.json'));
  const { config } = convertConfig(rawConfig ?? {});
  await writeConfig(cwd, config);

  // Reconstruction from metadata — bodies and field values are token-rewritten.
  const records = await loadSourceArtifacts(cwd, await legacyLayoutOf(cwd));
  const artifacts = [];
  for (const record of records) {
    const rewritten = rewriteArtifactContent(record.meta, record.body);
    const meta = { ...record.meta, fields: rewritten.fields };
    await saveArtifact(cwd, meta, rewritten.body);
    artifacts.push(hydrateArtifact(meta, rewritten.body));
  }

  // Authored knowledge: copied, markdown token-rewritten (INV-3).
  await copyKnowledge(cwd);

  // Strict gate, then retire the legacy root (INV-4). On failure the marker
  // is written and .specs/ is kept — git is the safety net.
  await gateAndRetire(cwd, artifacts, { markdown: config.projections?.markdown !== false });

  return {
    status: 'migrated',
    layout: plan.layout,
    removedRoot: `${LEGACY_ROOT_DIRNAME}/`,
    artifacts: artifacts.length,
    divergences: plan.divergences,
    rewrites: plan.rewrites,
    configWarnings: plan.configWarnings,
  };
}