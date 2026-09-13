import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeta, normalizeMeta, serializeMeta, slugify, deriveId } from '../src/model/schema.js';
import { modelRelativePaths, projectionRelativePath } from '../src/model/layout.js';

test('slugify produces portable slugs', () => {
  assert.equal(slugify('Magic Link Login!'), 'magic-link-login');
  assert.equal(slugify('  Éàç  '), 'eac');
  assert.equal(slugify(''), 'untitled');
});

test('deriveId extracts the numeric id for specs only', () => {
  assert.equal(deriveId('spec', '042-login'), '042');
  assert.equal(deriveId('spec', '1042-beyond'), '1042');
  assert.equal(deriveId('feature', '01-login'), '01-login');
  assert.equal(deriveId('spec', 'login'), null);
});

test('createMeta applies sane defaults and preserves the spec id', () => {
  const meta = createMeta({ kind: 'spec', slug: '042-login', title: 'Magic link' });
  assert.equal(meta.id, '042');
  assert.equal(meta.state, 'planned');
  assert.deepEqual(meta.remote, {});
  assert.equal(meta.progress.done, false);
  assert.equal(meta.version, 3);
});

test('createMeta rejects spec slugs without a 3- or 4-digit prefix', () => {
  assert.throws(() => createMeta({ kind: 'spec', slug: 'login' }));
  assert.throws(() => createMeta({ kind: 'spec', slug: '42-short' }));
  assert.throws(() => createMeta({ kind: 'spec', slug: '10442-long' }));
});

test('createMeta keeps vision stateless', () => {
  assert.equal(createMeta({ kind: 'vision', slug: 'vision' }).state, null);
});

test('serializeMeta drops runtime-only keys', () => {
  const meta = createMeta({ kind: 'feature', slug: '01-login', relations: { initiative: 'demo' } });
  const stored = serializeMeta({ ...meta, body: 'x', model: {}, projection: 'y' });
  assert.equal('body' in stored, false);
  assert.equal('model' in stored, false);
  assert.equal('projection' in stored, false);
  assert.equal(stored.relations.initiative, 'demo');
});

test('normalizeMeta tolerates partial input', () => {
  const meta = normalizeMeta({ kind: 'spec', slug: '042-a', title: 'A' }, '042-a');
  assert.equal(meta.state, 'planned');
  assert.equal(meta.version, 3);
});

test('layout maps every kind to stateless canonical paths and generated/ projections', () => {
  const vision = createMeta({ kind: 'vision', slug: 'vision' });
  assert.equal(projectionRelativePath(vision), 'generated/vision.md');

  const spec = createMeta({
    kind: 'spec',
    slug: '042-login',
    state: 'active',
    relations: { feature: '01-login', initiative: 'demo' },
  });
  assert.deepEqual(modelRelativePaths(spec), {
    dir: 'initiatives/demo/features/01-login/specs',
    meta: 'initiatives/demo/features/01-login/specs/042.json',
    body: 'initiatives/demo/features/01-login/specs/042.md',
  });
  // Flat under the initiative, file name = bare id — no state segment.
  assert.equal(projectionRelativePath(spec), 'generated/initiatives/demo/specs/042.md');

  const initiative = createMeta({ kind: 'initiative', slug: 'demo', state: 'planned' });
  assert.equal(modelRelativePaths(initiative).meta, 'initiatives/demo/demo.json');
  assert.equal(projectionRelativePath(initiative), 'generated/initiatives/demo/README.md');

  const feature = createMeta({ kind: 'feature', slug: '01-login', state: 'archived', relations: { initiative: 'demo' } });
  assert.equal(modelRelativePaths(feature).meta, 'initiatives/demo/features/01-login/01-login.json');
  assert.equal(projectionRelativePath(feature), 'generated/initiatives/demo/features/01-login.md');

  // The projection signature no longer threads any option.
  assert.equal(projectionRelativePath.length, 1);
});

test('layout requires relations for features and specs', () => {
  const feature = createMeta({ kind: 'feature', slug: '01-login' });
  assert.throws(() => modelRelativePaths(feature));
  assert.throws(() => projectionRelativePath(feature));

  const spec = createMeta({ kind: 'spec', slug: '042-a', relations: { feature: '01-b' } });
  assert.throws(() => modelRelativePaths(spec));
  assert.throws(() => projectionRelativePath(spec));
});
