import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeState,
  canTransition,
  assertTransition,
  stateDir,
  STATE_LABELS,
} from '../src/core/transitions.js';
import { TransitionError } from '../src/core/errors.js';

test('normalizeState accepts canonical and alias inputs', () => {
  assert.equal(normalizeState('planned'), 'planned');
  assert.equal(normalizeState('plan'), 'planned');
  assert.equal(normalizeState('Active'), 'active');
  assert.equal(normalizeState('archive'), 'archived');
  assert.equal(normalizeState('archived'), 'archived');
  assert.equal(normalizeState('nonsense'), null);
  assert.equal(normalizeState(undefined), null);
});

test('canTransition encodes the lifecycle graph', () => {
  assert.equal(canTransition('planned', 'active'), true);
  assert.equal(canTransition('active', 'archived'), true);
  assert.equal(canTransition('archived', 'active'), true);
  assert.equal(canTransition('planned', 'planned'), false);
  assert.equal(canTransition('archived', 'planned'), false);
});

test('assertTransition returns false for a no-op', () => {
  const artifact = { kind: 'spec', slug: '042-login', state: 'active' };
  assert.equal(assertTransition(artifact, 'active'), false);
});

test('assertTransition returns true for a legal move', () => {
  const artifact = { kind: 'spec', slug: '042-login', state: 'planned' };
  assert.equal(assertTransition(artifact, 'active'), true);
});

test('assertTransition rejects illegal moves and stateless artifacts', () => {
  assert.throws(
    () => assertTransition({ kind: 'spec', slug: '042', state: 'archived' }, 'planned'),
    TransitionError,
  );
  assert.throws(
    () => assertTransition({ kind: 'vision', slug: 'vision', state: null }, 'active'),
    TransitionError,
  );
});

test('stateDir maps states to on-disk directory names', () => {
  assert.equal(stateDir('planned'), 'planned');
  assert.equal(stateDir('active'), 'active');
  assert.equal(stateDir('archived'), 'archive');
});

test('STATE_LABELS exposes header labels', () => {
  assert.equal(STATE_LABELS.archived, 'Archived');
});
