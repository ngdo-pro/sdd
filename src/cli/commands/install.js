import path from 'node:path';
import { UsageError } from '../../core/errors.js';
import {
  HOSTS,
  applyPlan,
  deleteJournal,
  detectHosts,
  installPlan,
  readJournal,
  resolvePkgRoot,
  undoPlan,
  writeJournal,
} from '../hosts.js';
import { init } from './init.js';
import { heading, info, line, success, warn } from '../render.js';

const HOST_IDS = Object.keys(HOSTS);

/**
 * TTY ambiguity gate (spec 008 §4.2): several hosts detected without
 * `--host` — the user picks which ones to wire. `@clack/prompts` is
 * dynamically imported only here (never at module level); cancel gestures
 * map to a typed error.
 */
async function promptHostSelection(detected) {
  const clack = await import('@clack/prompts');
  const selected = await clack.multiselect({
    message: 'Multiple agent hosts detected — which ones should sdd wire?',
    options: detected.map((host) => ({ value: host.id, label: `${host.id} (${host.evidence})` })),
    initialValues: detected.map((host) => host.id),
    required: true,
  });
  if (clack.isCancel(selected)) throw new UsageError('Install cancelled.');
  return selected;
}

/** Manual wiring instructions (INV-5) — templates deliberately not wired (§6). */
function manualInstructions(pkgRoot) {
  return [
    'No agent host detected — nothing was wired. Manual setup (see README › Installation):',
    '  · opencode — merge into opencode.json:',
    '      { "skills": { "paths": ["node_modules/shodo/skills"] } }',
    `  · claude   — ln -s ${path.join(pkgRoot, 'skills')} .claude/skills/shodo`,
    `               ln -s ${path.join(pkgRoot, 'agents')} .claude/agents/shodo`,
    '  · agents   — same symlinks under .agents/',
    '  · templates/ are not wired by default: agents read them from the package at runtime.',
  ];
}

/** `--undo`: the journal is the ONLY undo source — without it, a clean error. */
async function undo(cwd, flags) {
  const journal = await readJournal(cwd);
  if (!journal) {
    throw new UsageError(
      'Nothing to undo — no install journal found at .sdd/.install-journal.json. '
      + 'The journal is the only undo source; wire nothing by guesswork.',
    );
  }
  if (flags.dryRun) {
    heading('sdd install --undo — dry run');
    for (const entry of journal) info(`${entry.kind} ${entry.target}`);
    line('\n  (dry-run: nothing was written)');
    return;
  }
  heading('sdd install --undo');
  const { removed, warnings } = await undoPlan(cwd, journal);
  await deleteJournal(cwd);
  for (const message of warnings) warn(message);
  for (const target of removed) success(`Removed ${target}`);
  if (removed.length === 0) info('Nothing to remove — the journaled entries are already gone.');
  success('Install undone.');
}

/**
 * `sdd install` — one command from package install to working pipeline:
 * detect the agent hosts, wire skills/agents for them (idempotent, journaled,
 * never overwriting foreign content), then run `sdd init` (skippable).
 * Phase order is detection → wiring → init (INV-4); `--dry-run` prints the
 * plan and writes nothing; `--undo` reverts exactly the journal (INV-1);
 * with no host detected it degrades to init alone plus manual instructions
 * (INV-5). Fully offline (INV-3).
 */
export async function install({ cwd, flags }) {
  const host = flags.host ?? 'auto';
  if (host !== 'auto' && !HOSTS[host]) {
    throw new UsageError(`Unknown host "${host}". Valid hosts: ${HOST_IDS.join(', ')}.`);
  }

  if (flags.undo) return undo(cwd, flags);

  const pkgRoot = resolvePkgRoot();

  // Phase 1 — detection (explicit --host always wins over detection).
  let hosts;
  if (host !== 'auto') {
    hosts = [host];
  } else {
    const detected = await detectHosts(cwd);
    if (detected.length > 1) {
      if (process.stdout.isTTY) {
        hosts = await promptHostSelection(detected);
      } else {
        throw new UsageError(
          `Multiple agent hosts detected (${detected.map((d) => `${d.id} — ${d.evidence}`).join(', ')}). `
          + `Pass --host <id> explicitly (one of: ${HOST_IDS.join(', ')}) when stdout is not a TTY.`,
        );
      }
    } else {
      hosts = detected.map((d) => d.id);
    }
  }

  // Phase 2 — plan (pure); dry-run prints it and writes nothing.
  const plan = hosts.flatMap((id) => installPlan(cwd, id, { pkgRoot }));
  if (flags.dryRun) {
    heading(`sdd install — dry run (${hosts.length > 0 ? hosts.join(', ') : 'no host detected'})`);
    for (const entry of plan) info(`${entry.kind} ${entry.target} → ${entry.source}`);
    info(`sdd init: ${flags.init === false ? 'skipped (--no-init)' : 'run after wiring'}`);
    line('\n  (dry-run: nothing was written)');
    return;
  }

  // INV-5 — no host: init alone + manual wiring instructions.
  if (hosts.length === 0) {
    if (flags.init !== false) await init({ cwd, flags: {} });
    heading('sdd install');
    for (const text of manualInstructions(pkgRoot)) line(text);
    return;
  }

  heading(`sdd install — wiring: ${hosts.join(', ')}`);

  // Phase 3 — wiring (idempotent, journal-merged across runs).
  let journal = (await readJournal(cwd)) ?? [];
  for (const id of hosts) {
    const result = await applyPlan(cwd, installPlan(cwd, id, { pkgRoot }), journal);
    journal = result.journal;
    for (const message of result.warnings) warn(message);
  }

  // Phase 4 — init, then the journal: written AFTER `sdd init` so `.sdd/`
  // exists (and even when init fails, so the wiring stays revertible).
  try {
    if (flags.init !== false) await init({ cwd, flags: {} });
  } finally {
    if (journal.length > 0) await writeJournal(cwd, journal);
  }

  for (const entry of journal) info(`wired ${entry.target} → ${entry.source}`);
  info('Templates are not wired: agents read them from the package at runtime.');
  info('Next: run the /setup skill to configure connectors (see README › Installation).');
}
