import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fsp from 'node:fs/promises';
import {
  canonicalRoot,
  knowledgeRoot,
  parseSpecSlug,
  standardLayout,
} from '../src/core/paths.js';
import { modelRelativePaths } from '../src/model/layout.js';
import { createMeta } from '../src/model/schema.js';
import { moveArtifact, saveArtifact, loadModel, findByRef } from '../src/model/store.js';
import { writeIndex } from '../src/model/index.js';
import { init } from '../src/cli/commands/init.js';
import { upsert } from '../src/cli/commands/upsert.js';
import { move } from '../src/cli/commands/move.js';
import { done } from '../src/cli/commands/done.js';
import { link } from '../src/cli/commands/link.js';
import { render } from '../src/cli/commands/render.js';
import { validate } from '../src/cli/commands/validate.js';
import { UsageError } from '../src/core/errors.js';
import { makeWorkspace, cleanup, seedModel, fileExists, writeFiles, MODEL_FIXTURE } from './helpers.js';

const BASE_FLAGS = {
  to: undefined, kind: undefined, state: undefined, slug: undefined, title: undefined,
  from: undefined, feature: undefined, initiative: undefined, field: undefined,
  backends: undefined, create: false, force: false, check: false, write: false,
  cascade: false, undo: false, done: false, dryRun: false, json: false,
};

function ctx(cwd, positionals = [], flags = {}) {
  return { cwd, positionals, flags: { ...BASE_FLAGS, ...flags } };
}

async function silently(handler) {
  const original = process.stdout.write;
  process.stdout.write = () => true;
  try {
    return await handler();
  } finally {
    process.stdout.write = original;
  }
}

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

/** Captures stdout while measuring `process.exitCode` (validate/render checks). */
async function capturingExitCode(handler) {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    process.exitCode = 0;
    await handler();
    return { output: chunks.join(''), exitCode: process.exitCode };
  } finally {
    process.stdout.write = original;
  }
}

/** Sorted list of every path under a base directory (files + dirs). */
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

function exitCodeOf(handler) {
  return silently(async () => {
    process.exitCode = 0;
    await handler();
    return process.exitCode;
  });
}

// ============================================================================
// Unit Tests (@unit) — §8.1 scenarios U1–U4 (U5–U7 live with the store, phase 2)
// ============================================================================

test('[U1][INV-1][INV-5] canonical spec path derives from relations alone', () => {
  const meta = createMeta({
    kind: 'spec',
    slug: '042-login',
    state: 'active',
    relations: { feature: '01-login', initiative: 'demo' },
  });
  // No `initiativeState` option: the signature no longer threads parent state.
  assert.equal(modelRelativePaths.length, 1);
  assert.deepEqual(modelRelativePaths(meta), {
    dir: 'initiatives/demo/features/01-login/specs',
    meta: 'initiatives/demo/features/01-login/specs/042.json',
    body: 'initiatives/demo/features/01-login/specs/042.md',
  });
});

test('[U2][INV-1] canonical paths of vision, initiative and feature', () => {
  const vision = createMeta({ kind: 'vision', slug: 'vision' });
  assert.deepEqual(modelRelativePaths(vision), { dir: '', meta: 'vision.json', body: 'vision.md' });

  const initiative = createMeta({ kind: 'initiative', slug: 'demo', state: 'active' });
  assert.deepEqual(modelRelativePaths(initiative), {
    dir: 'initiatives/demo',
    meta: 'initiatives/demo/demo.json',
    body: 'initiatives/demo/demo.md',
  });

  const feature = createMeta({
    kind: 'feature',
    slug: '01-login',
    state: 'active',
    relations: { initiative: 'demo' },
  });
  assert.deepEqual(modelRelativePaths(feature), {
    dir: 'initiatives/demo/features/01-login',
    meta: 'initiatives/demo/features/01-login/01-login.json',
    body: 'initiatives/demo/features/01-login/01-login.md',
  });
});

test('[U3][INV-7] parseSpecSlug accepts 3 and 4 digits, rejects 2 and 5', () => {
  assert.deepEqual(parseSpecSlug('042-login'), { id: '042', suffix: 'login' });
  assert.deepEqual(parseSpecSlug('1042-x'), { id: '1042', suffix: 'x' });
  assert.equal(parseSpecSlug('42-x'), null);
  assert.equal(parseSpecSlug('10442-x'), null);
});

test('[U4][INV-3] standardLayout returns exactly the root and canonical/', async () => {
  const cwd = await makeWorkspace();
  try {
    assert.deepEqual(standardLayout(cwd), [
      path.join(cwd, '.specs'),
      path.join(cwd, '.specs', 'canonical'),
    ]);
    assert.equal(path.join(cwd, '.specs', 'knowledge'), knowledgeRoot(cwd));
    assert.equal(path.join(cwd, '.specs', 'canonical'), canonicalRoot(cwd));
  } finally {
    await cleanup(cwd);
  }
});

// ============================================================================
// Unit Tests (@unit) — store & index (U5–U7)
// ============================================================================

test('[U5][INV-2][INV-3] saveArtifact writes on demand, relocates on relations only', async () => {
  const root = await makeWorkspace();
  try {
    const meta = createMeta({
      kind: 'spec',
      slug: '042-login',
      state: 'planned',
      relations: { feature: '01-a', initiative: 'i1' },
    });

    const first = await saveArtifact(root, meta, 'body');
    assert.equal(first.meta, 'initiatives/i1/features/01-a/specs/042.json');
    assert.equal(await fileExists(root, '.specs/canonical/initiatives/i1/features/01-a/specs/042.json'), true);

    const second = await saveArtifact(
      root,
      { ...meta, relations: { feature: '01-b', initiative: 'i2' } },
      'body',
      { previous: first },
    );
    assert.equal(second.meta, 'initiatives/i2/features/01-b/specs/042.json');
    assert.equal(await fileExists(root, '.specs/canonical/initiatives/i1/features/01-a/specs/042.json'), false);

    const artifacts = await loadModel(root);
    assert.equal(artifacts.length, 1);
  } finally {
    await cleanup(root);
  }
});

test('[U6][INV-1] buildIndex v3 lives under canonical/ with canonical prefixes', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, MODEL_FIXTURE);
    const artifacts = await loadModel(root);
    const { file } = await writeIndex(root, artifacts);

    assert.equal(file.endsWith('.specs/canonical/index.json'), true);
    const index = JSON.parse(await fsp.readFile(file, 'utf8'));
    assert.equal(index.version, 3);
    for (const entry of index.artifacts) {
      assert.match(entry.meta, /^\.specs\/canonical\//);
      assert.match(entry.body, /^\.specs\/canonical\//);
      assert.match(entry.projection, /^\.specs\//);
      assert.doesNotMatch(entry.projection, /^\.specs\/canonical\//);
    }
  } finally {
    await cleanup(root);
  }
});

test('[U7][INV-2] moveArtifact mutates state in place without moving a file', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, [
      { kind: 'initiative', slug: 'demo', title: 'Demo', state: 'planned' },
      { kind: 'feature', slug: '01-login', title: 'Login', state: 'planned', relations: { initiative: 'demo' } },
      {
        kind: 'spec',
        slug: '042-login',
        title: 'Magic link',
        state: 'planned',
        relations: { feature: '01-login', initiative: 'demo' },
      },
    ]);
    const spec = findByRef(await loadModel(root), '042');
    const metaBefore = await fsp.readFile(path.join(canonicalRoot(root), spec.model.meta), 'utf8');
    const bodyBefore = await fsp.readFile(path.join(canonicalRoot(root), spec.model.body), 'utf8');

    const moved = await moveArtifact(root, spec, 'active');

    assert.equal(`${moved.model.meta}\n${moved.model.body}`, `${spec.model.meta}\n${spec.model.body}`);
    assert.equal(moved.state, 'active');
    // `updatedAt` is re-set on every move (same-day value is allowed to repeat).
    assert.ok(moved.updatedAt);
    assert.equal(
      await fsp.readFile(path.join(canonicalRoot(root), moved.model.meta), 'utf8'),
      metaBefore.replace('"state": "planned"', '"state": "active"'),
    );
    assert.equal(
      await fsp.readFile(path.join(canonicalRoot(root), moved.model.body), 'utf8'),
      bodyBefore,
    );
  } finally {
    await cleanup(root);
  }
});

// ============================================================================
// Component Tests (@component) — C1–C9
// ============================================================================

test('[C1][INV-3] loadModel discovers the nested canonical tree', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, MODEL_FIXTURE);
    const artifacts = await loadModel(root);
    assert.equal(artifacts.length, 3);

    const byKind = Object.fromEntries(artifacts.map((artifact) => [artifact.kind, artifact]));
    assert.equal(byKind.initiative.model.meta, 'initiatives/demo/demo.json');
    assert.equal(byKind.feature.model.meta, 'initiatives/demo/features/01-login/01-login.json');
    assert.equal(byKind.spec.model.meta, 'initiatives/demo/features/01-login/specs/042.json');
    // Projections live under the flattened generated/ namespace.
    assert.equal(byKind.spec.projection, 'generated/initiatives/demo/specs/042.md');
    assert.equal(byKind.feature.projection, 'generated/initiatives/demo/features/01-login.md');
  } finally {
    await cleanup(root);
  }
});

test('[C2][INV-2] spec move plans the mutation without relocating files', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, [
      { kind: 'initiative', slug: 'demo', title: 'Demo', state: 'planned' },
      { kind: 'feature', slug: '01-login', title: 'Login', state: 'planned', relations: { initiative: 'demo' } },
      {
        kind: 'spec',
        slug: '042-login',
        title: 'Magic link',
        state: 'planned',
        relations: { feature: '01-login', initiative: 'demo' },
      },
    ]);
    await silently(() => render(ctx(root)));
    const before = await listPaths(root, '.specs/canonical');

    await silently(() => move(ctx(root, ['042'], { to: 'active' })));

    assert.deepEqual(await listPaths(root, '.specs/canonical'), before);

    const index = JSON.parse(await fsp.readFile(path.join(canonicalRoot(root), 'index.json'), 'utf8'));
    assert.equal(index.artifacts.find((entry) => entry.slug === '042-login').state, 'active');
    // Projections keep the same generated/ path — states never rename files.
    assert.equal(await fileExists(root, '.specs/generated/initiatives/demo/specs/042.md'), true);
    assert.equal(await fileExists(root, '.specs/specs'), false);
  } finally {
    await cleanup(root);
  }
});

test('[C3][INV-2] done --cascade archives the chain without moving a single file', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, [
      { kind: 'initiative', slug: 'demo', title: 'Demo', state: 'active' },
      { kind: 'feature', slug: '01-login', title: 'Login', state: 'active', relations: { initiative: 'demo' } },
      {
        kind: 'spec',
        slug: '042-login',
        title: 'Magic link',
        state: 'active',
        relations: { feature: '01-login', initiative: 'demo' },
      },
    ]);
    await silently(() => render(ctx(root)));
    const before = await listPaths(root, '.specs/canonical');

    await silently(() => done(ctx(root, ['042'], { cascade: true })));

    assert.deepEqual(await listPaths(root, '.specs/canonical'), before);
    const artifacts = await loadModel(root);
    for (const slug of ['042-login', '01-login', 'demo']) {
      assert.equal(artifacts.find((artifact) => artifact.slug === slug).state, 'archived');
    }
  } finally {
    await cleanup(root);
  }
});

test('[C4][INV-5] validate reports a model-level duplicate spec id', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, [
      { kind: 'initiative', slug: 'i1', title: 'I1' },
      { kind: 'initiative', slug: 'i2', title: 'I2' },
      { kind: 'feature', slug: '01-a', title: 'A', relations: { initiative: 'i1' } },
      { kind: 'feature', slug: '01-b', title: 'B', relations: { initiative: 'i2' } },
      { kind: 'spec', slug: '042-a', title: 'A', relations: { feature: '01-a', initiative: 'i1' } },
      { kind: 'spec', slug: '042-b', title: 'B', relations: { feature: '01-b', initiative: 'i2' } },
    ]);
    await silently(() => render(ctx(root)));

    const { output, exitCode } = await capturingExitCode(() => validate(ctx(root)));
    assert.match(output, /\[spec-id-uniqueness\]/);
    assert.match(output, /duplicate spec id "042"/);
    assert.equal(exitCode, 1);
    process.exitCode = 0;
  } finally {
    await cleanup(root);
  }
});

test('[C5][INV-1] validate refuses lifecycle dirs under canonical/ and incomplete relations', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, MODEL_FIXTURE);
    // Parasitic lifecycle directory inside the canonical tree.
    await writeFiles(root, { '.specs/canonical/initiatives/demo/planned/.keep': '' });
    // A spec whose relations make its path underivable.
    await writeFiles(root, {
      '.specs/canonical/initiatives/demo/features/01-broken/specs/099-broken.json': JSON.stringify({
        version: 3,
        kind: 'spec',
        id: '099',
        slug: '099-broken',
        title: 'Broken',
        state: 'planned',
        relations: { feature: '01-broken' },
        fields: {},
        remote: {},
        progress: { done: false },
        createdAt: '2026-09-13',
        updatedAt: '2026-09-13',
      }, null, 2),
    });

    const { output, exitCode } = await capturingExitCode(() => validate(ctx(root)));
    assert.match(output, /\[canonical-layout\]/);
    assert.match(output, /planned\/" under/);
    assert.match(output, /\[graph-integrity\]/);
    assert.match(output, /099-broken/);
    assert.equal(exitCode, 1);
    process.exitCode = 0;
  } finally {
    await cleanup(root);
  }
});

test('[C6][INV-1] upsert spec without --feature is rejected before any write', async () => {
  const root = await makeWorkspace();
  try {
    await silently(() => init(ctx(root)));
    await assert.rejects(
      () => upsert(ctx(root, ['spec'], { slug: '042-x' })),
      (error) => error instanceof UsageError && /spec requires --feature/.test(error.message),
    );
    assert.deepEqual(await listPaths(root, '.specs'), ['.specs/canonical', '.specs/config.json']);
  } finally {
    await cleanup(root);
  }
});

test('[C7][INV-1][INV-5] link derives relations.initiative and relocates the spec', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, [
      { kind: 'initiative', slug: 'i1', title: 'I1' },
      { kind: 'initiative', slug: 'i2', title: 'I2' },
      { kind: 'feature', slug: '01-a', title: 'A', relations: { initiative: 'i1' } },
      { kind: 'feature', slug: '01-b', title: 'B', relations: { initiative: 'i2' } },
      { kind: 'spec', slug: '042-a', title: 'A', relations: { feature: '01-a', initiative: 'i1' } },
    ]);
    await silently(() => render(ctx(root)));

    await silently(() => link(ctx(root, ['042'], { feature: '01-b' })));

    const spec = findByRef(await loadModel(root), '042');
    assert.deepEqual(spec.relations, { feature: '01-b', initiative: 'i2' });
    assert.equal(spec.model.meta, 'initiatives/i2/features/01-b/specs/042.json');
    assert.equal(await fileExists(root, '.specs/canonical/initiatives/i1/features/01-a/specs/042.json'), false);
  } finally {
    await cleanup(root);
  }
});

test('[C8][INV-1][INV-6] re-parenting a feature relocates it and every descendant spec', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, [
      { kind: 'initiative', slug: 'i1', title: 'I1' },
      { kind: 'initiative', slug: 'i2', title: 'I2' },
      { kind: 'feature', slug: '01-a', title: 'A', relations: { initiative: 'i1' } },
      { kind: 'spec', slug: '042-a', title: 'A', relations: { feature: '01-a', initiative: 'i1' } },
      { kind: 'spec', slug: '043-a', title: 'B', relations: { feature: '01-a', initiative: 'i1' } },
    ]);
    await silently(() => render(ctx(root)));

    await silently(() => link(ctx(root, ['01-a'], { initiative: 'i2' })));

    const artifacts = await loadModel(root);
    const feature = findByRef(artifacts, '01-a', { kind: 'feature' });
    assert.equal(feature.model.meta, 'initiatives/i2/features/01-a/01-a.json');
    assert.equal(feature.slug, '01-a'); // slugs are immutable — only the location moved

    const specs = artifacts.filter((artifact) => artifact.kind === 'spec');
    assert.deepEqual(
      specs.map((spec) => spec.model.meta).sort(),
      ['initiatives/i2/features/01-a/specs/042.json', 'initiatives/i2/features/01-a/specs/043.json'],
    );
    assert.equal(await fileExists(root, '.specs/canonical/initiatives/i1/features/01-a'), false);
  } finally {
    await cleanup(root);
  }
});

test('[C9][INV-1] generated/ projections and the canonical index coexist', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, MODEL_FIXTURE);
    const artifacts = await loadModel(root);
    await silently(() => render(ctx(root)));

    assert.equal(await fileExists(root, '.specs/generated/initiatives/demo/README.md'), true);
    assert.equal(await fileExists(root, '.specs/canonical/index.json'), true);

    const drift = await exitCodeOf(() => render(ctx(root, [], { check: true })));
    assert.equal(drift, 0);
    process.exitCode = 0;
  } finally {
    await cleanup(root);
  }
});

// ============================================================================
// Integration Tests (@integration) — I1, I4
// ============================================================================

test('[I1][INV-3] init produces the exact minimal tree', async () => {
  const root = await makeWorkspace();
  try {
    await silently(() => init(ctx(root)));
    assert.deepEqual(await listPaths(root, '.specs'), ['.specs/canonical', '.specs/config.json']);
  } finally {
    await cleanup(root);
  }
});

test('[I4][INV-4][INV-3] validate passes with and without knowledge/', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, MODEL_FIXTURE);
    await silently(() => render(ctx(root)));

    assert.equal(await exitCodeOf(() => validate(ctx(root))), 0);

    // knowledge/ is authored content, outside the graph — never required.
    await writeFiles(root, {
      '.specs/knowledge/decisions/product/PDR-TEST.md': '# PDR-TEST\n',
    });
    assert.equal(await exitCodeOf(() => validate(ctx(root))), 0);
    process.exitCode = 0;
  } finally {
    await cleanup(root);
  }
});
