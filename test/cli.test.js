import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { init } from '../src/cli/commands/init.js';
import { upsert } from '../src/cli/commands/upsert.js';
import { move } from '../src/cli/commands/move.js';
import { done } from '../src/cli/commands/done.js';
import { link } from '../src/cli/commands/link.js';
import { render } from '../src/cli/commands/render.js';
import { model } from '../src/cli/commands/model.js';
import { backend } from '../src/cli/commands/backend.js';
import { validate } from '../src/cli/commands/validate.js';
import { importArtifacts } from '../src/cli/commands/import.js';
import { UsageError } from '../src/core/errors.js';
import { getBackendConfig, loadConfig } from '../src/core/config.js';
import { findByRef, loadModel } from '../src/model/store.js';
import { makeWorkspace, cleanup, fileExists, writeFiles } from './helpers.js';

const BASE_FLAGS = {
  to: undefined,
  kind: undefined,
  state: undefined,
  slug: undefined,
  title: undefined,
  from: undefined,
  feature: undefined,
  initiative: undefined,
  field: undefined,
  backends: undefined,
  create: false,
  force: false,
  check: false,
  write: false,
  cascade: false,
  undo: false,
  done: false,
  dryRun: false,
  json: false,
};

function ctx(cwd, positionals = [], flags = {}) {
  return { cwd, positionals, flags: { ...BASE_FLAGS, ...flags } };
}

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

/** Seeds the standard initiative → feature → spec chain through the commands. */
async function seed(root) {
  await silently(() => init(ctx(root)));
  await silently(() => upsert(ctx(root, ['initiative'], { slug: 'demo', title: 'Demo' })));
  await silently(() => upsert(ctx(root, ['feature'], { slug: '01-login', title: 'Login', initiative: 'demo' })));
  await silently(() => upsert(ctx(root, ['spec'], { slug: '042-login', title: 'Magic link', feature: '01-login' })));
}

test('init bootstraps the model layout and a v2 config', async () => {
  const root = await makeWorkspace();
  try {
    await silently(() => init(ctx(root)));
    assert.equal(await fileExists(root, '.specs/config.json'), true);
    for (const relative of ['.specs/model/specs/archive', '.specs/model/initiatives/planned', '.specs/specs/active']) {
      const info = await fsp.stat(path.join(root, relative));
      assert.equal(info.isDirectory(), true, `${relative} should be a directory`);
    }
    assert.equal((await loadConfig(root)).sourceOfTruth, 'model');
  } finally {
    await cleanup(root);
  }
});

test('upsert creates artifacts with projections and an index', async () => {
  const root = await makeWorkspace();
  try {
    await seed(root);
    const artifacts = await loadModel(root);
    assert.equal(artifacts.length, 3);

    const spec = findByRef(artifacts, '042-login');
    assert.equal(spec.relations.feature, '01-login');
    assert.equal(await fileExists(root, '.specs/specs/planned/042-login.md'), true);
    assert.equal(await fileExists(root, '.specs/model/index.json'), true);

    const featureDoc = await fsp.readFile(path.join(root, '.specs/initiatives/planned/demo/planned/01-login.md'), 'utf8');
    assert.match(featureDoc, /## 6\. Implementation Spec\(s\)/);
    assert.match(featureDoc, /042-login/);
  } finally {
    await cleanup(root);
  }
});

test('upsert reads a body from a file and merges --field flags', async () => {
  const root = await makeWorkspace();
  try {
    await silently(() => init(ctx(root)));
    await writeFiles(root, { 'draft.md': '## 1. Intent\n\nFrom a file.\n' });
    await silently(() => upsert(ctx(root, ['spec'], {
      slug: '042-login',
      title: 'Magic link',
      from: path.join(root, 'draft.md'),
      field: ['Domain=`auth`'],
    })));

    const spec = findByRef(await loadModel(root), '042-login');
    assert.match(spec.body, /From a file\./);
    assert.equal(spec.fields.Domain, '`auth`');
  } finally {
    await cleanup(root);
  }
});

test('upsert validates usage', async () => {
  const root = await makeWorkspace();
  try {
    await assert.rejects(() => upsert(ctx(root, ['nope'], { slug: 'x' })), UsageError);
    await assert.rejects(() => upsert(ctx(root, ['spec'])), UsageError);
    await assert.rejects(() => upsert(ctx(root, ['spec'], { slug: 'x', field: ['broken'] })), UsageError);
  } finally {
    await cleanup(root);
  }
});

test('link records relations and regenerates the parent roadmap', async () => {
  const root = await makeWorkspace();
  try {
    await seed(root);
    await silently(() => link(ctx(root, ['042-login'], { feature: '01-login' })));
    const spec = findByRef(await loadModel(root), '042-login');
    assert.equal(spec.relations.feature, '01-login');
  } finally {
    await cleanup(root);
  }
});

test('link validates usage', async () => {
  const root = await makeWorkspace();
  try {
    await seed(root);
    await assert.rejects(() => link(ctx(root, ['042-login'])), UsageError);
    await assert.rejects(() => link(ctx(root, []), { feature: '01-login' }), UsageError);
  } finally {
    await cleanup(root);
  }
});

test('move updates the model state and the projection path', async () => {
  const root = await makeWorkspace();
  try {
    await seed(root);
    await silently(() => move(ctx(root, ['042-login'], { to: 'active' })));

    assert.equal(findByRef(await loadModel(root), '042-login').state, 'active');
    assert.equal(await fileExists(root, '.specs/specs/active/042-login.md'), true);
    assert.equal(await fileExists(root, '.specs/specs/planned/042-login.md'), false);
  } finally {
    await cleanup(root);
  }
});

test('move validates usage and refuses illegal transitions', async () => {
  const root = await makeWorkspace();
  try {
    await seed(root);
    await assert.rejects(() => move(ctx(root, ['042-login'])), UsageError);
    await assert.rejects(() => move(ctx(root, ['042-login'], { to: 'sideways' })), UsageError);
    await assert.rejects(() => move(ctx(root, [], { to: 'active' })), UsageError);

    await silently(() => move(ctx(root, ['042-login'], { to: 'archived' })));
    await assert.rejects(() => move(ctx(root, ['042-login'], { to: 'planned' })), Error);
  } finally {
    await cleanup(root);
  }
});

test('done --cascade archives the whole chain once every leaf is complete', async () => {
  const root = await makeWorkspace();
  try {
    await seed(root);
    await silently(() => move(ctx(root, ['042-login'], { to: 'active' })));
    await silently(() => done(ctx(root, ['042-login'], { cascade: true })));

    const artifacts = await loadModel(root);
    assert.equal(findByRef(artifacts, '042-login').state, 'archived');
    assert.equal(findByRef(artifacts, '01-login', { kind: 'feature' }).state, 'archived');
    assert.equal(findByRef(artifacts, 'demo', { kind: 'initiative' }).state, 'archived');
  } finally {
    await cleanup(root);
  }
});

test('done --undo reopens an artifact', async () => {
  const root = await makeWorkspace();
  try {
    await seed(root);
    await silently(() => done(ctx(root, ['042-login'])));
    assert.equal(findByRef(await loadModel(root), '042-login').progress.done, true);

    await silently(() => done(ctx(root, ['042-login'], { undo: true })));
    assert.equal(findByRef(await loadModel(root), '042-login').progress.done, false);
  } finally {
    await cleanup(root);
  }
});

test('render --check detects drift and render fixes it', async () => {
  const root = await makeWorkspace();
  try {
    await seed(root);

    const clean = await silently(async () => {
      process.exitCode = 0;
      await render(ctx(root, [], { check: true }));
      return process.exitCode;
    });
    assert.equal(clean, 0);

    await fsp.writeFile(path.join(root, '.specs/specs/planned/042-login.md'), 'tampered\n', 'utf8');
    const drifted = await silently(async () => {
      process.exitCode = 0;
      await render(ctx(root, [], { check: true }));
      return process.exitCode;
    });
    assert.equal(drifted, 1);
    process.exitCode = 0;

    await silently(() => render(ctx(root)));
    const content = await fsp.readFile(path.join(root, '.specs/specs/planned/042-login.md'), 'utf8');
    assert.match(content, /# Spec: 042 - Magic link/);
  } finally {
    await cleanup(root);
  }
});

test('model --write regenerates index.json', async () => {
  const root = await makeWorkspace();
  try {
    await seed(root);
    await fsp.rm(path.join(root, '.specs/model/index.json'));
    await silently(() => model(ctx(root, [], { write: true })));
    assert.equal(await fileExists(root, '.specs/model/index.json'), true);

    const index = JSON.parse(await fsp.readFile(path.join(root, '.specs/model/index.json'), 'utf8'));
    assert.equal(index.sourceOfTruth, 'model');
    assert.equal(index.artifacts.length, 3);
    assert.match(index.artifacts[0].meta, /^\.specs\/model\//);
  } finally {
    await cleanup(root);
  }
});

test('backend enable and disable update the mirror config', async () => {
  const root = await makeWorkspace();
  try {
    await silently(() => init(ctx(root)));
    await silently(() => backend(ctx(root, ['enable', 'linear'])));
    assert.equal(getBackendConfig(await loadConfig(root), 'linear').enabled, true);

    await silently(() => backend(ctx(root, ['disable', 'linear'])));
    assert.equal(getBackendConfig(await loadConfig(root), 'linear').enabled, false);

    await assert.rejects(() => backend(ctx(root, ['enable', 'ghost'])), Error);
    await assert.rejects(() => backend(ctx(root, ['frobnicate'])), UsageError);
  } finally {
    await cleanup(root);
  }
});

test('validate flags uncovered invariants and missing relations', async () => {
  const root = await makeWorkspace();
  try {
    await silently(() => init(ctx(root)));
    await writeFiles(root, { 'draft.md': '## 5. Business Invariants\n\n* **INV-1 · Uncovered**\n  No mapping.\n' });
    await silently(() => upsert(ctx(root, ['spec'], { slug: '042-login', title: 'A', from: path.join(root, 'draft.md') })));

    const exitCode = await silently(async () => {
      process.exitCode = 0;
      await validate(ctx(root));
      return process.exitCode;
    });
    assert.equal(exitCode, 1);
    process.exitCode = 0;
  } finally {
    await cleanup(root);
  }
});

test('import migrates markdown documents into the model', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, {
      '.specs/specs/planned/042-login.md': '# Spec: 042 - Login\n\n## Metadata\n* **Domain:** `x`\n\n---\n\n## 1. Intent\n\nBody.\n',
    });
    await silently(() => importArtifacts(ctx(root)));
    const spec = findByRef(await loadModel(root), '042-login');
    assert.equal(spec.title, 'Login');
    assert.equal(spec.fields.Domain, '`x`');
  } finally {
    await cleanup(root);
  }
});

test('sync warns when no mirror is enabled', async () => {
  const root = await makeWorkspace();
  try {
    await seed(root);
    await silently(() => import('../src/cli/commands/sync.js'));
    const { sync } = await import('../src/cli/commands/sync.js');
    await silently(() => sync(ctx(root)));
  } finally {
    await cleanup(root);
  }
});