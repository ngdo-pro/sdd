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
import { list } from '../src/cli/commands/list.js';
import { importArtifacts } from '../src/cli/commands/import.js';
import { UsageError } from '../src/core/errors.js';
import { getBackendConfig, loadConfig } from '../src/core/config.js';
import { findByRef, loadModel } from '../src/model/store.js';
import { canonicalRoot } from '../src/core/paths.js';
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

/** Runs a command capturing stdout (for --json / dry-run assertions). */
async function capturing(handler) {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    await handler();
  } finally {
    process.stdout.write = original;
  }
  return chunks.join('');
}

/** Snapshot of every file under a directory: `{ relativePath: content }`. */
async function snapshot(root, base) {
  const files = {};
  async function walk(directory) {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        const relative = path.relative(root, absolute).split(path.sep).join('/');
        files[relative] = await fsp.readFile(absolute, 'utf8');
      }
    }
  }
  await walk(path.join(root, base));
  return files;
}

/** Lists every path (files + dirs) under a directory, relative and sorted. */
async function listPaths(root, base) {
  const paths = [];
  async function walk(directory) {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const relative = path.relative(root, path.join(directory, entry.name)).split(path.sep).join('/');
      paths.push(relative);
      if (entry.isDirectory()) await walk(path.join(directory, entry.name));
    }
  }
  await walk(path.join(root, base));
  return paths.sort();
}

/** Compares two index snapshots ignoring the volatile `generatedAt` stamp. */
function indexFingerprint(content) {
  const parsed = JSON.parse(content);
  delete parsed.generatedAt;
  return JSON.stringify(parsed);
}

/** Seeds the standard initiative → feature → spec chain through the commands. */
async function seed(root) {
  await silently(() => init(ctx(root)));
  await silently(() => upsert(ctx(root, ['initiative'], { slug: 'demo', title: 'Demo' })));
  await silently(() => upsert(ctx(root, ['feature'], { slug: '01-login', title: 'Login', initiative: 'demo' })));
  await silently(() => upsert(ctx(root, ['spec'], { slug: '042-login', title: 'Magic link', feature: '01-login' })));
}

test('init bootstraps exactly .specs/, canonical/ and config.json', async () => {
  const root = await makeWorkspace();
  try {
    await silently(() => init(ctx(root)));
    assert.equal(await fileExists(root, '.specs/config.json'), true);
    // INV-3: exact minimal tree — no state dirs, no model/, no knowledge/.
    assert.deepEqual(await listPaths(root, '.specs'), ['.specs/canonical', '.specs/config.json']);
    assert.equal((await loadConfig(root)).sourceOfTruth, 'model');
  } finally {
    await cleanup(root);
  }
});

test('upsert creates artifacts with projections and a canonical index', async () => {
  const root = await makeWorkspace();
  try {
    await seed(root);
    const artifacts = await loadModel(root);
    assert.equal(artifacts.length, 3);

    const spec = findByRef(artifacts, '042-login');
    assert.equal(spec.relations.feature, '01-login');
    assert.equal(spec.relations.initiative, 'demo');
    assert.equal(spec.model.meta, 'initiatives/demo/features/01-login/specs/042.json');
    assert.equal(await fileExists(root, '.specs/specs/planned/042-login.md'), true);
    assert.equal(await fileExists(root, '.specs/canonical/index.json'), true);

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
    await seed(root);
    await writeFiles(root, { 'draft.md': '## 1. Intent\n\nFrom a file.\n' });
    await silently(() => upsert(ctx(root, ['spec'], {
      slug: '042-login',
      title: 'Magic link',
      feature: '01-login',
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

test('upsert validates usage and rejects specs without --feature', async () => {
  const root = await makeWorkspace();
  try {
    await silently(() => init(ctx(root)));
    await assert.rejects(() => upsert(ctx(root, ['nope'], { slug: 'x' })), UsageError);
    await assert.rejects(() => upsert(ctx(root, ['spec'])), UsageError);
    await assert.rejects(() => upsert(ctx(root, ['spec'], { slug: 'x', field: ['broken'] })), UsageError);

    // INV-1: no parent feature → no derivable path → rejected before any write.
    await assert.rejects(
      () => upsert(ctx(root, ['spec'], { slug: '042-x' })),
      (error) => error instanceof UsageError && /spec requires --feature/.test(error.message),
    );
    assert.equal(await fileExists(root, '.specs/canonical/index.json'), false);
    assert.deepEqual(await listPaths(root, '.specs'), ['.specs/canonical', '.specs/config.json']);
  } finally {
    await cleanup(root);
  }
});

test('link records derived relations and regenerates the parent roadmap', async () => {
  const root = await makeWorkspace();
  try {
    await seed(root);
    const output = await capturing(() => link(ctx(root, ['042-login'], { feature: '01-login' })));
    assert.match(output, /already linked/);
    const spec = findByRef(await loadModel(root), '042-login');
    assert.equal(spec.relations.feature, '01-login');
    assert.equal(spec.relations.initiative, 'demo');
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

test('move mutates the state in place: model path constant, projection follows v2', async () => {
  const root = await makeWorkspace();
  try {
    await seed(root);
    const before = findByRef(await loadModel(root), '042-login');
    await silently(() => move(ctx(root, ['042-login'], { to: 'active' })));

    const after = findByRef(await loadModel(root), '042-login');
    assert.equal(after.state, 'active');
    // INV-2: canonical files are never relocated by a transition.
    assert.equal(after.model.meta, before.model.meta);
    // Interim v2 projections keep the state-encoded path convention.
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

test('model --write regenerates the canonical index.json', async () => {
  const root = await makeWorkspace();
  try {
    await seed(root);
    await fsp.rm(path.join(root, '.specs/canonical/index.json'));
    await silently(() => model(ctx(root, [], { write: true })));
    assert.equal(await fileExists(root, '.specs/canonical/index.json'), true);

    const index = JSON.parse(await fsp.readFile(path.join(root, '.specs/canonical/index.json'), 'utf8'));
    assert.equal(index.version, 3);
    assert.equal(index.sourceOfTruth, 'model');
    assert.equal(index.artifacts.length, 3);
    assert.match(index.artifacts[0].meta, /^\.specs\/canonical\//);
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
    await seed(root);
    await writeFiles(root, { 'draft.md': '## 5. Business Invariants\n\n* **INV-1 · Uncovered**\n  No mapping.\n' });
    await silently(() => upsert(ctx(root, ['spec'], {
      slug: '042-login',
      title: 'A',
      feature: '01-login',
      from: path.join(root, 'draft.md'),
    })));

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

test('import migrates markdown documents into the canonical model', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, {
      '.specs/initiatives/active/demo/README.md': '# Initiative: Demo\n\n> **Initiative Slug:** `demo`  \n> **Status:** Active  \n\n---\n\n## 1. Intent & The Gap\n\nToday: nothing.\n',
      '.specs/initiatives/active/demo/planned/01-login.md': '# Feature: Login\n\n> **Parent Initiative:** `demo`  \n\n---\n\n## 1. Problem & Trigger\n\nUsers need login.\n\n---\n\n## 6. Implementation Spec(s)\n\n- [ ] **`042-login`** : Magic link\n',
      '.specs/specs/active/042-login.md': '# Spec: 042 - Login\n\n## Metadata\n* **Domain:** `x`\n\n---\n\n## 1. Intent\n\nBody.\n',
    });
    await silently(() => importArtifacts(ctx(root)));
    const spec = findByRef(await loadModel(root), '042-login');
    assert.equal(spec.title, 'Login');
    assert.equal(spec.fields.Domain, '`x`');
    assert.equal(spec.model.meta, 'initiatives/demo/features/01-login/specs/042.json');
  } finally {
    await cleanup(root);
  }
});

test('sync warns when no mirror is enabled', async () => {
  const root = await makeWorkspace();
  try {
    await seed(root);
    const { sync } = await import('../src/cli/commands/sync.js');
    await silently(() => sync(ctx(root)));
  } finally {
    await cleanup(root);
  }
});

// ============================================================================
// Integration Tests (@integration) — §8.1 scenarios I2, I3
// ============================================================================

test('[I2][INV-1][INV-2][INV-3] full CLI cycle without any file relocation', async () => {
  const root = await makeWorkspace();
  try {
    await silently(() => init(ctx(root)));
    assert.deepEqual(await listPaths(root, '.specs'), ['.specs/canonical', '.specs/config.json']);

    await silently(() => upsert(ctx(root, ['initiative'], { slug: 'demo', title: 'Demo' })));
    await silently(() => upsert(ctx(root, ['feature'], { slug: '01-login', title: 'Login', initiative: 'demo' })));
    await silently(() => upsert(ctx(root, ['spec'], { slug: '042-login', title: 'Magic link', feature: '01-login' })));

    const canonicalPaths = await listPaths(root, '.specs/canonical');
    assert.ok(canonicalPaths.includes('.specs/canonical/initiatives/demo/features/01-login/specs/042.json'));

    // Dirs are created on the very first write only; transitions never touch them.
    for (const to of ['active', 'archived']) {
      await silently(() => move(ctx(root, ['demo'], { to })));
      await silently(() => move(ctx(root, ['01-login'], { to })));
      await silently(() => move(ctx(root, ['042'], { to })));
      assert.deepEqual(await listPaths(root, '.specs/canonical'), canonicalPaths);
    }

    const index = JSON.parse(await fsp.readFile(path.join(root, '.specs/canonical/index.json'), 'utf8'));
    assert.deepEqual(
      Object.fromEntries(index.artifacts.map((artifact) => [artifact.slug, artifact.state])),
      { demo: 'archived', '01-login': 'archived', '042-login': 'archived' },
    );
    assert.equal(await fileExists(root, '.specs/specs/archive/042-login.md'), true);
  } finally {
    await cleanup(root);
  }
});

test('[I3][INV-5][INV-7] 3- and 4-digit ids coexist and bare-id refs resolve', async () => {
  const root = await makeWorkspace();
  try {
    await silently(() => init(ctx(root)));
    await silently(() => upsert(ctx(root, ['initiative'], { slug: 'i1', title: 'I1' })));
    await silently(() => upsert(ctx(root, ['initiative'], { slug: 'i2', title: 'I2' })));
    await silently(() => upsert(ctx(root, ['feature'], { slug: '01-a', title: 'A', initiative: 'i1' })));
    await silently(() => upsert(ctx(root, ['feature'], { slug: '01-b', title: 'B', initiative: 'i2' })));
    await silently(() => upsert(ctx(root, ['spec'], { slug: '042-a', title: 'A', feature: '01-a' })));
    await silently(() => upsert(ctx(root, ['spec'], { slug: '1042-b', title: 'B', feature: '01-b' })));

    const output = await capturing(() => list(ctx(root, [], { kind: 'spec', json: true })));
    const specs = JSON.parse(output);
    assert.deepEqual(specs.map((spec) => spec.id).sort(), ['042', '1042']);

    const artifacts = await loadModel(root);
    assert.equal(findByRef(artifacts, '042').slug, '042-a');
    assert.equal(findByRef(artifacts, '1042').slug, '1042-b');
    assert.equal(
      findByRef(artifacts, '1042').model.meta,
      'initiatives/i2/features/01-b/specs/1042.json',
    );
  } finally {
    await cleanup(root);
  }
});

// ============================================================================
// End-to-End Tests (@e2e) — §8.1 scenarios E1, E2
// ============================================================================

test('[E1][INV-1..INV-7] full user journey from a blank workspace', async () => {
  const root = await makeWorkspace();
  try {
    await silently(() => init(ctx(root)));
    await silently(() => upsert(ctx(root, ['initiative'], { slug: 'layout-v3', title: 'Layout v3' })));
    const beforeReUpsert = findByRef(await loadModel(root), 'layout-v3', { kind: 'initiative' }).model.meta;

    // INV-6: re-upserting the same slug only edits metadata in place.
    await silently(() => upsert(ctx(root, ['initiative'], { slug: 'layout-v3', title: 'Layout v3 — mis à jour' })));
    const afterReUpsert = findByRef(await loadModel(root), 'layout-v3', { kind: 'initiative' }).model.meta;
    assert.equal(afterReUpsert, beforeReUpsert);
    assert.equal(findByRef(await loadModel(root), 'layout-v3', { kind: 'initiative' }).title, 'Layout v3 — mis à jour');

    await silently(() => upsert(ctx(root, ['feature'], { slug: '01-canonical-tree', title: 'Canonical tree', initiative: 'layout-v3' })));
    await silently(() => upsert(ctx(root, ['spec'], { slug: '001-canonical-layout', title: 'Canonical layout', feature: '01-canonical-tree' })));

    await silently(() => move(ctx(root, ['001'], { to: 'active' })));
    await silently(() => move(ctx(root, ['001'], { to: 'archived' })));
    await silently(() => done(ctx(root, ['001'], { cascade: true })));

    const specPath = 'initiatives/layout-v3/features/01-canonical-tree/specs/001.json';
    const artifacts = await loadModel(root);
    assert.equal(findByRef(artifacts, '001').model.meta, specPath);
    assert.equal(findByRef(artifacts, '001').state, 'archived');
    assert.equal(findByRef(artifacts, '01-canonical-tree', { kind: 'feature' }).state, 'archived');
    assert.equal(findByRef(artifacts, 'layout-v3', { kind: 'initiative' }).state, 'archived');

    // No lifecycle directory anywhere under canonical/.
    const paths = await listPaths(root, '.specs/canonical');
    assert.equal(paths.some((relative) => /(^|\/)(planned|active|archive)(\/|$)/.test(relative)), false);

    const index = JSON.parse(await fsp.readFile(path.join(root, '.specs/canonical/index.json'), 'utf8'));
    assert.equal(index.artifacts.every((artifact) => artifact.state === 'archived'), true);

    const exitCode = await silently(async () => {
      process.exitCode = 0;
      await validate(ctx(root));
      return process.exitCode;
    });
    assert.equal(exitCode, 0);
    process.exitCode = 0;
  } finally {
    await cleanup(root);
  }
});

test('[E2][INV-2] move idempotence: re-run and dry-run are side-effect free', async () => {
  const root = await makeWorkspace();
  try {
    await seed(root);
    await silently(() => move(ctx(root, ['042-login'], { to: 'archived' })));
    const before = await snapshot(root, '.specs');
    const beforeIndex = indexFingerprint(before['.specs/canonical/index.json']);

    // Re-run on an already-archived artifact: no error, no change.
    await silently(() => move(ctx(root, ['042-login'], { to: 'archived' })));
    let after = await snapshot(root, '.specs');
    assert.equal(indexFingerprint(after['.specs/canonical/index.json']), beforeIndex);
    delete before['.specs/canonical/index.json'];
    delete after['.specs/canonical/index.json'];
    assert.deepEqual(after, before);

    // Dry-run: same guarantee + explicit no-op message.
    const output = await capturing(() => move(ctx(root, ['042-login'], { to: 'archived', dryRun: true })));
    assert.match(output, /\(dry-run: nothing was written\)/);
    after = await snapshot(root, '.specs');
    assert.equal(indexFingerprint(after['.specs/canonical/index.json']), beforeIndex);
    delete after['.specs/canonical/index.json'];
    assert.deepEqual(after, before);

    // A second real move is still a no-op.
    await silently(() => move(ctx(root, ['042-login'], { to: 'archived' })));
    after = await snapshot(root, '.specs');
    assert.equal(indexFingerprint(after['.specs/canonical/index.json']), beforeIndex);
    delete after['.specs/canonical/index.json'];
    assert.deepEqual(after, before);
  } finally {
    await cleanup(root);
  }
});
