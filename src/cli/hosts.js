import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { UsageError } from '../core/errors.js';
import { ensureDir, exists, isDir, specsRoot } from '../core/paths.js';

/**
 * Agent-host registry backing `sdd install` (spec 012).
 *
 * An agent host is a directory convention an agentic tool reads in the target
 * repo: `.opencode/` (OpenCode native skill discovery), `.claude/` (Claude
 * Code) and `.agents/` (generic agents). The registry is extensible: add an
 * entry to `HOSTS` with `detect` and `plan` and it is immediately available
 * to `--host` validation, detection and wiring.
 *
 * Wiring is done by **copy, never symlink** (clean break of spec 008): the
 * skill directories under `skills/` and the agent files under `agents/` are
 * copied to the native host locations, so a target repo carries zero machine
 * paths and `opencode.json` is never written (INV-1). Every applied entry is
 * journaled with the copying package's version so `--undo` removes exactly
 * what install posed (INV-3) and a re-install can tell "already at this
 * version" (no-op) from "package upgraded" (refresh). Foreign pre-existing
 * targets are never overwritten (INV-2).
 */

/** Hidden journal file at `.sdd/.install-journal.json` — tolerated by `root-layout` (cf. `.migration-failed.json`). */
export const JOURNAL_FILENAME = '.install-journal.json';

export function journalPath(cwd) {
  return path.join(specsRoot(cwd), JOURNAL_FILENAME);
}

/**
 * Root of the package currently executing (`sdd install` itself) — resolved
 * from `import.meta.url`, never from `process.cwd()`: the CLI may run from an
 * npx cache, an npm global install or a clone, and the wiring must copy the
 * skills/agents shipped by that exact package (INV-1).
 */
export function resolvePkgRoot() {
  return path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
}

/**
 * Version of the executing package, read from its package.json — the same
 * single source `update-check` reads. It stamps every plan and journal entry
 * so re-installs can compare the copied version against the current one.
 */
export function readPkgVersion(pkgRoot = resolvePkgRoot()) {
  return JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')).version;
}

/** Copy entries for every shipped skill directory (`skills/` → `sdd-<name>`). */
function skillEntries(baseDir, pkgRoot, pkgVersion) {
  return readdirSync(path.join(pkgRoot, 'skills'), { withFileTypes: true })
    .filter((item) => item.isDirectory() && item.name.startsWith('sdd-'))
    .map((item) => ({
      kind: 'copy',
      target: `${baseDir}/skills/${item.name}`,
      source: path.join(pkgRoot, 'skills', item.name),
      version: pkgVersion,
    }));
}

/** Copy entries for every shipped agent file (`agents/*.md`). */
function agentEntries(baseDir, pkgRoot, pkgVersion) {
  return readdirSync(path.join(pkgRoot, 'agents'), { withFileTypes: true })
    .filter((item) => item.isFile() && item.name.endsWith('.md'))
    .map((item) => ({
      kind: 'copy',
      target: `${baseDir}/agents/${item.name}`,
      source: path.join(pkgRoot, 'agents', item.name),
      version: pkgVersion,
    }));
}

/** Native wiring plan for a `.claude/`- or `.agents/`-style host directory. */
function hostEntries(baseDir) {
  return (pkgRoot, pkgVersion) => [
    ...skillEntries(baseDir, pkgRoot, pkgVersion),
    ...agentEntries(baseDir, pkgRoot, pkgVersion),
  ];
}

/** Host registry — order defines detection order and `--host` documentation. */
export const HOSTS = {
  opencode: {
    id: 'opencode',
    evidence: 'opencode.json',
    detect: (cwd) => exists(path.join(cwd, 'opencode.json')),
    plan: (pkgRoot, pkgVersion) => skillEntries('.opencode', pkgRoot, pkgVersion),
  },
  claude: {
    id: 'claude',
    evidence: '.claude/',
    detect: (cwd) => isDir(path.join(cwd, '.claude')),
    plan: hostEntries('.claude'),
  },
  agents: {
    id: 'agents',
    evidence: '.agents/',
    detect: (cwd) => isDir(path.join(cwd, '.agents')),
    plan: hostEntries('.agents'),
  },
};

/** Detects the agent hosts present in the target repo → `[{ id, evidence }]`. */
export async function detectHosts(cwd) {
  const detected = [];
  for (const host of Object.values(HOSTS)) {
    if (await host.detect(cwd)) detected.push({ id: host.id, evidence: host.evidence });
  }
  return detected;
}

/**
 * Builds the wiring plan for one host: one `copy` entry per native target —
 * `[{ kind: 'copy', target, source, version }]`. `target` is repo-relative
 * (where the copy lands in the target repo); `source` is the absolute path
 * inside the executing package it is copied from; `version` is the copying
 * package's version (the refresh stamp). Nothing outside `skills/` and
 * `agents/` is ever wired — `templates/` are read from the package at
 * runtime (§6).
 */
export function installPlan(cwd, host, { pkgRoot = resolvePkgRoot(), pkgVersion = readPkgVersion(pkgRoot) } = {}) {
  const entry = HOSTS[host];
  if (!entry) {
    throw new UsageError(`Unknown host "${host}". Valid hosts: ${Object.keys(HOSTS).join(', ')}.`);
  }
  return entry.plan(pkgRoot, pkgVersion);
}

function lstatSafe(target) {
  return fsp.lstat(target).catch(() => null);
}

function realpathSafe(target) {
  return fsp.realpath(target).catch(() => null);
}

/** True when `link` (existing symlink) resolves to `source` — legacy 008 journals only. */
async function symlinkPointsTo(link, source) {
  const [linkReal, sourceReal] = await Promise.all([realpathSafe(link), realpathSafe(source)]);
  return linkReal !== null && sourceReal !== null && linkReal === sourceReal;
}

function entryKey(entry) {
  return `${entry.kind}:${entry.target}`;
}

function journalEntry(entry, created = new Date().toISOString()) {
  return { kind: entry.kind, target: entry.target, source: entry.source, version: entry.version, created };
}

/**
 * Merges journal entries, keyed by `kind:target` — first occurrence wins, so
 * re-installs keep the original `created` stamp while stale `source`/`version`
 * values are refreshed to the package currently executing. Legacy 008 entries
 * (`symlink` / `opencode-path`) coexist with `copy` entries in one journal.
 */
function mergeJournal(existing, applied) {
  const merged = new Map();
  for (const entry of [...existing, ...applied]) {
    const key = entryKey(entry);
    if (!merged.has(key)) merged.set(key, { ...entry });
    else {
      merged.get(key).source = entry.source ?? merged.get(key).source;
      merged.get(key).version = entry.version ?? merged.get(key).version;
    }
  }
  return [...merged.values()];
}

/**
 * Classifies one plan entry against the filesystem and the journal — the
 * single verdict shared by `--dry-run` and the real apply:
 * `copy` (target absent), `refresh` (owned copy, journal version ≠ package —
 * or no version, i.e. a legacy journal), `noop` (owned copy, same version)
 * or `skip` (foreign target, INV-2).
 */
async function classifyEntry(cwd, entry, existingJournal) {
  const current = await lstatSafe(path.join(cwd, entry.target));
  if (!current) return { action: 'copy', owned: null };
  const owned = existingJournal.find((past) => past.kind === entry.kind && past.target === entry.target) ?? null;
  if (!owned) return { action: 'skip', owned: null };
  if (owned.version && owned.version === entry.version) return { action: 'noop', owned };
  return { action: 'refresh', owned };
}

/**
 * Annotates a plan with the exact action `applyPlan` would take per entry —
 * `[{ entry, action }]` — so `--dry-run` prints the same verdicts the real
 * run applies.
 */
export async function planWithActions(cwd, plan, existingJournal = []) {
  const actions = [];
  for (const entry of plan) {
    const { action } = await classifyEntry(cwd, entry, existingJournal);
    actions.push({ entry, action });
  }
  return actions;
}

/**
 * Applies a wiring plan idempotently (spec 012 — copy is the only wiring
 * mechanism, INV-1): a target absent → copy; an owned copy whose journal
 * version differs from the package (or carries no version, i.e. a legacy
 * 008 journal) → clean replace — the owned target is removed first so files
 * deleted from the package never survive as residuals, never a merge; an
 * owned copy at the same version → no-op; a foreign pre-existing target →
 * warn + skip, never overwritten (INV-2).
 *
 * @returns {Promise<{ applied: Array, actions: Array, skipped: string[], warnings: string[], journal: Array }>}
 *   `actions` is `[{ entry, action }]` (copy | refresh | noop | skip);
 *   `journal` is the merged journal (existing entries + everything this plan owns).
 */
export async function applyPlan(cwd, plan, existingJournal = []) {
  const applied = [];
  const skipped = [];
  const warnings = [];
  const actions = [];

  for (const entry of plan) {
    const { action, owned } = await classifyEntry(cwd, entry, existingJournal);
    actions.push({ entry, action });
    const target = path.join(cwd, entry.target);

    if (action === 'skip') {
      skipped.push(entry.target);
      warnings.push(
        `"${entry.target}" already exists and is not owned by the package — skipped, nothing was overwritten (INV-2).`,
      );
      continue;
    }
    if (action === 'noop') {
      applied.push(journalEntry(entry, owned.created));
      continue;
    }
    if (action === 'refresh') {
      // Clean replace: rm the owned target first — no residual merge (§6).
      await fsp.rm(target, { recursive: true, force: true });
      applied.push(journalEntry(entry, owned.created));
    } else {
      applied.push(journalEntry(entry));
    }
    await ensureDir(path.dirname(target));
    await fsp.cp(entry.source, target, { recursive: true });
  }

  return { applied, actions, skipped, warnings, journal: mergeJournal(existingJournal, applied) };
}

/**
 * Removes the directories a journaled copy left strictly empty — never above
 * the targets: `.opencode/skills/` may hold other user skills and `.claude/`
 * other user config. Walks up from the target, stopping at the repo root or
 * at the first non-empty (or non-directory) ancestor.
 */
async function removeEmptyParents(cwd, targetRel) {
  const root = path.resolve(cwd);
  let dir = path.dirname(path.resolve(cwd, targetRel));
  while (dir.startsWith(`${root}${path.sep}`)) {
    const stat = await lstatSafe(dir);
    if (!stat || !stat.isDirectory()) break; // absent, or a symlink — never above targets
    if ((await fsp.readdir(dir)).length > 0) break;
    await fsp.rmdir(dir);
    dir = path.dirname(dir);
  }
}

/** True when `targetRel` resolves strictly inside the workspace root. */
function insideRoot(cwd, targetRel) {
  const root = path.resolve(cwd);
  const target = path.resolve(cwd, targetRel);
  return target.startsWith(`${root}${path.sep}`);
}

/**
 * Reverts exactly the journaled entries — nothing else (INV-3). Handles all
 * journal generations: `copy` (spec 012 — rm the journaled target, then the
 * strictly empty parent directories), and the legacy 008 entries `symlink`
 * and `opencode-path`, which `--undo` must still honor.
 */
export async function undoPlan(cwd, journal) {
  const removed = [];
  const warnings = [];

  for (const entry of journal) {
    if (entry.kind === 'copy') {
      if (!insideRoot(cwd, entry.target)) {
        warnings.push(`Journal target "${entry.target}" is outside the workspace — skipped.`);
        continue;
      }
      const target = path.join(cwd, entry.target);
      if (!(await lstatSafe(target))) continue;
      await fsp.rm(target, { recursive: true, force: true });
      removed.push(entry.target);
      await removeEmptyParents(cwd, entry.target);
      continue;
    }

    if (entry.kind === 'symlink') {
      const link = path.join(cwd, entry.target);
      const current = await lstatSafe(link);
      if (!current) continue;
      if (current.isSymbolicLink()) {
        if (await symlinkPointsTo(link, entry.source)) {
          await fsp.unlink(link);
          removed.push(entry.target);
        } else {
          warnings.push(`"${entry.target}" no longer points at the package — left untouched (INV-2).`);
        }
      } else {
        warnings.push(`"${entry.target}" is not a symlink — left in place, remove it manually if desired.`);
      }
      continue;
    }

    if (entry.kind === 'opencode-path') {
      if (await unmergeOpenCodePaths(cwd, entry.target)) {
        removed.push(`${entry.target} (opencode.json)`);
      }
      continue;
    }

    warnings.push(`Unknown journal entry kind "${entry.kind}" — skipped.`);
  }

  return { removed, warnings };
}

/** Removes one legacy 008 `skills.paths` value; cleans up empty `paths`/`skills` leftovers. */
async function unmergeOpenCodePaths(cwd, value) {
  const file = path.join(cwd, 'opencode.json');
  let config;
  try {
    config = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return false;
  }
  const paths = config?.skills?.paths;
  if (!Array.isArray(paths) || !paths.includes(value)) return false;
  const remaining = paths.filter((entry) => entry !== value);
  if (remaining.length > 0) {
    config.skills.paths = remaining;
  } else {
    delete config.skills.paths;
    if (Object.keys(config.skills).length === 0) delete config.skills;
  }
  await fsp.writeFile(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return true;
}

/** Reads the install journal, or `null` when it is missing or unreadable. */
export async function readJournal(cwd) {
  try {
    const parsed = JSON.parse(await fsp.readFile(journalPath(cwd), 'utf8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Writes the journal (the `.sdd/` root is ensured — the journal lives there). */
export async function writeJournal(cwd, entries) {
  await ensureDir(specsRoot(cwd));
  await fsp.writeFile(journalPath(cwd), `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

/** Deletes the journal — consumed by a successful `--undo`. */
export async function deleteJournal(cwd) {
  await fsp.rm(journalPath(cwd), { force: true });
}
