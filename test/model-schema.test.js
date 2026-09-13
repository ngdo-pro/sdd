import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeta, normalizeMeta, serializeMeta, slugify, deriveId } from '../src/model/schema.js';
import { stateDirOf, modelRelativePaths, projectionRelativePath } from '../src/model/layout.js';

test('slugify produces portable slugs', () => {
  assert.equal(slugify('Magic Link Login!'), 'magic-link-login');
  assert.equal(slugify('  Éàç  '), 'eac');
  assert.equal(slugify(''), 'untitled');
});

test('deriveId extracts the numeric id for specs only', () => {
  assert.equal(deriveId('spec', '042-login'), '042');
  assert.equal(deriveId('feature', '01-login'), '01-login');
  assert.equal(deriveId('spec', 'login'), null);
});

test('createMeta applies sane defaults and preserves the spec id', () => {
  const meta = createMeta({ kind: 'spec', slug: '042-login', title: 'Magic link' });
  assert.equal(meta.id, '042');
  assert.equal(meta.state, 'planned');
  assert.deepEqual(meta.remote, {});
  assert.equal(meta.progress.done, false);
  assert.equal(meta.version, 2);
});

test('createMeta rejects spec slugs without a 3-digit prefix', () => {
  assert.throws(() => createMeta({ kind: 'spec', slug: 'login' }));
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
  assert.equal(meta.version, 2);
});

test('layout maps every kind to model and projection paths', () => {
  const spec = createMeta({ kind: 'spec', slug: '042-login', state: 'active' });
  assert.deepEqual(modelRelativePaths(spec), {
    dir: 'specs/active',
    meta: 'specs/active/042-login.json',
    body: 'specs/active/042-login.md',
  });
  assert.equal(projectionRelativePath(spec), 'specs/active/042-login.md');

  const initiative = createMeta({ kind: 'initiative', slug: 'demo', state: 'planned' });
  assert.equal(projectionRelativePath(initiative), 'initiatives/planned/demo/README.md');

  const feature = createMeta({ kind: 'feature', slug: '01-login', state: 'archived', relations: { initiative: 'demo' } });
  assert.equal(modelRelativePaths(feature, { initiativeState: 'active' }).meta, 'initiatives/active/demo/archive/01-login.json');
  assert.equal(projectionRelativePath(feature, { initiativeState: 'active' }), 'initiatives/active/demo/archive/01-login.md');
});

test('layout requires an initiative relation for features', () => {
  const feature = createMeta({ kind: 'feature', slug: '01-login' });
  assert.throws(() => projectionRelativePath(feature));
});

test('stateDirOf maps canonical states to directory names', () => {
  assert.equal(stateDirOf('archived'), 'archive');
  assert.equal(stateDirOf(null), null);
});
