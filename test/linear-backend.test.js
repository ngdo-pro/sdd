import test from 'node:test';
import assert from 'node:assert/strict';
import createLinearBackend from '../src/backends/linear.js';
import { BackendError } from '../src/core/errors.js';

const SETTINGS = {
  teamKey: 'ENG',
  stateMap: { planned: 'Backlog', active: 'In Progress', archived: 'Done' },
  labels: { spec: 'spec' },
  createOnMove: false,
};

const TEAM = {
  teams: {
    nodes: [{
      id: 'team-1',
      key: 'ENG',
      name: 'Engineering',
      states: { nodes: [
        { id: 'st-1', name: 'Backlog' },
        { id: 'st-2', name: 'In Progress' },
        { id: 'st-3', name: 'Done' },
      ] },
      labels: { nodes: [{ id: 'lb-1', name: 'spec' }] },
    }],
  },
};

const ISSUE = {
  issue: {
    id: 'uuid-1',
    identifier: 'ENG-142',
    title: 'Login',
    state: { id: 'st-1', name: 'Backlog' },
    labels: { nodes: [] },
  },
};

/** Installs a deterministic fetch mock; returns the captured queries. */
function mockFetch(handlers) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    const data = handlers(body);
    return { ok: true, status: 200, json: async () => ({ data }), text: async () => JSON.stringify({ data }) };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const artifact = { kind: 'spec', id: '042', slug: '042-login', title: 'Login', state: 'planned', path: '.specs/specs/planned/042-login.md' };

test('transition requires an API key', async () => {
  const backend = createLinearBackend({
    backendConfig: { id: 'linear', type: 'linear', settings: { ...SETTINGS, apiKey: undefined } },
  });
  await assert.rejects(() => backend.transition(artifact, 'active', { remoteMap: {} }), BackendError);
});

test('transition refuses to move an unlinked artifact when createOnMove is off', async () => {
  const backend = createLinearBackend({
    backendConfig: { id: 'linear', type: 'linear', settings: { ...SETTINGS, apiKey: 'k' } },
  });
  const { restore } = mockFetch(() => TEAM);
  try {
    await assert.rejects(
      () => backend.transition(artifact, 'active', { remoteMap: {} }),
      BackendError,
    );
  } finally {
    restore();
  }
});

test('transition updates the linked Linear issue state', async () => {
  const backend = createLinearBackend({
    backendConfig: { id: 'linear', type: 'linear', settings: { ...SETTINGS, apiKey: 'k' } },
  });
  const { calls, restore } = mockFetch((body) => {
    if (body.query.includes('SpecFrameworkIssue(')) return ISSUE;
    if (body.query.includes('SpecFrameworkTeam')) return TEAM;
    if (body.query.includes('SpecFrameworkIssueUpdate')) {
      return { issueUpdate: { success: true, issue: { id: 'uuid-1', identifier: 'ENG-142', state: { id: 'st-2', name: 'In Progress' } } } };
    }
    return {};
  });

  try {
    const remoteMap = { [artifact.path]: { linear: 'ENG-142' } };
    const result = await backend.transition(artifact, 'active', { remoteMap });
    assert.equal(result.moved, true);
    assert.equal(result.remoteRef, 'ENG-142');
    const update = calls.find((call) => call.query.includes('SpecFrameworkIssueUpdate'));
    assert.deepEqual(update.variables, { id: 'uuid-1', input: { stateId: 'st-2' } });
  } finally {
    restore();
  }
});

test('transition is idempotent when the issue already sits in the target state', async () => {
  const backend = createLinearBackend({
    backendConfig: { id: 'linear', type: 'linear', settings: { ...SETTINGS, apiKey: 'k' } },
  });
  const { calls, restore } = mockFetch((body) => {
    if (body.query.includes('SpecFrameworkIssue(')) {
      return { issue: { ...ISSUE.issue, state: { id: 'st-2', name: 'In Progress' } } };
    }
    return TEAM;
  });

  try {
    const remoteMap = { [artifact.path]: { linear: 'ENG-142' } };
    const result = await backend.transition(artifact, 'active', { remoteMap });
    assert.equal(result.moved, false);
    assert.equal(calls.some((call) => call.query.includes('IssueUpdate')), false);
  } finally {
    restore();
  }
});

test('create issues and records the remote mapping', async () => {
  const backend = createLinearBackend({
    backendConfig: { id: 'linear', type: 'linear', settings: { ...SETTINGS, apiKey: 'k' } },
  });
  const { calls, restore } = mockFetch((body) => {
    if (body.query.includes('SpecFrameworkTeam')) return TEAM;
    if (body.query.includes('SpecFrameworkIssueCreate')) {
      return { issueCreate: { success: true, issue: { id: 'uuid-9', identifier: 'ENG-999', title: 'Login' } } };
    }
    return {};
  });

  try {
    const remoteMap = {};
    const result = await backend.create(artifact, { remoteMap });
    assert.equal(result.created, true);
    assert.equal(result.remoteRef, 'ENG-999');
    assert.equal(remoteMap[artifact.path].linear, 'ENG-999');

    const create = calls.find((call) => call.query.includes('SpecFrameworkIssueCreate'));
    assert.equal(create.variables.input.teamId, 'team-1');
    assert.equal(create.variables.input.stateId, 'st-1');
    assert.deepEqual(create.variables.input.labelIds, ['lb-1']);
  } finally {
    restore();
  }
});

test('dryRun never calls the Linear API for updates', async () => {
  const backend = createLinearBackend({
    backendConfig: { id: 'linear', type: 'linear', settings: { ...SETTINGS, apiKey: 'k' } },
  });
  const { calls, restore } = mockFetch((body) => (body.query.includes('SpecFrameworkIssue(') ? ISSUE : TEAM));
  try {
    const remoteMap = { [artifact.path]: { linear: 'ENG-142' } };
    const result = await backend.transition(artifact, 'active', { remoteMap, dryRun: true });
    assert.equal(result.planned, true);
    assert.equal(calls.some((call) => call.query.includes('IssueUpdate')), false);
  } finally {
    restore();
  }
});
