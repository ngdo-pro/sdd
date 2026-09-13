import path from 'node:path';
import fsp from 'node:fs/promises';

/**
 * Root directory holding every specification artifact — canonical model,
 * authored knowledge and generated projections.
 */
export const SPECS_DIRNAME = '.sdd';

/** Canonical model store: stateless tree, lifecycle lives in metadata only. */
export const CANONICAL_DIRNAME = 'canonical';

/** Authored knowledge: decisions ({architecture,product}) and domains. */
export const KNOWLEDGE_DIRNAME = 'knowledge';

/**
 * Generated namespace: every markdown projection the CLI renders from the
 * model lives here — authored (`canonical/`, `knowledge/`) and generated
 * become visually disjoint trees.
 */
export const GENERATED_DIRNAME = 'generated';

/** Generated manifest mapping artifact ids to their model files. */
export const INDEX_FILENAME = 'index.json';

/** Project-level framework configuration file (relative to `.sdd/`). */
export const CONFIG_FILENAME = 'config.json';

/**
 * Static consumption site — a pure render artifact (never a source of truth,
 * never committed, never read by the CLI). It is born with the first
 * `spec render --site`: tolerated, never required, never pre-allocated.
 */
export const SITE_DIRNAME = 'site';

/** Canonical lifecycle states, in order. */
export const STATES = ['planned', 'active', 'archived'];

/** Every artifact kind known to the framework. */
export const KINDS = ['vision', 'initiative', 'feature', 'spec'];

/** Kinds that own a lifecycle state (and therefore support transitions). */
export const STATEFUL_KINDS = ['initiative', 'feature', 'spec'];

const SPEC_SLUG_RE = /^(\d{3,4})-(.+)$/;

export function specsRoot(cwd) {
  return path.join(cwd, SPECS_DIRNAME);
}

export function canonicalRoot(cwd) {
  return path.join(cwd, SPECS_DIRNAME, CANONICAL_DIRNAME);
}

export function knowledgeRoot(cwd) {
  return path.join(cwd, SPECS_DIRNAME, KNOWLEDGE_DIRNAME);
}

export function generatedRoot(cwd) {
  return path.join(cwd, SPECS_DIRNAME, GENERATED_DIRNAME);
}

/** Root of the static consumption site: `.sdd/site/` (written by `render --site` only). */
export function siteRoot(cwd) {
  return path.join(cwd, SPECS_DIRNAME, SITE_DIRNAME);
}

/**
 * Exhaustive `.sdd/` root (INV-1): any other entry is a `root-layout`
 * violation. `generated/` and `site/` are allowed but never required (a
 * workspace with `projections.markdown: false` or an empty model stays
 * valid; the site is born with the first `render --site` — tolerated,
 * never required, never pre-allocated).
 */
export const ALLOWED_ROOT_ENTRIES = [
  'config.json',
  CANONICAL_DIRNAME,
  GENERATED_DIRNAME,
  KNOWLEDGE_DIRNAME,
  SITE_DIRNAME,
];

export function indexFilePath(cwd) {
  return path.join(canonicalRoot(cwd), INDEX_FILENAME);
}

export function configPath(cwd) {
  return path.join(specsRoot(cwd), CONFIG_FILENAME);
}

/**
 * Directory layout bootstrapped by `spec init`: nothing but the root and the
 * canonical store. Every other directory is created on demand (INV-3).
 */
export function standardLayout(cwd) {
  return [specsRoot(cwd), canonicalRoot(cwd)];
}

/**
 * Splits a spec slug into its id (3 or 4 digits — ids beyond 999 are allowed)
 * and remainder.
 * @returns {{ id: string, suffix: string } | null}
 */
export function parseSpecSlug(slug) {
  const match = String(slug ?? '').match(SPEC_SLUG_RE);
  return match ? { id: match[1], suffix: match[2] } : null;
}

/** Normalize a path to POSIX separators for portable artifacts. */
export function toPosix(value) {
  return value.split(path.sep).join('/');
}

export function relativeTo(cwd, absolute) {
  return toPosix(path.relative(cwd, absolute));
}

export async function exists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function isDir(target) {
  try {
    return (await fsp.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

export async function ensureDir(target) {
  await fsp.mkdir(target, { recursive: true });
}

export async function removeDir(target) {
  await fsp.rm(target, { recursive: true, force: true });
}

