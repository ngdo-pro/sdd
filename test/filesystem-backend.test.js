import test from 'node:test';
import assert from 'node:assert/strict';
import createFilesystemBackend, { computeTransitionPath, insertEntry } from '../src/backends/filesystem.js';
import { resolveArtifact } from '../src/core/artifact.js';
import { TransitionError, BackendError } from '../src/core/errors.js';
import { FIXTURES, makeWorkspace, writeFiles, readWorkspaceFile, fileExists, cleanup } from './helpers.js';

async function withBackend(callback) {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, FIXTURES);
    await callback(root, createFilesystemBackend({ cwd: root }));
  } finally {
    await cleanup(root);
  }
}

test('transition moves a spec between state directories', async () => {
  await withBackend(async (root, backend) => {
    const artifact = await resolveArtifact(root, '042');
    const result = await backend.transition(artifact, 'active');

    assert.equal(result.moved, true);
    assert.equal(result.to, '.specs/specs/active/042-login.md');
    assert.equal(await fileExists(root, '.specs/specs/planned/042-login.md'), false);
    assert.equal(await fileExists(root, '.specs/specs/active/042-login.md'), true);
  });
});

test('transition moves a feature within its initiative tree', async () => {
  await withBackend(async (root, backend) => {
    const artifact = await resolveArtifact(root, '01-login', { kind: 'feature' });
    const result = await backend.transition(artifact, 'active');

    assert.equal(result.to, '.specs/initiatives/planned/demo/active/01-login.md');
    assert.equal(await fileExists(root, '.specs/initiatives/planned/demo/active/01-login.md'), true);
  });
});

test('transition refreshes the Status header when present', async () => {
  await withBackend(async (root, backend) => {
    const artifact = await resolveArtifact(root, '01-login', { kind: 'feature' });
    await backend.transition(artifact, 'active');
    const content = await readWorkspaceFile(root, '.specs/initiatives/planned/demo/active/01-login.md');
    assert.match(content, /> \*\*Status:\*\* Active/);
  });
});

test('transition is a no-op when already in the target state', async () => {
  await withBackend(async (root, backend) => {
    const artifact = await resolveArtifact(root, '042');
    assert.deepEqual(await backend.transition(artifact, 'planned'), { moved: false });
  });
});

test('transition rejects illegal moves', async () => {
  await withBackend(async (root, backend) => {
    let artifact = await resolveArtifact(root, '042');
    await backend.transition(artifact, 'active');
    artifact = await resolveArtifact(root, '042');
    await backend.transition(artifact, 'archived');
    artifact = await resolveArtifact(root, '042');
    await assert.rejects(() => backend.transition(artifact, 'planned'), TransitionError);
  });
});

test('dryRun previews without writing', async () => {
  await withBackend(async (root, backend) => {
    const artifact = await resolveArtifact(root, '042');
    const result = await backend.transition(artifact, 'active', { dryRun: true });
    assert.equal(result.planned, true);
    assert.equal(await fileExists(root, '.specs/specs/planned/042-login.md'), true);
    assert.equal(await fileExists(root, '.specs/specs/active/042-login.md'), false);
  });
});

test('link registers a spec in the parent feature Section 6', async () => {
  await withBackend(async (root, backend) => {
    const child = await resolveArtifact(root, '042', { kind: 'spec' });
    const parent = await resolveArtifact(root, '01-login', { kind: 'feature' });
    const result = await backend.link({ child, parent, relation: 'spec-of-feature' });

    assert.equal(result.linked, true);
    const content = await readWorkspaceFile(root, parent.path);
    assert.match(content, /042-login/);
    assert.doesNotMatch(content, /No execution specs linked yet/);
  });
});

test('link is idempotent', async () => {
  await withBackend(async (root, backend) => {
    const child = await resolveArtifact(root, '042', { kind: 'spec' });
    const parent = await resolveArtifact(root, '01-login', { kind: 'feature' });
    await backend.link({ child, parent, relation: 'spec-of-feature' });
    const second = await backend.link({ child, parent, relation: 'spec-of-feature' });
    assert.equal(second.alreadyLinked, true);
  });
});

test('link rejects an unsupported relation', async () => {
  await withBackend(async (root, backend) => {
    const child = await resolveArtifact(root, '042');
    const parent = await resolveArtifact(root, '01-login', { kind: 'feature' });
    await assert.rejects(() => backend.link({ child, parent, relation: 'nope' }), BackendError);
  });
});

test('computeTransitionPath maps each kind to the right segment', () => {
  assert.equal(
    computeTransitionPath({ kind: 'spec', path: '.specs/specs/planned/042-login.md' }, 'archived'),
    '.specs/specs/archive/042-login.md',
  );
  assert.equal(
    computeTransitionPath({ kind: 'initiative', path: '.specs/initiatives/planned/demo/README.md' }, 'active'),
    '.specs/initiatives/active/demo/README.md',
  );
  assert.equal(
    computeTransitionPath({ kind: 'feature', path: '.specs/initiatives/active/demo/planned/01-a.md' }, 'archived'),
    '.specs/initiatives/active/demo/archive/01-a.md',
  );
});

test('insertEntry replaces a placeholder and preserves trailing section content', () => {
  const content = '## 6. Implementation Spec(s)\n\n*No execution specs linked yet.*\n\n## 7. Next\n\nbody\n';
  const updated = insertEntry(content, {
    heading: '## 6. Implementation Spec(s)',
    placeholders: ['*No execution specs linked yet.*'],
    lines: ['- [ ] **`042-login`** : Login'],
  });
  assert.match(updated, /042-login/);
  assert.doesNotMatch(updated, /No execution specs/);
  assert.match(updated, /## 7\. Next\n\nbody/);
  assert.equal(insertEntry(content, { heading: '## 9. Missing', lines: ['x'] }), null);
});
