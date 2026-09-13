import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDocument, renderGeneratedSections, linkTarget } from '../src/render/markdown.js';
import { renderProjections } from '../src/render/projections.js';
import { buildGraph } from '../src/model/graph.js';
import { loadModel } from '../src/model/store.js';
import { makeWorkspace, cleanup, seedModel, readWorkspaceFile, MODEL_FIXTURE } from './helpers.js';

test('linkTarget produces document-relative POSIX links', () => {
  assert.equal(linkTarget('specs/active/042-a.md', 'specs/active/043-b.md'), './043-b.md');
  assert.equal(
    linkTarget('initiatives/active/demo/README.md', 'initiatives/active/demo/planned/01-a.md'),
    './planned/01-a.md',
  );
});

test('spec documents render a title and a Metadata block', () => {
  const artifact = {
    kind: 'spec',
    id: '042',
    slug: '042-login',
    title: 'Magic link',
    state: 'active',
    fields: { Domain: '`.specs/knowledge/domains/auth/`' },
    relations: { feature: '01-login' },
    body: '## 1. Intent\n\nAdd login.',
    projection: 'specs/active/042-login.md',
  };
  const rendered = renderDocument(artifact, buildGraph([artifact]));
  assert.match(rendered, /^# Spec: 042 - Magic link/m);
  assert.match(rendered, /\* \*\*Domain:\*\* `\.specs\/knowledge\/domains\/auth\/`/);
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
    assert.match(rendered, /\(\.\.\/\.\.\/\.\.\/\.\.\/specs\/active\/042-login\.md\)/);
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
    // Interim v2 projections: features default to the `planned` initiative
    // segment (no initiative-state threading since the v3 layout).
    assert.match(rendered, /\(\.\.\/\.\.\/planned\/demo\/active\/01-login\.md\)/);
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

    const content = await readWorkspaceFile(root, '.specs/initiatives/active/demo/README.md');
    assert.match(content, /# Initiative: Demo/);

    const clean = await renderProjections(root, artifacts, { check: true });
    assert.equal(clean.every((entry) => entry.status === 'unchanged'), true);
  } finally {
    await cleanup(root);
  }
});
