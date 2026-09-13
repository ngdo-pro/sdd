import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDocument, renderGeneratedSections, linkTarget } from '../src/render/markdown.js';
import { renderProjections } from '../src/render/projections.js';
import { buildGraph } from '../src/model/graph.js';
import { loadModel } from '../src/model/store.js';
import { makeWorkspace, cleanup, seedModel, readWorkspaceFile, MODEL_FIXTURE } from './helpers.js';

test('linkTarget produces document-relative POSIX links', () => {
  assert.equal(linkTarget('generated/initiatives/demo/specs/042-a.md', 'generated/initiatives/demo/specs/043-b.md'), './043-b.md');
  assert.equal(
    linkTarget('generated/initiatives/demo/features/01-a.md', 'generated/initiatives/demo/specs/042-a.md'),
    '../specs/042-a.md',
  );
});

test('spec documents render a title and a Metadata block', () => {
  const artifact = {
    kind: 'spec',
    id: '042',
    slug: '042-login',
    title: 'Magic link',
    state: 'active',
    fields: { Domain: '`.sdd/knowledge/domains/auth/`' },
    relations: { feature: '01-login' },
    body: '## 1. Intent\n\nAdd login.',
    projection: 'generated/initiatives/demo/specs/042.md',
  };
  const rendered = renderDocument(artifact, buildGraph([artifact]));
  assert.match(rendered, /^# Spec: 042 - Magic link/m);
  assert.match(rendered, /\* \*\*Domain:\*\* `\.sdd\/knowledge\/domains\/auth\/`/);
  assert.match(rendered, /\* \*\*Feature:\*\* `01-login`/);
  assert.match(rendered, /## 1\. Intent\n\nAdd login\./);
});

test('feature documents render the generated spec list from relations', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, MODEL_FIXTURE);
    const graph = buildGraph(await loadModel(root));
    const feature = graph.bySlug.get('01-login');
    const rendered = renderDocument(feature, graph);

    assert.match(rendered, /## 6\. Implementation Spec\(s\)/);
    assert.match(rendered, /- \[ \] \*\*`042-login`\*\* : Magic link/);
    // Flattened generated tree: the spec lives at the initiative level.
    assert.match(rendered, /\(\.\.\/specs\/042\.md\)/);
  } finally {
    await cleanup(root);
  }
});

test('the checkbox reflects derived completion', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, [
      MODEL_FIXTURE[0],
      MODEL_FIXTURE[1],
      { ...MODEL_FIXTURE[2], progress: { done: true } },
    ]);
    const graph = buildGraph(await loadModel(root));
    const rendered = renderDocument(graph.bySlug.get('01-login'), graph);
    assert.match(rendered, /- \[x\] \*\*`042-login`\*\*/);
  } finally {
    await cleanup(root);
  }
});

test('initiative documents render the feature roadmap', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, MODEL_FIXTURE);
    const graph = buildGraph(await loadModel(root));
    const rendered = renderDocument(graph.bySlug.get('demo'), graph);
    assert.match(rendered, /## 4\. Feature Roadmap/);
    assert.match(rendered, /- \[ \] \*\*`01-login`\*\*: Login/);
    // Flattened generated tree: features live directly under the initiative.
    assert.match(rendered, /\(\.\/features\/01-login\.md\)/);
  } finally {
    await cleanup(root);
  }
});

test('vision documents group initiatives by state', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, [
      { kind: 'vision', slug: 'vision', title: 'Demo', body: '## 1. Core Purpose\n\nDemo.' },
      { kind: 'initiative', slug: 'now', title: 'Now', state: 'active' },
      { kind: 'initiative', slug: 'later', title: 'Later', state: 'planned' },
    ]);
    const graph = buildGraph(await loadModel(root));
    const rendered = renderDocument(graph.bySlug.get('vision'), graph);
    assert.match(rendered, /### 🚀 Active Initiatives[\s\S]*`now`/);
    assert.match(rendered, /### 🎯 Planned Initiatives[\s\S]*`later`/);
  } finally {
    await cleanup(root);
  }
});

test('generated sections are empty for specs', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, MODEL_FIXTURE);
    const graph = buildGraph(await loadModel(root));
    assert.equal(renderGeneratedSections(graph.bySlug.get('042-login'), graph), '');
  } finally {
    await cleanup(root);
  }
});

test('renderProjections writes files and reports drift under check', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, MODEL_FIXTURE);
    const artifacts = await loadModel(root);

    const first = await renderProjections(root, artifacts);
    assert.equal(first.every((entry) => entry.status === 'created'), true);

    const content = await readWorkspaceFile(root, '.sdd/generated/initiatives/demo/README.md');
    assert.match(content, /# Initiative: Demo/);

    const clean = await renderProjections(root, artifacts, { check: true });
    assert.equal(clean.every((entry) => entry.status === 'unchanged'), true);
  } finally {
    await cleanup(root);
  }
});
