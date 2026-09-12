import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { init } from '../src/cli/commands/init.js';
import { move } from '../src/cli/commands/move.js';
import { backend } from '../src/cli/commands/backend.js';
import { validate } from '../src/cli/commands/validate.js';
import { list } from '../src/cli/commands/list.js';
import { loadConfig, getBackendConfig } from '../src/core/config.js';
import { UsageError } from '../src/core/errors.js';
import { FIXTURES, makeWorkspace, writeFiles, fileExists, cleanup } from './helpers.js';

const FLAGS = { backends: undefined, kind: undefined, to: undefined, create: false, force: false, dryRun: false, json: false };

/** Runs a command while muting stdout so test output stays readable. */
async function silently(handler) {
  const original = process.stdout.write;
  process.stdout.write = () => true;
  try {
    return await handler();
  } finally {
    process.stdout.write = original;
  }
}

test('init bootstraps the layout and configuration', async () => {
  const root = await makeWorkspace();
  try {
    await silently(() => init({ cwd: root, flags: FLAGS }));
    assert.equal(await fileExists(root, '.specs/config.json'), true);
    for (const relative of ['.specs/specs/archive', '.specs/initiatives/planned', '.specs/knowledge/domains']) {
      const info = await stat(path.join(root, relative));
      assert.equal(info.isDirectory(), true, `${relative} should be a directory`);
    }
    const config = await loadConfig(root);
    assert.equal(config.sourceOfTruth, 'filesystem');
  } finally {
    await cleanup(root);
  }
});

test('move command transitions a spec and persists the remote map', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, FIXTURES);
    await silently(() => move({ cwd: root, positionals: ['042'], flags: { ...FLAGS, to: 'active' } }));
    assert.equal(await fileExists(root, '.specs/specs/active/042-login.md'), true);
    assert.equal(await fileExists(root, '.specs/specs/planned/042-login.md'), false);
    assert.equal(await fileExists(root, '.specs/.remote-map.json'), true);
  } finally {
    await cleanup(root);
  }
});

test('move command rejects a missing or invalid target state', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, FIXTURES);
    await assert.rejects(() => move({ cwd: root, positionals: ['042'], flags: FLAGS }), UsageError);
    await assert.rejects(
      () => move({ cwd: root, positionals: ['042'], flags: { ...FLAGS, to: 'sideways' } }),
      UsageError,
    );
    await assert.rejects(() => move({ cwd: root, positionals: [], flags: { ...FLAGS, to: 'active' } }), UsageError);
  } finally {
    await cleanup(root);
  }
});

test('backend command enables and disables a backend in config.json', async () => {
  const root = await makeWorkspace();
  try {
    await silently(() => init({ cwd: root, flags: FLAGS }));
    await silently(() => backend({ cwd: root, positionals: ['enable', 'linear'], flags: FLAGS }));
    assert.equal(getBackendConfig(await loadConfig(root), 'linear').enabled, true);

    await silently(() => backend({ cwd: root, positionals: ['disable', 'linear'], flags: FLAGS }));
    assert.equal(getBackendConfig(await loadConfig(root), 'linear').enabled, false);
  } finally {
    await cleanup(root);
  }
});

test('backend command refuses to disable the required filesystem backend', async () => {
  const root = await makeWorkspace();
  try {
    await silently(() => init({ cwd: root, flags: FLAGS }));
    await assert.rejects(
      () => silently(() => backend({ cwd: root, positionals: ['disable', 'filesystem'], flags: FLAGS })),
      UsageError,
    );
  } finally {
    await cleanup(root);
  }
});

test('validate flags a spec missing invariant coverage', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, {
      '.specs/specs/planned/042-login.md': '# Spec: 042 - Login\n\n## 5. Business Invariants\n\n* **INV-1 · No coverage**\n  Missing mapping.\n',
    });
    const previousExitCode = process.exitCode;
    await silently(() => validate({ cwd: root, flags: FLAGS }));
    assert.equal(process.exitCode, 1);
    process.exitCode = previousExitCode;
  } finally {
    await cleanup(root);
  }
});

test('list command renders without throwing', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, FIXTURES);
    await silently(() => list({ cwd: root, flags: { ...FLAGS, json: true } }));
  } finally {
    await cleanup(root);
  }
});
