import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fsp from 'node:fs/promises';
import { ConfigError, UsageError } from '../core/errors.js';
import { ensureDir, exists, isDir, specsRoot } from '../core/paths.js';

/**
 * Agent-host registry backing `sdd install` (spec 008).
 *
 * An agent host is a directory convention an agentic tool reads in the target
 * repo: `opencode.json` (OpenCode), `.claude/` (Claude Code) and `.agents/`
 * (generic agents). The registry is extensible: add an entry to `HOSTS` with
 * `detect` and `plan` and it is immediately available to `--host` validation,
 * detection and wiring. Wiring never overwrites foreign content (INV-2) and
 * every applied entry is journaled so `--undo` removes exactly what install
 * posed (INV-1).
 */

/** Hidden journal file at `.sdd/.install-journal.json` — tolerated by `root-layout` (cf. `.migration-failed.json`). */
export const JOURNAL_FILENAME = '.install-journal.json';

/** Path added to `skills.paths` in `opencode.json` (relative to the target repo). */
export const OPENCODE_SKILLS_PATH = 'node_modules/shodo/skills';

export function journalPath(cwd) {
  return path.join(specsRoot(cwd), JOURNAL_FILENAME);
}

/**
 * Root of the package currently executing (`sdd install` itself) — resolved
 * from `import.meta.url`, never from `process.cwd()`: the CLI may run from an
 * npx cache, an npm global install or a clone, and the wiring must point at
 * the skills/agents shipped by that exact package (INV-1).
 */
export function resolvePkgRoot() {
  return path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
}

/** Plan entries wiring one symlinked host directory (`.claude/` or `.agents/`). */
function symlinkEntries(baseDir) {
  return (cwd, pkgRoot) => [
    { kind: 'symlink', target: `${baseDir}/skills/shodo`, source: path.join(pkgRoot, 'skills') },
    { kind: 'symlink', target: `${baseDir}/agents/shodo`, source: path.join(pkgRoot, 'agents') },
  ];
}

/** Host registry — order defines detection order and `--host` documentation. */
export const HOSTS = {
  opencode: {
    id: 'opencode',
    evidence: 'opencode.json',
    detect: (cwd) => exists(path.join(cwd, 'opencode.json')),
    plan: (cwd, pkgRoot) => [
      { kind: 'opencode-path', target: OPENCODE_SKILLS_PATH, source: path.join(pkgRoot, 'skills') },
    ],
  },
  claude: {
    id: 'claude',
    evidence: '.claude/',
    detect: (cwd) => isDir(path.join(cwd, '.claude')),
    plan: symlinkEntries('.claude'),
  },
  agents: {
    id: 'agents',
    evidence: '.agents/',
    detect: (cwd) => isDir(path.join(cwd, '.agents')),
    plan: symlinkEntries('.agents'),
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
 * Builds the wiring plan for one host: `[{ kind: 'opencode-path'|'symlink',
 * target, source }]`. `target` is repo-relative (the symlink location or the
 * `skills.paths` value); `source` is the absolute path inside the executing
 * package the entry points at.
 */
export function installPlan(cwd, host, { pkgRoot = resolvePkgRoot() } = {}) {
  const entry = HOSTS[host];
  if (!entry) {
    throw new UsageError(`Unknown host "${host}". Valid hosts: ${Object.keys(HOSTS).join(', ')}.`);
  }
  return entry.plan(cwd, pkgRoot);
}

function lstatSafe(target) {
  return fsp.lstat(target).catch(() => null);
}

function realpathSafe(target) {
  return fsp.realpath(target).catch(() => null);
}

/** True when `link` (existing symlink or directory) resolves to `source`. */
async function symlinkPointsTo(link, source) {
  const [linkReal, sourceReal] = await Promise.all([realpathSafe(link), realpathSafe(source)]);
  return linkReal !== null && sourceReal !== null && linkReal === sourceReal;
}

function entryKey(entry) {
  return `${entry.kind}:${entry.target}`;
}

function journalEntry(entry, created = new Date().toISOString()) {
  return { kind: entry.kind, target: entry.target, source: entry.source, created };
}

/**
 * Merges journal entries, keyed by `kind:target` — first occurrence wins, so
 * re-installs keep the original `created` stamp while stale `source` values
 * are refreshed to the package currently executing.
 */
function mergeJournal(existing, applied) {
  const merged = new Map();
  for (const entry of [...existing, ...applied]) {
    const key = entryKey(entry);
    if (!merged.has(key)) merged.set(key, { ...entry });
    else merged.get(key).source = entry.source ?? merged.get(key).source;
  }
  return [...merged.values()];
}

/**
 * Structurally merges one `skills.paths` value into `opencode.json`
 * (INV-2): the parsed object is mutated in place so existing keys and their
 * order are preserved, and only the missing path is appended. A missing file
 * is created with the minimal shape; an unparseable file is never touched.
 */
async function mergeOpenCodePaths(cwd, value) {
  const file = path.join(cwd, 'opencode.json');
  let config;
  try {
    config = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      config = {};
    } else {
      throw new ConfigError(
        `Cannot parse opencode.json (${error.message}) — fix it before running \`sdd install\` (nothing was overwritten).`,
      );
    }
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new ConfigError('opencode.json must contain a JSON object — nothing was overwritten.');
  }
  if (typeof config.skills !== 'object' || config.skills === null || Array.isArray(config.skills)) {
    config.skills = {};
  }
  if (!Array.isArray(config.skills.paths)) config.skills.paths = [];
  if (config.skills.paths.includes(value)) return 'present';
  config.skills.paths.push(value);
  await fsp.writeFile(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return 'added';
}

/** Removes one `skills.paths` value; cleans up empty `paths`/`skills` leftovers. */
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

/**
 * Applies a wiring plan idempotently. A pre-existing target that is not owned
 * by shodo is warned and skipped — never overwritten (INV-2); a target
 * pointing at a previous shodo package root (stale journal) is refreshed to
 * the package currently executing (INV-1 re-install). On platforms refusing
 * symlinks (Windows EPERM) the entry falls back to a copy with an explicit
 * warning (documented softening of INV-1).
 *
 * @returns {Promise<{ applied: Array, skipped: string[], warnings: string[], journal: Array }>}
 *   `journal` is the merged journal (existing entries + everything this plan owns).
 */
export async function applyPlan(cwd, plan, existingJournal = []) {
  const applied = [];
  const skipped = [];
  const warnings = [];

  for (const entry of plan) {
    if (entry.kind === 'symlink') {
      const link = path.join(cwd, entry.target);
      const current = await lstatSafe(link);
      if (current) {
        if (await symlinkPointsTo(link, entry.source)) {
          applied.push(journalEntry(entry));
          continue;
        }
        // Stale shodo wiring: the link still points at a previous package root.
        let stale = null;
        for (const past of existingJournal) {
          if (past.kind === 'symlink' && entryKey(past) === entryKey(entry)
            && await symlinkPointsTo(link, past.source)) {
            stale = past;
            break;
          }
        }
        if (stale) {
          await fsp.unlink(link);
          await ensureDir(path.dirname(link));
          await fsp.symlink(entry.source, link, 'dir');
          applied.push(journalEntry(entry, stale.created));
          continue;
        }
        skipped.push(entry.target);
        warnings.push(
          `"${entry.target}" already exists and is not owned by shodo — skipped, nothing was overwritten (INV-2).`,
        );
        continue;
      }
      await ensureDir(path.dirname(link));
      try {
        await fsp.symlink(entry.source, link, 'dir');
      } catch (error) {
        if (error?.code !== 'EPERM') throw error;
        await fsp.cp(entry.source, link, { recursive: true });
        warnings.push(
          `"${entry.target}" was copied instead of symlinked (symlink creation is not permitted on this platform). `
          + 'Re-run `sdd install` after updating the shodo package to refresh the copy.',
        );
      }
      applied.push(journalEntry(entry));
      continue;
    }

    if (entry.kind === 'opencode-path') {
      await mergeOpenCodePaths(cwd, entry.target);
      applied.push(journalEntry(entry));
      continue;
    }

    throw new UsageError(`Unknown plan entry kind "${entry.kind}".`);
  }

  return { applied, skipped, warnings, journal: mergeJournal(existingJournal, applied) };
}

/**
 * Reverts exactly the journaled entries — nothing else (INV-1). A symlink no
 * longer pointing at the recorded package source is left untouched (INV-2);
 * a copy fallback entry is left in place with a warning (it is
 * indistinguishable from user content).
 */
export async function undoPlan(cwd, journal) {
  const removed = [];
  const warnings = [];

  for (const entry of journal) {
    if (entry.kind === 'symlink') {
      const link = path.join(cwd, entry.target);
      const current = await lstatSafe(link);
      if (!current) continue;
      if (current.isSymbolicLink()) {
        if (await symlinkPointsTo(link, entry.source)) {
          await fsp.unlink(link);
          removed.push(entry.target);
        } else {
          warnings.push(`"${entry.target}" no longer points at the shodo package — left untouched (INV-2).`);
        }
      } else {
        warnings.push(
          `"${entry.target}" is not a symlink (platform copy fallback) — left in place, remove it manually if desired.`,
        );
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
