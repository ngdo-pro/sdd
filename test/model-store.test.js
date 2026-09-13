import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findByRef,
  initiativeStateFor,
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
    assert.equal(spec.model.meta, 'specs/active/042-login.json');
    assert.equal(spec.projection, 'specs/active/042-login.md');

    const feature = artifacts.find((artifact) => artifact.kind === 'feature');
    assert.equal(feature.model.meta, 'initiatives/active/demo/active/01-login.json');
  } finally {
    await cleanup(root);
  }
});

test('initiativeStateFor resolves the parent state used to locate features', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, MODEL_FIXTURE);
    const artifacts = await loadModel(root);
    assert.equal(initiativeStateFor(artifacts, 'demo'), 'active');
    assert.equal(initiativeStateFor(artifacts, 'nope'), undefined);
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
    assert.equal(findByRef(artifacts, '.specs/model/specs/active/042-login.json').slug, '042-login');
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

test('moveArtifact relocates metadata and body across state directories', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, MODEL_FIXTURE);
    const artifacts = await loadModel(root);
    const spec = findByRef(artifacts, '042');

    const moved = await moveArtifact(root, spec, 'archived');
    assert.equal(moved.state, 'archived');
    assert.equal(moved.model.meta, 'specs/archive/042-login.json');

    const reloaded = await loadModel(root);
    assert.equal(reloaded.filter((artifact) => artifact.kind === 'spec').length, 1);
    assert.equal(findByRef(reloaded, '042').state, 'archived');
  } finally {
    await cleanup(root);
  }
});

test('saveArtifact prunes the previous location when the path changes', async () => {
  const root = await makeWorkspace();
  try {
    const meta = createMeta({ kind: 'spec', slug: '042-login', state: 'planned' });
    const first = await saveArtifact(root, meta, 'body');
    const second = await saveArtifact(root, { ...meta, state: 'active' }, 'body', { previous: first });

    assert.equal(second.meta, 'specs/active/042-login.json');
    const artifacts = await loadModel(root);
    assert.equal(artifacts.length, 1);
  } finally {
    await cleanup(root);
  }
});

test('loadModel ignores an empty or missing model directory', async () => {
  const root = await makeWorkspace();
  try {
    assert.deepEqual(await loadModel(root), []);
    await writeFiles(root, { '.specs/model/README.md': 'nothing here\n' });
    assert.deepEqual(await loadModel(root), []);
  } finally {
    await cleanup(root);
  }
});
