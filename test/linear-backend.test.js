import test from 'node:test';
import assert from 'node:assert/strict';
import createLinearBackend from '../src/backends/linear.js';
import { BackendError } from '../src/core/errors.js';

const SETTINGS = {
  teamKey: 'ENG',
  stateMap: { planned: 'Backlog', active: 'In Progress', archived: 'Done' },
  labels: { spec: 'spec' },
  createOnMove: false,
  apiKey: 'test-key',
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
    title: 'Magic link',
    state: { id: 'st-1', name: 'Backlog' },
    labels: { nodes: [] },
  },
};

/** Installs a deterministic fetch mock; returns the captured GraphQL calls. */
function mockFetch(handlers) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    return { ok: true, status: 200, json: async () => ({ data: handlers(body) }), text: async () => '{}' };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function backend(overrides = {}) {
  return createLinearBackend({
    backendConfig: { id: 'linear', type: 'linear', settings: { ...SETTINGS, ...overrides } },
  });
}

const artifact = {
  kind: 'spec',
  id: '042',
  slug: '042-login',
  title: 'Magic link',
  state: 'planned',
  relations: { feature: '01-login' },
  remote: {},
  body: '## 1. Intent\n',
  model: { directory: 'specs/planned', meta: 'specs/planned/042-login.json', body: 'specs/planned/042-login.md' },
  projection: 'specs/planned/042-login.md',
};

test('transition requires an API key', async () => {
  const instance = createLinearBackend({
    backendConfig: { id: 'linear', type: 'linear', settings: { ...SETTINGS, apiKey: undefined } },
  });
  const previous = process.env.LINEAR_API_KEY;
  delete process.env.LINEAR_API_KEY;
  try {
    await assert.rejects(() => instance.transition(artifact, 'active', {}), BackendError);
  } finally {
    if (previous !== undefined) process.env.LINEAR_API_KEY = previous;
  }
});

test('transition refuses to move an unlinked artifact when createOnMove is off', async () => {
  const { restore } = mockFetch(() => TEAM);
  try {
    await assert.rejects(() => backend().transition(artifact, 'active', {}), BackendError);
  } finally {
    restore();
  }
});

test('transition updates the linked issue state and returns its reference', async () => {
  const { calls, restore } = mockFetch((body) => {
    if (body.query.includes('SpecFrameworkIssue(')) return ISSUE;
    if (body.query.includes('SpecFrameworkTeam')) return TEAM;
    if (body.query.includes('SpecFrameworkIssueUpdate')) {
      return { issueUpdate: { success: true, issue: { id: 'uuid-1', identifier: 'ENG-142', state: { id: 'st-2', name: 'In Progress' } } } };
    }
    return {};
  });

  try {
    const linked = { ...artifact, remote: { linear: 'ENG-142' } };
    const result = await backend().transition(linked, 'active', {});
    assert.equal(result.moved, true);
    assert.equal(result.remoteRef, 'ENG-142');
    assert.equal(result.state, 'In Progress');

    const update = calls.find((call) => call.query.includes('SpecFrameworkIssueUpdate'));
    assert.deepEqual(update.variables, { id: 'uuid-1', input: { stateId: 'st-2' } });
  } finally {
    restore();
  }
});

test('transition is idempotent when the issue already sits in the target state', async () => {
  const { calls, restore } = mockFetch((body) => {
    if (body.query.includes('SpecFrameworkIssue(')) {
      return { issue: { ...ISSUE.issue, state: { id: 'st-2', name: 'In Progress' } } };
    }
    return TEAM;
  });

  try {
    const linked = { ...artifact, remote: { linear: 'ENG-142' } };
    const result = await backend().transition(linked, 'active', {});
    assert.equal(result.moved, false);
    assert.equal(calls.some((call) => call.query.includes('IssueUpdate')), false);
  } finally {
    restore();
  }
});

test('create issues an item and returns its identifier without mutating the artifact', async () => {
  const { calls, restore } = mockFetch((body) => {
    if (body.query.includes('SpecFrameworkTeam')) return TEAM;
    if (body.query.includes('SpecFrameworkIssueCreate')) {
      return { issueCreate: { success: true, issue: { id: 'uuid-9', identifier: 'ENG-999', title: 'Magic link' } } };
    }
    return {};
  });

  try {
    const result = await backend().create(artifact, {});
    assert.equal(result.created, true);
    assert.equal(result.remoteRef, 'ENG-999');
    assert.equal(artifact.remote.linear, undefined);

    const create = calls.find((call) => call.query.includes('SpecFrameworkIssueCreate'));
    assert.equal(create.variables.input.teamId, 'team-1');
    assert.equal(create.variables.input.stateId, 'st-1');
    assert.deepEqual(create.variables.input.labelIds, ['lb-1']);
    assert.match(create.variables.input.description, /\.sdd\//);
  } finally {
    restore();
  }
});

test('create is a no-op when the artifact is already linked', async () => {
  const { restore } = mockFetch(() => TEAM);
  try {
    const linked = { ...artifact, remote: { linear: 'ENG-142' } };
    const result = await backend().create(linked, {});
    assert.deepEqual(result, { created: false, remoteRef: 'ENG-142' });
  } finally {
    restore();
  }
});

test('dryRun never calls the Linear API for updates', async () => {
  const { calls, restore } = mockFetch((body) => (body.query.includes('SpecFrameworkIssue(') ? ISSUE : TEAM));
  try {
    const linked = { ...artifact, remote: { linear: 'ENG-142' } };
    const result = await backend().transition(linked, 'active', { dryRun: true });
    assert.equal(result.planned, true);
    assert.equal(calls.some((call) => call.query.includes('IssueUpdate')), false);
  } finally {
    restore();
  }
});

test('resolve recognises Linear identifiers only', async () => {
  const { restore } = mockFetch(() => ISSUE);
  try {
    const resolved = await backend().resolve('ENG-142');
    assert.equal(resolved.id, 'ENG-142');
    assert.equal(resolved.state, 'Backlog');
    assert.equal(await backend().resolve('042-login'), null);
  } finally {
    restore();
  }
});

test('link reports that Linear relations are not managed', async () => {
  const result = await backend().link({ child: artifact, parent: artifact, relation: 'spec-of-feature' });
  assert.equal(result.skipped, true);
});