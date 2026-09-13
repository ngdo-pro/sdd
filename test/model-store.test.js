import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findByRef,
  loadModel,
  moveArtifact,
  saveArtifact,
} from '../src/model/store.js';
import { createMeta } from '../src/model/schema.js';
import { ResolutionError } from '../src/core/errors.js';
import { makeWorkspace, cleanup, seedModel, MODEL_FIXTURE, writeFiles } from './helpers.js';

test('loadModel reads metadata and bodies from the canonical store', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, MODEL_FIXTURE);
    const artifacts = await loadModel(root);
    assert.equal(artifacts.length, 3);

    const spec = artifacts.find((artifact) => artifact.kind === 'spec');
    assert.equal(spec.id, '042');
    assert.equal(spec.state, 'active');
    assert.equal(spec.body.trim(), '## 1. Intent\n\nMagic link.');
    // Stateless layout: no lifecycle segment, file name = bare id.
    assert.equal(spec.model.meta, 'initiatives/demo/features/01-login/specs/042.json');
    assert.equal(spec.model.directory, 'initiatives/demo/features/01-login/specs');
    // Projection lives under the flattened generated/ namespace.
    assert.equal(spec.projection, 'generated/initiatives/demo/specs/042.md');

    const feature = artifacts.find((artifact) => artifact.kind === 'feature');
    assert.equal(feature.model.meta, 'initiatives/demo/features/01-login/01-login.json');
  } finally {
    await cleanup(root);
  }
});

test('findByRef resolves ids, slugs, suffixes and paths', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, MODEL_FIXTURE);
    const artifacts = await loadModel(root);

    assert.equal(findByRef(artifacts, '042').slug, '042-login');
    assert.equal(findByRef(artifacts, '042-login').slug, '042-login');
    assert.equal(findByRef(artifacts, 'login', { kind: 'feature' }).slug, '01-login');
    assert.equal(
      findByRef(artifacts, '.specs/canonical/initiatives/demo/features/01-login/specs/042.json').slug,
      '042-login',
    );
    assert.equal(findByRef(artifacts, 'demo', { kind: 'initiative' }).slug, 'demo');
  } finally {
    await cleanup(root);
  }
});

test('findByRef reports unknown and ambiguous references', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, MODEL_FIXTURE);
    const artifacts = await loadModel(root);
    assert.throws(() => findByRef(artifacts, 'nope'), ResolutionError);
    assert.throws(() => findByRef(artifacts, 'login'), ResolutionError);
    assert.throws(() => findByRef(artifacts, ''), ResolutionError);
  } finally {
    await cleanup(root);
  }
});

test('moveArtifact mutates the state in place without relocating a file', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, MODEL_FIXTURE);
    const artifacts = await loadModel(root);
    const spec = findByRef(artifacts, '042');
    const before = `${spec.model.meta}\n${spec.model.body}`;

    const moved = await moveArtifact(root, spec, 'archived');
    assert.equal(moved.state, 'archived');
    assert.equal(`${moved.model.meta}\n${moved.model.body}`, before);

    const reloaded = await loadModel(root);
    assert.equal(reloaded.filter((artifact) => artifact.kind === 'spec').length, 1);
    assert.equal(findByRef(reloaded, '042').state, 'archived');
    assert.equal(findByRef(reloaded, '042').model.meta, 'initiatives/demo/features/01-login/specs/042.json');
  } finally {
    await cleanup(root);
  }
});

test('saveArtifact relocates files only when relations change', async () => {
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

    const second = await saveArtifact(
      root,
      { ...meta, relations: { feature: '01-b', initiative: 'i2' } },
      'body',
      { previous: first },
    );
    assert.equal(second.meta, 'initiatives/i2/features/01-b/specs/042.json');

    const artifacts = await loadModel(root);
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].model.meta, 'initiatives/i2/features/01-b/specs/042.json');
  } finally {
    await cleanup(root);
  }
});

test('saveArtifact keeps files in place across lifecycle states', async () => {
  const root = await makeWorkspace();
  try {
    const meta = createMeta({
      kind: 'spec',
      slug: '042-login',
      state: 'planned',
      relations: { feature: '01-a', initiative: 'i1' },
    });
    const first = await saveArtifact(root, meta, 'body');
    const second = await saveArtifact(root, { ...meta, state: 'active' }, 'body', { previous: first });

    assert.equal(second.meta, first.meta);
    const artifacts = await loadModel(root);
    assert.equal(artifacts.length, 1);
  } finally {
    await cleanup(root);
  }
});

test('loadModel ignores an empty or missing canonical directory', async () => {
  const root = await makeWorkspace();
  try {
    assert.deepEqual(await loadModel(root), []);
    await writeFiles(root, { '.specs/canonical/README.md': 'nothing here\n' });
    assert.deepEqual(await loadModel(root), []);
  } finally {
    await cleanup(root);
  }
});
