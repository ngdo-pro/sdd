import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/cli/main.js';
import { UsageError } from '../src/core/errors.js';
import { detectHosts, installPlan, journalPath, readJournal, resolvePkgRoot } from '../src/cli/hosts.js';
import { makeWorkspace, cleanup, writeFiles, readWorkspaceFile, fileExists } from './helpers.js';

// Hermeticity (spec 009): the post-run update check is exercised with a fake
// fetch in cli.test.js — opt out here so no test ever touches the registry.
process.env.SDD_NO_UPDATE_CHECK = '1';

/** The real repo root — computed independently of `resolvePkgRoot()` on purpose. */
const PKG_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');

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

test('[U1][INV-1] detects hosts and plans entries pointing at the package root', async () => {
  const ws = await makeWorkspace();
  try {
    await writeFiles(ws, { 'opencode.json': '{\n  "name": "demo"\n}\n' });
    await mkdir(path.join(ws, '.claude'));

    assert.equal(resolvePkgRoot(), PKG_ROOT);

    const detected = await detectHosts(ws);
    assert.deepEqual(detected, [
      { id: 'opencode', evidence: 'opencode.json' },
      { id: 'claude', evidence: '.claude/' },
    ]);

    const claude = installPlan(ws, 'claude', { pkgRoot: PKG_ROOT });
    assert.deepEqual(claude.map((entry) => entry.target), ['.claude/skills/shodo', '.claude/agents/shodo']);
    for (const entry of claude) {
      assert.equal(entry.kind, 'symlink');
      assert.equal(entry.source, path.join(PKG_ROOT, entry.target.endsWith('/skills/shodo') ? 'skills' : 'agents'));
    }

    const opencode = installPlan(ws, 'opencode', { pkgRoot: PKG_ROOT });
    assert.equal(opencode[0].kind, 'opencode-path');
    assert.equal(opencode[0].target, 'node_modules/shodo/skills');
    assert.equal(opencode[0].source, path.join(PKG_ROOT, 'skills'));
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

test('[C1][INV-1][INV-4] dry-run writes nothing; install is idempotent', async () => {
  const ws = await makeWorkspace();
  try {
    await mkdir(path.join(ws, '.claude'));

    await sdd(['install', '--dry-run', '--cwd', ws]);
    assert.equal(await lstatSafe(path.join(ws, '.claude', 'skills', 'shodo')), null);
    assert.equal(await lstatSafe(path.join(ws, '.claude', 'agents', 'shodo')), null);
    assert.equal(await fileExists(ws, '.sdd/config.json'), false);
    assert.equal(await lstatSafe(journalPath(ws)), null);

    // --no-init: wiring + journal only — `sdd init` is not run.
    await sdd(['install', '--no-init', '--cwd', ws]);
    assert.equal(await fileExists(ws, '.sdd/config.json'), false);
    assert.equal(
      await fsp.realpath(path.join(ws, '.claude', 'skills', 'shodo')),
      await fsp.realpath(path.join(PKG_ROOT, 'skills')),
    );
    assert.deepEqual((await readJournal(ws)).map((entry) => entry.target).sort(), [
      '.claude/agents/shodo',
      '.claude/skills/shodo',
    ]);

    await sdd(['install', '--cwd', ws]);
    const skillsLink = path.join(ws, '.claude', 'skills', 'shodo');
    assert.equal((await lstatSafe(skillsLink)).isSymbolicLink(), true);
    assert.equal(await fsp.realpath(skillsLink), await fsp.realpath(path.join(PKG_ROOT, 'skills')));
    assert.equal(
      await fsp.realpath(path.join(ws, '.claude', 'agents', 'shodo')),
      await fsp.realpath(path.join(PKG_ROOT, 'agents')),
    );
    assert.equal(await fileExists(ws, '.sdd/config.json'), true);
    const journal = await readJournal(ws);
    assert.deepEqual(journal.map((entry) => entry.target).sort(), ['.claude/agents/shodo', '.claude/skills/shodo']);

    const journalBefore = JSON.stringify(await readJournal(ws));
    const configBefore = await readWorkspaceFile(ws, '.sdd/config.json');
    await sdd(['install', '--cwd', ws]);
    assert.equal(JSON.stringify(await readJournal(ws)), journalBefore);
    assert.equal(await readWorkspaceFile(ws, '.sdd/config.json'), configBefore);
    assert.equal(await fsp.realpath(skillsLink), await fsp.realpath(path.join(PKG_ROOT, 'skills')));
  } finally {
    await cleanup(ws);
  }
});

test('[C2][INV-2] foreign pre-existing target is warned and skipped, never overwritten', async () => {
  const ws = await makeWorkspace();
  try {
    await mkdir(path.join(ws, 'elsewhere'));
    await symlink(path.join(ws, 'elsewhere'), path.join(ws, '.claude', 'skills', 'shodo'));

    const output = await sdd(['install', '--host', 'claude', '--cwd', ws]);
    assert.match(output, /skipped, nothing was overwritten/);

    assert.equal(
      await fsp.readlink(path.join(ws, '.claude', 'skills', 'shodo')),
      path.join(ws, 'elsewhere'),
    );
    assert.equal(
      await fsp.realpath(path.join(ws, '.claude', 'agents', 'shodo')),
      await fsp.realpath(path.join(PKG_ROOT, 'agents')),
    );
    const journal = await readJournal(ws);
    assert.deepEqual(journal.map((entry) => entry.target), ['.claude/agents/shodo']);
  } finally {
    await cleanup(ws);
  }
});

test('[C3][INV-5] no host detected: init alone + manual wiring instructions', async () => {
  const ws = await makeWorkspace();
  try {
    const output = await sdd(['install', '--cwd', ws]);
    assert.equal(await fileExists(ws, '.sdd/config.json'), true);
    assert.match(output, /No agent host detected/);
    assert.match(output, /node_modules\/shodo\/skills/);
    assert.match(output, /README/);
    assert.match(output, /templates\//);
    assert.equal(await lstatSafe(journalPath(ws)), null);
  } finally {
    await cleanup(ws);
  }
});

test('[C4][INV-2] unknown --host and --undo without journal fail cleanly', async () => {
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

test('[C5][INV-2] multiple hosts without --host in non-TTY: UsageError listing them', async () => {
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

test('[I1][INV-1] undo removes exactly the journaled entries, nothing else', async () => {
  const ws = await makeWorkspace();
  try {
    await writeFiles(ws, {
      'opencode.json': '{"name":"demo","skills":{"paths":["local/skills"]},"model":"openai"}\n',
    });
    await mkdir(path.join(ws, '.claude'));

    await sdd(['install', '--host', 'opencode', '--cwd', ws]);
    await sdd(['install', '--host', 'claude', '--cwd', ws]);

    let config = JSON.parse(await readWorkspaceFile(ws, 'opencode.json'));
    assert.deepEqual(config.skills.paths, ['local/skills', 'node_modules/shodo/skills']);
    assert.equal(config.name, 'demo');
    assert.equal(config.model, 'openai');
    // INV-2: the structural merge preserves the existing key order verbatim.
    assert.equal(
      await readWorkspaceFile(ws, 'opencode.json'),
      [
        '{',
        '  "name": "demo",',
        '  "skills": {',
        '    "paths": [',
        '      "local/skills",',
        '      "node_modules/shodo/skills"',
        '    ]',
        '  },',
        '  "model": "openai"',
        '}',
        '',
      ].join('\n'),
    );

    const journal = await readJournal(ws);
    assert.equal(journal.length, 3);

    await sdd(['install', '--host', 'opencode', '--cwd', ws]);
    config = JSON.parse(await readWorkspaceFile(ws, 'opencode.json'));
    assert.deepEqual(config.skills.paths, ['local/skills', 'node_modules/shodo/skills']);

    await sdd(['install', '--undo', '--cwd', ws]);
    config = JSON.parse(await readWorkspaceFile(ws, 'opencode.json'));
    assert.deepEqual(config.skills.paths, ['local/skills']);
    assert.equal(config.name, 'demo');
    assert.equal(config.model, 'openai');
    // Undo removes only the journaled value; the user's own entry and key
    // order survive untouched.
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
    assert.equal(await lstatSafe(path.join(ws, '.claude', 'skills', 'shodo')), null);
    assert.equal(await lstatSafe(path.join(ws, '.claude', 'agents', 'shodo')), null);
    assert.equal(await lstatSafe(journalPath(ws)), null);
  } finally {
    await cleanup(ws);
  }
});

test('[E1][INV-1][INV-2][INV-3][INV-4][INV-5] install → validate → undo leaves no trace', async () => {
  const ws = await makeWorkspace();
  const previousExitCode = process.exitCode;
  try {
    await mkdir(path.join(ws, '.claude'));

    await sdd(['install', '--host', 'claude', '--cwd', ws]);
    assert.equal((await lstatSafe(path.join(ws, '.sdd', 'canonical')))?.isDirectory(), true);
    assert.equal(await fileExists(ws, '.sdd/config.json'), true);
    assert.equal((await lstatSafe(path.join(ws, '.claude', 'skills', 'shodo')))?.isSymbolicLink(), true);

    process.exitCode = undefined;
    await sdd(['validate', '--cwd', ws]);
    assert.notEqual(process.exitCode, 1);

    await sdd(['install', '--undo', '--cwd', ws]);
    assert.equal(await lstatSafe(path.join(ws, '.claude', 'skills', 'shodo')), null);
    assert.equal(await lstatSafe(path.join(ws, '.claude', 'agents', 'shodo')), null);
    assert.equal(await lstatSafe(journalPath(ws)), null);
  } finally {
    process.exitCode = previousExitCode;
    await cleanup(ws);
  }
});
