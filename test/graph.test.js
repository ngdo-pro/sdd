import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, cascadeCandidates, parentSlugOf } from '../src/model/graph.js';
import { loadModel, moveArtifact } from '../src/model/store.js';
import { makeWorkspace, cleanup, seedModel, MODEL_FIXTURE } from './helpers.js';

async function graphFixture(root, specDone) {
  await seedModel(root, [
    MODEL_FIXTURE[0],
    MODEL_FIXTURE[1],
    { ...MODEL_FIXTURE[2], progress: { done: specDone } },
  ]);
  return buildGraph(await loadModel(root));
}

test('parentSlugOf encodes the artefact hierarchy', () => {
  assert.equal(parentSlugOf({ kind: 'spec', relations: { feature: 'f' } }), 'f');
  assert.equal(parentSlugOf({ kind: 'feature', relations: { initiative: 'i' } }), 'i');
  assert.equal(parentSlugOf({ kind: 'initiative', relations: {} }), null);
  assert.equal(parentSlugOf({ kind: 'vision' }), null);
});

test('children are returned ordered by slug', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, [
      MODEL_FIXTURE[0],
      { kind: 'feature', slug: '02-b', title: 'B', relations: { initiative: 'demo' } },
      { kind: 'feature', slug: '01-a', title: 'A', relations: { initiative: 'demo' } },
    ]);
    const graph = buildGraph(await loadModel(root));
    assert.deepEqual(graph.children('demo').map((child) => child.slug), ['01-a', '02-b']);
  } finally {
    await cleanup(root);
  }
});

test('completion is derived from the leaf progress flag', async () => {
  const root = await makeWorkspace();
  try {
    const incomplete = await graphFixture(root, false);
    assert.equal(incomplete.isComplete(incomplete.bySlug.get('042-login')), false);
    assert.equal(incomplete.isComplete(incomplete.bySlug.get('01-login')), false);

    const progress = incomplete.progressOf('demo');
    assert.equal(progress.children, 1);
    assert.equal(progress.completed, 0);
    assert.equal(progress.complete, false);
  } finally {
    await cleanup(root);
  }
});

test('completing every leaf marks the whole chain complete', async () => {
  const root = await makeWorkspace();
  try {
    const graph = await graphFixture(root, true);
    assert.equal(graph.isComplete(graph.bySlug.get('042-login')), true);
    assert.equal(graph.isComplete(graph.bySlug.get('01-login')), true);
    assert.equal(graph.isComplete(graph.bySlug.get('demo')), true);
    assert.equal(graph.progressOf('demo').complete, true);
  } finally {
    await cleanup(root);
  }
});

test('an archived artefact always counts as complete', async () => {
  const root = await makeWorkspace();
  try {
    const graph = await graphFixture(root, false);
    const spec = graph.bySlug.get('042-login');
    const moved = await moveArtifact(root, spec, 'archived');
    const reloaded = buildGraph(await loadModel(root));
    assert.equal(reloaded.isComplete(reloaded.bySlug.get(moved.slug)), true);
  } finally {
    await cleanup(root);
  }
});

test('cascadeCandidates returns every unfinished parent whose children are complete', async () => {
  const root = await makeWorkspace();
  try {
    const graph = await graphFixture(root, true);
    const slugs = cascadeCandidates(graph).map((entry) => entry.artifact.slug).sort();
    assert.deepEqual(slugs, ['01-login', 'demo']);
  } finally {
    await cleanup(root);
  }
});

test('cascadeCandidates includes parents that were never explicitly activated', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, [
      { kind: 'initiative', slug: 'demo', title: 'Demo', state: 'planned' },
      { kind: 'feature', slug: '01-login', title: 'Login', state: 'planned', relations: { initiative: 'demo' } },
      {
        kind: 'spec',
        slug: '042-login',
        title: 'Magic link',
        state: 'active',
        relations: { feature: '01-login', initiative: 'demo' },
        progress: { done: true },
      },
    ]);
    const slugs = cascadeCandidates(buildGraph(await loadModel(root))).map((entry) => entry.artifact.slug).sort();
    assert.deepEqual(slugs, ['01-login', 'demo']);
  } finally {
    await cleanup(root);
  }
});

test('cascadeCandidates ignores parents whose children are unfinished', async () => {
  const root = await makeWorkspace();
  try {
    const graph = await graphFixture(root, false);
    assert.deepEqual(cascadeCandidates(graph), []);
  } finally {
    await cleanup(root);
  }
});

test('cascadeCandidates never considers the vision or leafless parents', async () => {
  const root = await makeWorkspace();
  try {
    const graph = await graphFixture(root, true);
    const vision = graph.bySlug.get('vision');
    assert.equal(vision, undefined);
    assert.equal(graph.children('042-login').length, 0);
  } finally {
    await cleanup(root);
  }
});
