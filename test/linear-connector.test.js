import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/cli/main.js';
import { validate } from '../src/cli/commands/validate.js';
import { loadModel } from '../src/model/store.js';
import createLinearBackend from '../src/connectors/linear.js';
import { ConnectorError, UsageError } from '../src/core/errors.js';
import { makeWorkspace, cleanup, seedModel, readWorkspaceFile, fileExists } from './helpers.js';

const FAKE_SERVER = fileURLToPath(new URL('./helpers/fake-mcp-server.js', import.meta.url));

const SETTINGS = {
  teamKey: 'ENG',
  stateMap: { planned: 'Backlog', active: 'In Progress', archived: 'Done' },
  labels: { initiative: 'initiative', feature: 'feature', spec: 'spec' },
  createOnMove: false,
};

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

const WORKSPACE_SEED = [
  { kind: 'initiative', slug: 'demo', title: 'Demo', state: 'active', body: '## 1. Intent\n\nDemo.\n' },
  { kind: 'feature', slug: '01-login', title: 'Login', state: 'active', relations: { initiative: 'demo' }, body: '## 1. Problem\n\nLogin.\n' },
  { kind: 'spec', slug: '042-magic-link', title: 'Magic link', state: 'planned', relations: { feature: '01-login', initiative: 'demo' }, body: '## 1. Intent\n\nMagic link.\n' },
];

/** Builds a stdio transport pointing at the fake Linear MCP server. */
function mcpTransport(serverArgs = []) {
  return { command: process.execPath, args: [FAKE_SERVER, ...serverArgs] };
}

function connector(overrides = {}, serverArgs = []) {
  return createLinearBackend({
    connectorConfig: {
      id: 'linear',
      type: 'linear',
      settings: { ...SETTINGS, mcp: mcpTransport(serverArgs), ...overrides },
    },
  });
}

/** Runs the real CLI (flag parsing included) while muting stdout. */
async function cli(args, root) {
  const original = process.stdout.write;
  process.stdout.write = () => true;
  try {
    return await run([...args, '--cwd', root]);
  } finally {
    process.stdout.write = original;
  }
}

/** Runs the real CLI capturing stdout (for report assertions). */
async function cliCaptured(args, root) {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    await run([...args, '--cwd', root]);
  } finally {
    process.stdout.write = original;
  }
  return chunks.join('');
}

/** Captures stdout while measuring `process.exitCode` (validate gate). */
async function capturingExitCode(handler) {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    process.exitCode = 0;
    await handler();
    return { output: chunks.join(''), exitCode: process.exitCode };
  } finally {
    process.stdout.write = original;
  }
}

/** Records the full .sdd/ tree (path → content) to detect any write. */
async function snapshotTree(root) {
  const snapshot = new Map();
  async function walk(directory, prefix) {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await walk(absolute, `${relative}/`);
      else snapshot.set(relative, await fsp.readFile(absolute, 'utf8'));
    }
  }
  await walk(path.join(root, '.sdd'), '.sdd/');
  return snapshot;
}

async function readLog(root, name = 'log.jsonl') {
  if (!(await fileExists(root, name))) return [];
  return (await readWorkspaceFile(root, name))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Writes the workspace config used by the CLI-level tests below. */
async function writeConfig(root, { createOnMove }) {
  const config = {
    version: 3,
    sourceOfTruth: 'model',
    projections: { markdown: true },
    connectors: [{
      id: 'linear',
      type: 'linear',
      enabled: true,
      settings: {
        teamKey: 'ENG',
        createOnMove,
        mcp: mcpTransport([
          `--state=${path.join(root, 'fake-state.json')}`,
          `--log=${path.join(root, 'log.jsonl')}`,
        ]),
      },
    }],
  };
  await fsp.writeFile(path.join(root, '.sdd', 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

// ============================================================================
// Unit Tests (@unit) — connector behavior over the fake MCP server
// ============================================================================

test('[U1][INV-3][INV-4] resolve recognises Linear identifiers only and returns null for unknown ones', async () => {
  const root = await makeWorkspace();
  try {
    const instance = connector({}, ['--issue=ENG-142|Backlog|Magic link', `--log=${path.join(root, 'log.jsonl')}`]);
    try {
      const resolved = await instance.resolve('ENG-142');
      assert.equal(resolved.id, 'ENG-142');
      assert.equal(resolved.state, 'Backlog');
      assert.equal(await instance.resolve('ENG-404'), null);
      // The regex gate rejects before any transport is created (INV-4: no spawn).
      assert.equal(await instance.resolve('042-login'), null);
      // Only the two identifier-shaped references reached the server.
      assert.deepEqual((await readLog(root)).map((entry) => entry.args.id), ['ENG-142', 'ENG-404']);
    } finally {
      await instance.close();
    }
  } finally {
    await cleanup(root);
  }
});

test('[U2][INV-3] list returns the team issues and filters them by kind label', async () => {
  const instance = connector({}, [
    '--issue=ENG-142|Backlog|Magic link|spec',
    '--issue=ENG-143|In Progress|Other|feature',
  ]);
  try {
    const issues = await instance.list();
    assert.deepEqual(issues.map((issue) => issue.id), ['ENG-142', 'ENG-143']);
    const specs = await instance.list({ kind: 'spec' });
    assert.deepEqual(specs.map((issue) => issue.id), ['ENG-142']);
  } finally {
    await instance.close();
  }
});

test('[U3][INV-3] transition updates the linked issue state and returns its reference', async () => {
  const root = await makeWorkspace();
  try {
    const instance = connector({}, ['--issue=ENG-142|Backlog|Magic link', `--state=${path.join(root, 'fake-state.json')}`]);
    try {
      const linked = { ...artifact, remote: { linear: 'ENG-142' } };
      const result = await instance.transition(linked, 'active', {});
      assert.deepEqual(result, { moved: true, remoteRef: 'ENG-142', state: 'In Progress' });

      const saved = JSON.parse(await readWorkspaceFile(root, 'fake-state.json'));
      assert.equal(saved.issues[0].state.name, 'In Progress');
    } finally {
      await instance.close();
    }
  } finally {
    await cleanup(root);
  }
});

test('[U4][INV-3] transition is idempotent when the issue already sits in the target state', async () => {
  const root = await makeWorkspace();
  try {
    const instance = connector({}, ['--issue=ENG-142|In Progress|Magic link', `--log=${path.join(root, 'log.jsonl')}`]);
    try {
      const linked = { ...artifact, remote: { linear: 'ENG-142' } };
      const result = await instance.transition(linked, 'active', {});
      assert.deepEqual(result, { moved: false, remoteRef: 'ENG-142', state: 'In Progress' });
      assert.equal((await readLog(root)).some((entry) => entry.tool === 'update_issue'), false);
    } finally {
      await instance.close();
    }
  } finally {
    await cleanup(root);
  }
});

test('[U5][INV-3] create issues an item and returns its identifier without mutating the artifact', async () => {
  const root = await makeWorkspace();
  try {
    const instance = connector({}, [`--state=${path.join(root, 'fake-state.json')}`, `--log=${path.join(root, 'log.jsonl')}`]);
    try {
      const result = await instance.create(artifact, {});
      assert.equal(result.created, true);
      assert.match(result.remoteRef, /^ENG-\d+$/);
      assert.equal(artifact.remote.linear, undefined);

      const saved = JSON.parse(await readWorkspaceFile(root, 'fake-state.json'));
      const created = saved.issues[0];
      assert.equal(created.title, 'Magic link');
      assert.equal(created.state.name, 'Backlog');
      assert.deepEqual(created.labels, ['spec']);
      assert.match(created.description, /\.sdd\//);
      assert.equal((await readLog(root))[0].tool, 'create_issue');
    } finally {
      await instance.close();
    }
  } finally {
    await cleanup(root);
  }
});

test('[U6][INV-3] create is a no-op when the artifact is already linked', async () => {
  const root = await makeWorkspace();
  try {
    const instance = connector({}, [`--log=${path.join(root, 'log.jsonl')}`]);
    try {
      const linked = { ...artifact, remote: { linear: 'ENG-142' } };
      const result = await instance.create(linked, {});
      assert.deepEqual(result, { created: false, remoteRef: 'ENG-142' });
      assert.equal(await fileExists(root, 'log.jsonl'), false); // no server contact at all
    } finally {
      await instance.close();
    }
  } finally {
    await cleanup(root);
  }
});

test('[U7][INV-3] dry-run reads but never writes remotely', async () => {
  const root = await makeWorkspace();
  try {
    const linkedInstance = connector({}, ['--issue=ENG-142|Backlog|Magic link', `--log=${path.join(root, 'linked.jsonl')}`]);
    try {
      const linked = { ...artifact, remote: { linear: 'ENG-142' } };
      const result = await linkedInstance.transition(linked, 'active', { dryRun: true });
      assert.deepEqual(result, { moved: false, planned: true, remoteRef: 'ENG-142', state: 'In Progress' });
      assert.deepEqual((await readLog(root, 'linked.jsonl')).map((entry) => entry.tool), ['get_issue']);
    } finally {
      await linkedInstance.close();
    }

    const plannedInstance = connector({ createOnMove: true }, [`--log=${path.join(root, 'planned.jsonl')}`]);
    try {
      const result = await plannedInstance.transition(artifact, 'active', { dryRun: true });
      assert.deepEqual(result, { moved: false, planned: true, action: 'create', state: 'In Progress' });
      assert.equal(await fileExists(root, 'planned.jsonl'), false); // not even a read
    } finally {
      await plannedInstance.close();
    }
  } finally {
    await cleanup(root);
  }
});

test('[U8][INV-2] the connector is inoperative without settings.mcp and invites /setup', async () => {
  const instance = createLinearBackend({
    connectorConfig: { id: 'linear', type: 'linear', settings: { ...SETTINGS, mcp: undefined } },
  });
  const linked = { ...artifact, remote: { linear: 'ENG-142' } };
  await assert.rejects(
    () => instance.transition(linked, 'active', {}),
    (error) => error instanceof ConnectorError
      && error.code === 'CONNECTOR_ERROR'
      && error.exitCode === 1
      && /no MCP transport configured — run \/setup/.test(error.message),
  );
  await assert.rejects(() => instance.resolve('ENG-142'), ConnectorError);
  await assert.rejects(() => instance.list(), ConnectorError);
});

test('[U9][INV-1][INV-2] a malformed settings.mcp shape is a UsageError, not a ConnectorError', async () => {
  const linked = { ...artifact, remote: { linear: 'ENG-142' } };
  const both = connector({ mcp: { command: 'node', args: ['x.js'], url: 'https://mcp.linear.app/sse' } });
  await assert.rejects(
    () => both.transition(linked, 'active', {}),
    (error) => error instanceof UsageError && error.exitCode === 2 && /not both/.test(error.message),
  );
  const badArgs = connector({ mcp: { command: 'node', args: 2 } });
  await assert.rejects(() => badArgs.transition(linked, 'active', {}), UsageError);
  await both.close();
});

test('[U10][INV-3] link reports that Linear relations are not managed', async () => {
  const instance = connector();
  const result = await instance.link({ child: artifact, parent: artifact, relation: 'spec-of-feature' });
  assert.equal(result.skipped, true);
  await instance.close();
});

test('[U11][INV-2] list without teamKey fails before contacting the transport', async () => {
  const root = await makeWorkspace();
  try {
    const instance = connector({ teamKey: '' }, [`--log=${path.join(root, 'log.jsonl')}`]);
    try {
      await assert.rejects(
        () => instance.list(),
        (error) => error instanceof ConnectorError && error.message.includes('requires settings.teamKey'),
      );
      assert.equal(await fileExists(root, 'log.jsonl'), false);
    } finally {
      await instance.close();
    }
  } finally {
    await cleanup(root);
  }
});

// ============================================================================
// Integration Test (@integration) — §8.1 scenario 5 [INV-3]
// ============================================================================

test('[I1][INV-3] sdd sync --create mirrors a seeded workspace onto the fake MCP server', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, WORKSPACE_SEED);
    await writeConfig(root, { createOnMove: false });

    const output = await cliCaptured(['sync', '--create', '--connector', 'linear'], root);
    assert.match(output, /created ENG-\d+/); // issue created per artifact (mirror label kept)

    const artifacts = await loadModel(root);
    const spec = artifacts.find((entry) => entry.slug === '042-magic-link');
    assert.match(spec.remote.linear, /^ENG-\d+$/); // remoteRef persisted by the CLI

    const saved = JSON.parse(await readWorkspaceFile(root, 'fake-state.json'));
    assert.equal(saved.issues.length, 3);
    // Every artifact was created in its own mapped state: transitions are idempotent.
    assert.equal((await readLog(root)).some((entry) => entry.tool === 'update_issue'), false);
  } finally {
    await cleanup(root);
  }
});

// ============================================================================
// End-to-End Test (@e2e) — §8.1 scenario 6 [INV-1..INV-4]
// ============================================================================

test('[E1][INV-1..INV-4] move dry-run writes nothing, then the real move applies model + mirror', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, WORKSPACE_SEED);
    await writeConfig(root, { createOnMove: true });

    // Dry-run: no write, and no remote contact at all (planned create).
    const before = await snapshotTree(root);
    const dryOutput = await cliCaptured(['move', '042', '--to', 'active', '--dry-run'], root);
    assert.match(dryOutput, /would move to In Progress/);
    assert.deepEqual(await snapshotTree(root), before);
    assert.equal(await fileExists(root, 'log.jsonl'), false);
    assert.equal(await fileExists(root, 'fake-state.json'), false);

    // Real move: the model transitions AND the mirror creates the issue.
    const realOutput = await cliCaptured(['move', '042', '--to', 'active'], root);
    assert.match(realOutput, /ENG-\d+ → In Progress/);

    const artifacts = await loadModel(root);
    const spec = artifacts.find((entry) => entry.slug === '042-magic-link');
    assert.equal(spec.state, 'active');
    assert.match(spec.remote.linear, /^ENG-\d+$/);

    const saved = JSON.parse(await readWorkspaceFile(root, 'fake-state.json'));
    assert.equal(saved.issues.length, 1);

    const { exitCode, output } = await capturingExitCode(() => validate({ cwd: root, flags: { json: false } }));
    assert.equal(exitCode, 0);
    assert.equal(output.includes('connector-settings'), false);
    process.exitCode = 0;
  } finally {
    await cleanup(root);
  }
});