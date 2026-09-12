import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listSpecs,
  listInitiatives,
  listFeatures,
  resolveArtifact,
  classifyRelativePath,
} from '../src/core/artifact.js';
import { ResolutionError } from '../src/core/errors.js';
import { FIXTURES, makeWorkspace, writeFiles, cleanup } from './helpers.js';

async function withWorkspace(callback) {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, FIXTURES);
    await callback(root);
  } finally {
    await cleanup(root);
  }
}

test('listSpecs discovers specs across states', async () => {
  await withWorkspace(async (root) => {
    const specs = await listSpecs(root);
    assert.deepEqual(
      specs.map((spec) => [spec.id, spec.state]).sort(),
      [['042', 'planned'], ['043', 'active']],
    );
    assert.equal(specs[0].slug, '042-login');
    assert.equal(specs[0].title, 'Spec: 042 - Login');
  });
});

test('listInitiatives and listFeatures walk the initiative tree', async () => {
  await withWorkspace(async (root) => {
    const [initiative] = await listInitiatives(root);
    assert.equal(initiative.slug, 'demo');
    assert.equal(initiative.state, 'planned');

    const [feature] = await listFeatures(root);
    assert.equal(feature.slug, '01-login');
    assert.equal(feature.state, 'planned');
    assert.equal(feature.meta.initiative, 'demo');
  });
});

test('resolveArtifact understands IDs, padded IDs, slugs and paths', async () => {
  await withWorkspace(async (root) => {
    assert.equal((await resolveArtifact(root, '042')).slug, '042-login');
    assert.equal((await resolveArtifact(root, '42')).slug, '042-login');
    assert.equal((await resolveArtifact(root, '042-login')).slug, '042-login');
    assert.equal((await resolveArtifact(root, '01-login')).kind, 'feature');
    assert.equal(
      (await resolveArtifact(root, '.specs/specs/active/043-signup.md')).slug,
      '043-signup',
    );
  });
});

test('resolveArtifact reports unknown and ambiguous references', async () => {
  await withWorkspace(async (root) => {
    await assert.rejects(() => resolveArtifact(root, '999'), ResolutionError);
    await writeFiles(root, { '.specs/specs/archive/900-login.md': '# Spec: 900 - Login\n' });
    // `login` now matches both 042-login and 900-login → ambiguous.
    await assert.rejects(() => resolveArtifact(root, 'login'), ResolutionError);
    assert.equal((await resolveArtifact(root, '900-login')).id, '900');
    assert.equal((await resolveArtifact(root, 'signup')).slug, '043-signup');
  });
});

test('classifyRelativePath maps each layout family', async () => {
  await withWorkspace(async (root) => {
    assert.equal((await classifyRelativePath(root, '.specs/vision.md')).kind, 'vision');
    assert.equal((await classifyRelativePath(root, '.specs/specs/planned/042-login.md')).state, 'planned');
    assert.equal((await classifyRelativePath(root, '.specs/initiatives/planned/demo/README.md')).kind, 'initiative');
    assert.equal((await classifyRelativePath(root, '.specs/initiatives/planned/demo/planned/01-login.md')).kind, 'feature');
    assert.equal(await classifyRelativePath(root, '.specs/unknown/thing.md'), null);
  });
});
