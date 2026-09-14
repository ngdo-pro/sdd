import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/cli/main.js';
import { UsageError } from '../src/core/errors.js';
import {
  detectHosts,
  installPlan,
  journalPath,
  readJournal,
  readPkgVersion,
  resolvePkgRoot,
  writeJournal,
} from '../src/cli/hosts.js';
import { makeWorkspace, cleanup, writeFiles, readWorkspaceFile, fileExists } from './helpers.js';

// Hermeticity (spec 009): the post-run update check is exercised with a fake
// fetch in cli.test.js — opt out here so no test ever touches the registry.
process.env.SDD_NO_UPDATE_CHECK = '1';

/** The real repo root — computed independently of `resolvePkgRoot()` on purpose. */
const PKG_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');

/** The real package version — read from package.json, never hardcoded (the version injection seam). */
const PKG_VERSION = readPkgVersion(PKG_ROOT);

/** Simulates a package installed from an older version: every journal copy entry is restamped. */
async function reseedJournalVersions(ws, version) {
  const journal = await readJournal(ws);
  await writeJournal(ws, journal.map((entry) => (entry.kind === 'copy' ? { ...entry, version } : entry)));
}

/** Runs the CLI (same entry as the `sdd` bin) while capturing stdout. */
async function sdd(argv) {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    await run(argv);
  } finally {
    process.stdout.write = original;
  }
  return chunks.join('');
}

async function lstatSafe(target) {
  try {
    return await fsp.lstat(target);
  } catch {
    return null;
  }
}

async function mkdir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function symlink(source, target) {
  await mkdir(path.dirname(target));
  await fsp.symlink(source, target, 'dir');
}

/** Recursively asserts that no entry under `dir` is a symlink (INV-1: copy, never symlink). */
async function assertNoSymlinks(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return; // absent directory — nothing to walk
  }
  for (const entry of entries) {
    assert.equal(entry.isSymbolicLink(), false, `unexpected symlink: ${path.join(dir, entry.name)}`);
    if (entry.isDirectory()) await assertNoSymlinks(path.join(dir, entry.name));
  }
}

/** The shipped inventory, listed from the package (the plan must mirror it exactly). */
async function shippedInventory() {
  const skills = (await fsp.readdir(path.join(PKG_ROOT, 'skills'), { withFileTypes: true }))
    .filter((item) => item.isDirectory() && item.name.startsWith('sdd-'))
    .map((item) => item.name)
    .sort();
  const agents = (await fsp.readdir(path.join(PKG_ROOT, 'agents'), { withFileTypes: true }))
    .filter((item) => item.isFile() && item.name.endsWith('.md'))
    .map((item) => item.name)
    .sort();
  return { skills, agents };
}

test('[U1][INV-1] detects hosts and plans native copy entries stamped with the package version', async () => {
  const ws = await makeWorkspace();
  try {
    await writeFiles(ws, { 'opencode.json': '{\n  "name": "demo"\n}\n' });
    await mkdir(path.join(ws, '.claude'));

    assert.equal(resolvePkgRoot(), PKG_ROOT);
    assert.equal(readPkgVersion(PKG_ROOT), PKG_VERSION);

    const detected = await detectHosts(ws);
    assert.deepEqual(detected, [
      { id: 'opencode', evidence: 'opencode.json' },
      { id: 'claude', evidence: '.claude/' },
    ]);

    const { skills, agents } = await shippedInventory();

    const claude = installPlan(ws, 'claude', { pkgRoot: PKG_ROOT, pkgVersion: PKG_VERSION });
    assert.equal(claude.length, skills.length + agents.length);
    assert.deepEqual(
      claude.filter((entry) => entry.target.startsWith('.claude/skills/')).map((entry) => path.basename(entry.target)),
      skills,
    );
    assert.deepEqual(
      claude.filter((entry) => entry.target.startsWith('.claude/agents/')).map((entry) => path.basename(entry.target)),
      agents,
    );
    for (const entry of claude) {
      assert.equal(entry.kind, 'copy');
      assert.equal(entry.version, PKG_VERSION);
      assert.equal(entry.source, path.join(PKG_ROOT, entry.target.replace(/^\.claude\//, '')));
    }

    // The version seam defaults to the executing package's own package.json.
    const opencode = installPlan(ws, 'opencode', { pkgRoot: PKG_ROOT });
    assert.equal(opencode.length, skills.length);
    assert.equal(opencode.some((entry) => !entry.target.startsWith('.opencode/skills/')), false);
    for (const entry of opencode) {
      assert.equal(entry.kind, 'copy');
      assert.match(entry.target, /^\.opencode\/skills\/sdd-/);
      assert.equal(entry.source, path.join(PKG_ROOT, 'skills', path.basename(entry.target)));
      assert.equal(entry.version, PKG_VERSION);
    }
  } finally {
    await cleanup(ws);
  }
});

test('[U2][INV-1] unknown host is rejected; empty workspace detects nothing', async () => {
  const ws = await makeWorkspace();
  try {
    assert.deepEqual(await detectHosts(ws), []);
    assert.throws(() => installPlan(ws, 'cursor', { pkgRoot: PKG_ROOT }), UsageError);
  } finally {
    await cleanup(ws);
  }
});

test('[C1][INV-1][INV-4] dry-run writes nothing; install copies natives — zero symlink, opencode.json intact', async () => {
  const ws = await makeWorkspace();
  try {
    const openCodeConfig = '{\n  "name": "demo"\n}\n';
    await writeFiles(ws, { 'opencode.json': openCodeConfig });
    await mkdir(path.join(ws, '.claude'));

    // Dry-run: the full plan is printed, nothing exists afterwards.
    const dryOutput = await sdd(['install', '--host', 'claude', '--dry-run', '--cwd', ws]);
    assert.match(dryOutput, /copy \.claude\/skills\/sdd-build-spec/);
    assert.match(dryOutput, /copy \.claude\/agents\//);
    assert.match(dryOutput, /dry-run: nothing was written/);
    assert.equal(await lstatSafe(path.join(ws, '.claude', 'skills')), null);
    assert.equal(await fileExists(ws, '.sdd/config.json'), false);
    assert.equal(await lstatSafe(journalPath(ws)), null);

    // Install both hosts (--no-init: wiring + journal only).
    await sdd(['install', '--host', 'opencode', '--no-init', '--cwd', ws]);
    await sdd(['install', '--host', 'claude', '--no-init', '--cwd', ws]);
    assert.equal(await fileExists(ws, '.sdd/config.json'), false);

    const { skills, agents } = await shippedInventory();
    for (const base of ['.opencode', '.claude']) {
      for (const skill of skills) {
        const target = path.join(ws, base, 'skills', skill);
        const stat = await lstatSafe(target);
        assert.equal(stat?.isDirectory(), true, `${target} is a real directory`);
        assert.equal(await fileExists(ws, path.join(base, 'skills', skill, 'SKILL.md')), true);
      }
    }
    for (const agent of agents) {
      assert.equal(
        await readWorkspaceFile(ws, path.join('.claude', 'agents', agent)),
        await readWorkspaceFile(PKG_ROOT, path.join('agents', agent)),
      );
    }
    // The copy is byte-identical to the package content — a real copy, not a link.
    assert.equal(
      await readWorkspaceFile(ws, path.join('.claude', 'skills', 'sdd-build-spec', 'SKILL.md')),
      await readWorkspaceFile(PKG_ROOT, path.join('skills', 'sdd-build-spec', 'SKILL.md')),
    );

    // INV-1: no symlink anywhere, and opencode.json was never written.
    await assertNoSymlinks(ws);
    assert.equal(await readWorkspaceFile(ws, 'opencode.json'), openCodeConfig);

    const journal = await readJournal(ws);
    assert.equal(journal.length, skills.length * 2 + agents.length);
    for (const entry of journal) {
      assert.equal(entry.kind, 'copy');
      assert.equal(entry.version, PKG_VERSION);
      assert.ok(entry.created);
    }

    // Idempotent re-install (init runs this time): journal byte-identical.
    const journalBefore = JSON.stringify(await readJournal(ws));
    await sdd(['install', '--host', 'claude', '--cwd', ws]);
    assert.equal(await fileExists(ws, '.sdd/config.json'), true);
    assert.equal(JSON.stringify(await readJournal(ws)), journalBefore);
  } finally {
    await cleanup(ws);
  }
});

test('[C2][INV-2] foreign targets are warned and skipped, never overwritten — no collision with a legacy `sdd` symlink', async () => {
  const ws = await makeWorkspace();
  try {
    await mkdir(path.join(ws, 'elsewhere'));
    // Old spec-008 layout remnant: ONE `.claude/skills/sdd` symlink, not journaled.
    await symlink(path.join(ws, 'elsewhere'), path.join(ws, '.claude', 'skills', 'sdd'));
    // A foreign directory colliding with a new-layout target name.
    await writeFiles(ws, { '.claude/skills/sdd-setup/KEEP.md': 'user content\n' });

    const output = await sdd(['install', '--host', 'claude', '--no-init', '--cwd', ws]);
    assert.match(output, /"\.claude\/skills\/sdd-setup" already exists and is not owned by the package/);
    assert.match(output, /skipped, nothing was overwritten/);

    // Both foreign targets untouched; the legacy symlink is not a plan target
    // (the new layout poses `sdd-*` directories) — nothing collided.
    assert.equal(
      await fsp.readlink(path.join(ws, '.claude', 'skills', 'sdd')),
      path.join(ws, 'elsewhere'),
    );
    assert.equal(await readWorkspaceFile(ws, '.claude/skills/sdd-setup/KEEP.md'), 'user content\n');

    // Everything else was copied, and nothing foreign is journaled.
    const journal = await readJournal(ws);
    assert.ok(journal.length > 0);
    assert.equal(journal.some((entry) => entry.target === '.claude/skills/sdd-setup'), false);
    assert.equal(journal.some((entry) => entry.target === '.claude/skills/sdd'), false);
    assert.equal(journal.every((entry) => entry.kind === 'copy'), true);
  } finally {
    await cleanup(ws);
  }
});

test('[C3][INV-2] no-op at equal version: owned targets are not re-copied', async () => {
  const ws = await makeWorkspace();
  try {
    await mkdir(path.join(ws, '.claude'));
    await sdd(['install', '--host', 'claude', '--no-init', '--cwd', ws]);

    // Simulate user drift inside an owned copy: at the same version, install
    // is a no-op and must NOT repair it.
    const tampered = path.join(ws, '.claude', 'skills', 'sdd-build-spec', 'SKILL.md');
    await fsp.writeFile(tampered, `${await fsp.readFile(tampered, 'utf8')}\nLOCAL DRIFT\n`, 'utf8');

    const journalBefore = JSON.stringify(await readJournal(ws));
    const output = await sdd(['install', '--host', 'claude', '--no-init', '--cwd', ws]);
    assert.match(output, /up to date/);
    assert.doesNotMatch(output, /version changed/);
    assert.equal(JSON.stringify(await readJournal(ws)), journalBefore);
    assert.match(await fsp.readFile(tampered, 'utf8'), /LOCAL DRIFT/);
  } finally {
    await cleanup(ws);
  }
});

test('[C4][INV-2] refresh on version change: owned targets cleanly replaced, foreign skipped', async () => {
  const ws = await makeWorkspace();
  try {
    await mkdir(path.join(ws, '.claude'));
    await sdd(['install', '--host', 'claude', '--no-init', '--cwd', ws]);

    // Simulate version A: reseed the journal, tamper an owned file and leave a
    // ghost file that no longer exists in the package (residual-merge probe).
    await reseedJournalVersions(ws, '0.0.1');
    const skillFile = path.join(ws, '.claude', 'skills', 'sdd-build-spec', 'SKILL.md');
    await fsp.writeFile(skillFile, 'STALE VERSION A\n', 'utf8');
    await fsp.writeFile(path.join(ws, '.claude', 'skills', 'sdd-setup', 'GHOST.md'), 'residual\n', 'utf8');
    // A foreign target: `sdd-vision` exists on disk but its journal entry is
    // dropped — it is present, unowned, and must be warned + skipped.
    const journalA = await readJournal(ws);
    await writeJournal(ws, journalA.filter((entry) => entry.target !== '.claude/skills/sdd-vision'));
    await writeFiles(ws, { '.claude/skills/sdd-vision/KEEP.md': 'user content\n' });

    const output = await sdd(['install', '--host', 'claude', '--no-init', '--cwd', ws]);
    assert.match(output, /version changed/);
    assert.match(output, /refreshed/);
    assert.match(output, /"\.claude\/skills\/sdd-vision" already exists and is not owned/);

    // Clean replace: package content restored, residual gone — no merge.
    assert.equal(
      await fsp.readFile(skillFile, 'utf8'),
      await fsp.readFile(path.join(PKG_ROOT, 'skills', 'sdd-build-spec', 'SKILL.md'), 'utf8'),
    );
    assert.equal(await lstatSafe(path.join(ws, '.claude', 'skills', 'sdd-setup', 'GHOST.md')), null);
    assert.equal(await readWorkspaceFile(ws, '.claude/skills/sdd-vision/KEEP.md'), 'user content\n');

    // The journal is re-stamped with the current package version — except the
    // foreign target, which stays unjournaled.
    const journal = await readJournal(ws);
    assert.equal(journal.length, 23);
    assert.equal(journal.every((entry) => entry.kind === 'copy' && entry.version === PKG_VERSION), true);
    assert.equal(journal.some((entry) => entry.target === '.claude/skills/sdd-vision'), false);
  } finally {
    await cleanup(ws);
  }
});

test('[C5][INV-5] no host detected: init alone + manual copy instructions', async () => {
  const ws = await makeWorkspace();
  try {
    const output = await sdd(['install', '--cwd', ws]);
    assert.equal(await fileExists(ws, '.sdd/config.json'), true);
    assert.match(output, /No agent host detected/);
    assert.match(output, /cp -R/);
    assert.match(output, /README/);
    assert.match(output, /templates\//);
    assert.equal(await lstatSafe(journalPath(ws)), null);
  } finally {
    await cleanup(ws);
  }
});

test('[C6][INV-2] unknown --host and --undo without journal fail cleanly', async () => {
  const ws = await makeWorkspace();
  try {
    await assert.rejects(
      sdd(['install', '--host', 'cursor', '--cwd', ws]),
      (error) => {
        assert.ok(error instanceof UsageError);
        assert.match(error.message, /Unknown host "cursor"/);
        assert.match(error.message, /opencode, claude, agents/);
        return true;
      },
    );
    await assert.rejects(
      sdd(['install', '--undo', '--cwd', ws]),
      (error) => {
        assert.ok(error instanceof UsageError);
        assert.match(error.message, /Nothing to undo/);
        assert.match(error.message, /journal/);
        return true;
      },
    );
    assert.equal(await fileExists(ws, '.sdd/config.json'), false);
  } finally {
    await cleanup(ws);
  }
});

test('[C7][INV-2] multiple hosts without --host in non-TTY: UsageError listing them', async () => {
  const ws = await makeWorkspace();
  try {
    await writeFiles(ws, { 'opencode.json': '{}\n' });
    await mkdir(path.join(ws, '.claude'));
    await assert.rejects(
      sdd(['install', '--cwd', ws]),
      (error) => {
        assert.ok(error instanceof UsageError);
        assert.match(error.message, /Multiple agent hosts detected/);
        assert.match(error.message, /opencode — opencode\.json/);
        assert.match(error.message, /claude — \.claude\//);
        assert.match(error.message, /--host/);
        return true;
      },
    );
    assert.equal(await fileExists(ws, '.sdd/config.json'), false);
  } finally {
    await cleanup(ws);
  }
});

test('[I1][INV-3] undo removes exactly the copies and the legacy 008 journal entries — nothing else', async () => {
  const ws = await makeWorkspace();
  try {
    await writeFiles(ws, {
      'opencode.json': '{"name":"demo","skills":{"paths":["local/skills","node_modules/@ngdo-pro/sdd/skills"]},"model":"openai"}\n',
      '.opencode/skills/user-skill/SKILL.md': 'user skill\n',
    });
    await mkdir(path.join(ws, '.claude'));
    // A legacy 008 journal + the symlink it journaled, as the old layout left them.
    const created = '2026-01-01T00:00:00.000Z';
    await symlink(path.join(PKG_ROOT, 'skills'), path.join(ws, '.claude', 'skills', 'sdd'));
    await writeJournal(ws, [
      { kind: 'symlink', target: '.claude/skills/sdd', source: path.join(PKG_ROOT, 'skills'), created },
      { kind: 'opencode-path', target: 'node_modules/@ngdo-pro/sdd/skills', source: path.join(PKG_ROOT, 'skills'), created },
    ]);

    // New-regime install: copies are added, the legacy journal entries survive the merge.
    await sdd(['install', '--host', 'claude', '--no-init', '--cwd', ws]);
    await sdd(['install', '--host', 'opencode', '--no-init', '--cwd', ws]);
    const journal = await readJournal(ws);
    assert.equal(journal.some((entry) => entry.kind === 'symlink'), true);
    assert.equal(journal.some((entry) => entry.kind === 'opencode-path'), true);
    assert.equal(journal.every((entry) => entry.kind === 'copy' || entry.created === created), true);

    await sdd(['install', '--undo', '--cwd', ws]);

    // Journaled copies removed — including the legacy symlink and the legacy
    // opencode path; the user's own path and key order survive untouched.
    const config = JSON.parse(await readWorkspaceFile(ws, 'opencode.json'));
    assert.deepEqual(config.skills.paths, ['local/skills']);
    assert.equal(config.name, 'demo');
    assert.equal(config.model, 'openai');
    assert.equal(
      await readWorkspaceFile(ws, 'opencode.json'),
      [
        '{',
        '  "name": "demo",',
        '  "skills": {',
        '    "paths": [',
        '      "local/skills"',
        '    ]',
        '  },',
        '  "model": "openai"',
        '}',
        '',
      ].join('\n'),
    );

    // `.claude/` held only journaled content → fully emptied and removed;
    // `.opencode/skills/` holds a user skill and must survive, but the copied
    // sdd-* dirs are gone and `.opencode/skills` itself keeps its user content.
    assert.equal(await lstatSafe(path.join(ws, '.claude')), null);
    assert.equal(await lstatSafe(path.join(ws, '.opencode', 'skills', 'sdd-setup')), null);
    assert.equal(await readWorkspaceFile(ws, '.opencode/skills/user-skill/SKILL.md'), 'user skill\n');
    assert.equal((await lstatSafe(path.join(ws, '.opencode', 'skills', 'user-skill')))?.isDirectory(), true);
    assert.equal(await lstatSafe(journalPath(ws)), null);
    await assertNoSymlinks(ws);
  } finally {
    await cleanup(ws);
  }
});

test('[E1][INV-1][INV-2][INV-3][INV-4] install → validate → version-bump re-install → undo, opencode.json intact throughout', async () => {
  const ws = await makeWorkspace();
  const previousExitCode = process.exitCode;
  try {
    const openCodeConfig = '{"name":"demo","note":"never touched"}\n';
    await writeFiles(ws, { 'opencode.json': openCodeConfig });

    // 1. Install (copies + init).
    await sdd(['install', '--host', 'opencode', '--cwd', ws]);
    assert.equal((await lstatSafe(path.join(ws, '.opencode', 'skills', 'sdd-setup')))?.isDirectory(), true);
    assert.equal(await fileExists(ws, '.sdd/config.json'), true);
    assert.equal(await readWorkspaceFile(ws, 'opencode.json'), openCodeConfig);
    await assertNoSymlinks(ws);

    // The pipeline works on the wired workspace.
    process.exitCode = undefined;
    await sdd(['validate', '--cwd', ws]);
    assert.notEqual(process.exitCode, 1);

    // 2. Version bump: journal stamped 0.0.0, package content drifted.
    await reseedJournalVersions(ws, '0.0.0');
    const drifted = path.join(ws, '.opencode', 'skills', 'sdd-setup', 'SKILL.md');
    await fsp.writeFile(drifted, 'VERSION A\n', 'utf8');
    const output = await sdd(['install', '--host', 'opencode', '--no-init', '--cwd', ws]);
    assert.match(output, /version changed/);
    assert.notEqual(await fsp.readFile(drifted, 'utf8'), 'VERSION A\n');
    const journal = await readJournal(ws);
    assert.equal(journal.every((entry) => entry.kind !== 'copy' || entry.version === PKG_VERSION), true);
    assert.equal(await readWorkspaceFile(ws, 'opencode.json'), openCodeConfig);

    // 3. Undo: copies retired, journal gone, workspace back to bare.
    await sdd(['install', '--undo', '--cwd', ws]);
    assert.equal(await lstatSafe(path.join(ws, '.opencode', 'skills')), null);
    assert.equal(await lstatSafe(journalPath(ws)), null);
    assert.equal(await readWorkspaceFile(ws, 'opencode.json'), openCodeConfig);
    await assertNoSymlinks(ws);
  } finally {
    process.exitCode = previousExitCode;
    await cleanup(ws);
  }
});
