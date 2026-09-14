import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/cli/main.js';
import { validate } from '../src/cli/commands/validate.js';
import { manifestFor, manifestHint } from '../src/connectors/registry.js';
import { getBackendConfig, loadConfig } from '../src/core/config.js';
import { UsageError } from '../src/core/errors.js';
import { makeWorkspace, cleanup, seedModel, writeFiles, readWorkspaceFile, fileExists } from './helpers.js';

const FAKE_SERVER = fileURLToPath(new URL('./helpers/fake-mcp-server.js', import.meta.url));

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

/** Runs the real CLI capturing stdout and `process.exitCode` (INV-2 exit gates). */
async function runCaptured(args, root) {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    process.exitCode = 0;
    await run([...args, '--cwd', root]);
    return { output: chunks.join(''), exitCode: process.exitCode };
  } finally {
    process.stdout.write = original;
    process.exitCode = 0;
  }
}

/** Runs the structural gate capturing stdout and `process.exitCode`. */
async function runCapturedValidate(root) {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    process.exitCode = 0;
    await validate({ cwd: root, flags: { json: false } });
    return { output: chunks.join(''), exitCode: process.exitCode };
  } finally {
    process.stdout.write = original;
    process.exitCode = 0;
  }
}

/** Snapshot of `.sdd/config.json` (raw bytes) to assert zero-write dry-runs. */
async function configSnapshot(root) {
  return (await fileExists(root, '.sdd/config.json')) ? readWorkspaceFile(root, '.sdd/config.json') : null;
}

/** Writes a two-mirror config pointing at one live and one dead fake MCP server. */
async function writeMirrorConfig(root, mirrors) {
  const config = {
    version: 3,
    sourceOfTruth: 'model',
    projections: { markdown: true },
    connectors: mirrors.map(({ id, server }) => ({
      id,
      type: 'linear',
      enabled: true,
      settings: {
        teamKey: 'ENG',
        createOnMove: true,
        mcp: {
          command: process.execPath,
          args: server === 'dead'
            ? [FAKE_SERVER, '--silent']
            : [FAKE_SERVER, `--state=${path.join(root, 'fake-state.json')}`, `--log=${path.join(root, 'log.jsonl')}`],
          timeoutMs: 250,
        },
      },
    })),
  };
  await fsp.writeFile(path.join(root, '.sdd', 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

const WORKSPACE_SEED = [
  { kind: 'initiative', slug: 'demo', title: 'Demo', state: 'active', body: '## 1. Intent\n\nDemo.\n' },
  { kind: 'feature', slug: '01-login', title: 'Login', state: 'active', relations: { initiative: 'demo' }, body: '## 1. Problem\n\nLogin.\n' },
  {
    kind: 'spec',
    slug: '042-login',
    title: 'Magic link',
    state: 'active',
    relations: { feature: '01-login', initiative: 'demo' },
    body: '## 1. Intent\n\nMagic link.\n',
  },
];

/** A hint-less workspace manifest exercising the generic missing-settings fallback. */
const CUSTOM_MANIFEST = {
  id: 'custom',
  name: 'Custom Connector',
  type: 'custom',
  kind: 'mirror',
  description: 'Workspace extension without a hint.',
  settings: { endpoint: '' },
  settingTypes: { endpoint: 'string' },
  requiredSettings: ['endpoint'],
};

// ============================================================================
// Unit Tests (@unit) — §8.1 scenario U1
// ============================================================================

test('[U1][INV-3] manifestHint reads the manifest field and returns null when absent', async () => {
  const root = await makeWorkspace();
  try {
    const linear = await manifestFor(root, 'linear');
    assert.equal(manifestHint(linear), 'Run /setup — it discovers the MCP transport in your host config');

    // Retrocompatible: a manifest without the field (or blank) yields null.
    assert.equal(manifestHint({ ...linear, hint: undefined }), null);
    assert.equal(manifestHint({ hint: '' }), null);
    assert.equal(manifestHint({ hint: '   ' }), null);
    assert.equal(manifestHint({}), null);
    assert.equal(manifestHint(null), null);
  } finally {
    await cleanup(root);
  }
});

// ============================================================================
// Component Tests (@component) — §8.1 scenarios C1–C3
// ============================================================================

test('[C1][INV-1] enable with the full grammar and --dry-run prints the plan and writes nothing', async () => {
  const root = await makeWorkspace();
  try {
    await run(['init', '--cwd', root]);

    const before = await configSnapshot(root);
    const { output, exitCode } = await runCaptured(
      ['connectors', 'enable', 'linear', '--linear.mcp.command=npx', '--linear.mcp.args=-y', '--dry-run'],
      root,
    );

    assert.equal(exitCode, 0);
    // The plan shows the resolved settings (§4.2): merged, coercion applied.
    const plan = JSON.parse(output.slice(0, output.lastIndexOf('}') + 1));
    assert.equal(plan.connectors[0].settings.mcp.command, 'npx');
    // Single occurrence stays a scalar — repetition is what builds the array
    // (spec 005 §4.1, shared with `init`); the repeated form is asserted below.
    assert.deepEqual(plan.connectors[0].settings.mcp.args, '-y');
    assert.match(output, /\(dry-run: nothing was written\)/);

    // Zero bytes written: the config is byte-identical after the dry-run.
    assert.equal(await configSnapshot(root), before);

    // The repeated form builds the array (same grammar as `init`).
    const repeated = await runCaptured(
      ['connectors', 'enable', 'linear', '--linear.mcp.command=npx', '--linear.mcp.args=-y', '--linear.mcp.args=npx', '--dry-run'],
      root,
    );
    const repeatedPlan = JSON.parse(repeated.output.slice(0, repeated.output.lastIndexOf('}') + 1));
    assert.deepEqual(repeatedPlan.connectors[0].settings.mcp.args, ['-y', 'npx']);
    assert.equal(await configSnapshot(root), before);
  } finally {
    await cleanup(root);
  }
});

test('[C2][INV-1] a foreign settings namespace is a UsageError and writes nothing', async () => {
  const root = await makeWorkspace();
  try {
    await run(['init', '--cwd', root]);
    await run(['connectors', 'enable', 'linear', '--linear.teamKey=ENG', '--cwd', root]);

    await assert.rejects(
      () => run(['connectors', 'enable', 'linear', '--ghost.teamKey=X', '--cwd', root]),
      (error) => error instanceof UsageError && error.exitCode === 2 && error.message.includes('"ghost"'),
    );
    // Nothing was written by the rejected call (INV-1/INV-2: reject before write).
    const config = await loadConfig(root);
    assert.equal(getBackendConfig(config, 'linear').settings.teamKey, 'ENG');
    assert.equal(getBackendConfig(config, 'linear').settings['ghost.teamKey'], undefined);
  } finally {
    await cleanup(root);
  }
});

test('[C3][INV-1] a top-level dotted path of a declared setting binds to the positional id', async () => {
  const root = await makeWorkspace();
  try {
    await run(['init', '--cwd', root]);
    await runCaptured(['connectors', 'enable', 'linear', '--mcp.command=npx', '--mcp.args=-y', '--mcp.args=npx'], root);

    const linear = getBackendConfig(await loadConfig(root), 'linear');
    assert.equal(linear.enabled, true);
    assert.deepEqual(linear.settings.mcp, { command: 'npx', args: ['-y', 'npx'] });
  } finally {
    await cleanup(root);
  }
});

test('[C4][INV-1] disable --dry-run works without any settings flag and writes nothing', async () => {
  const root = await makeWorkspace();
  try {
    await run(['init', '--cwd', root]);
    await runCaptured(['connectors', 'enable', 'linear', '--linear.teamKey=ENG'], root);
    const before = await configSnapshot(root);

    const { output, exitCode } = await runCaptured(['connectors', 'disable', 'linear', '--dry-run'], root);
    assert.equal(exitCode, 0);
    const plan = JSON.parse(output.slice(0, output.lastIndexOf('}') + 1));
    assert.equal(plan.connectors.find((entry) => entry.id === 'linear').enabled, false);
    assert.match(output, /\(dry-run: nothing was written\)/);

    // The real config still carries the enabled connector.
    assert.equal(await configSnapshot(root), before);
    assert.equal(getBackendConfig(await loadConfig(root), 'linear').enabled, true);
  } finally {
    await cleanup(root);
  }
});

test('[C5][INV-3] the hint comes from the manifest: shown when requiredSettings are incomplete only', async () => {
  const root = await makeWorkspace();
  try {
    await run(['init', '--cwd', root]);

    // Incomplete enable (no teamKey, no mcp): the manifest hint is displayed.
    const incomplete = await runCaptured(['connectors', 'enable', 'linear'], root);
    assert.match(incomplete.output, /Run \/setup — it discovers the MCP transport in your host config/);

    // `connectors list` never shows the hint.
    const listed = await runCaptured(['connectors', 'list'], root);
    assert.equal(listed.output.includes('Run /setup'), false);

    // Well-configured enable: no hint.
    const complete = await runCaptured(
      ['connectors', 'enable', 'linear', '--linear.teamKey=ENG', '--linear.mcp.command=npx', '--linear.mcp.args=-y', '--linear.mcp.args=@linear/mcp-server'],
      root,
    );
    assert.equal(complete.exitCode, 0);
    assert.equal(complete.output.includes('Run /setup'), false);

    // No `linear` special-casing left in src: the hint is the manifest's.
    const hintless = await makeWorkspace();
    try {
      await writeFiles(hintless, { 'extensions/custom/extension.json': JSON.stringify(CUSTOM_MANIFEST) });
      await run(['init', '--cwd', hintless]);
      await writeFiles(hintless, {
        '.sdd/config.json': JSON.stringify({
          version: 3,
          sourceOfTruth: 'model',
          connectors: [{ id: 'custom', type: 'custom', enabled: false, settings: {} }],
        }),
      });
      const generic = await runCaptured(['connectors', 'enable', 'custom'], hintless);
      assert.equal(generic.exitCode, 0);
      assert.match(generic.output, /Required settings incomplete: endpoint/);
      assert.equal(generic.output.includes('Run /setup'), false);
    } finally {
      await cleanup(hintless);
    }
  } finally {
    await cleanup(root);
  }
});

// ============================================================================
// Integration Tests (@integration) — §8.1 scenarios I1, I2
// ============================================================================

test('[I1][INV-4] enable stays idempotent through the new grammar (top-level flags)', async () => {
  const root = await makeWorkspace();
  try {
    await run(['init', '--cwd', root]);
    await runCaptured(['connectors', 'enable', 'linear', '--teamKey=ENG'], root);
    await runCaptured(['connectors', 'enable', 'linear', '--mcp.command=npx'], root);

    const config = await loadConfig(root);
    assert.deepEqual(config.connectors.map((entry) => entry.id), ['linear']);
    const linear = getBackendConfig(config, 'linear');
    assert.equal(linear.enabled, true);
    assert.equal(linear.settings.teamKey, 'ENG'); // preserved by the idempotent merge
    assert.equal(linear.settings.mcp.command, 'npx');
    assert.deepEqual(linear.settings.stateMap, { planned: 'Backlog', active: 'In Progress', archived: 'Done' });
  } finally {
    await cleanup(root);
  }
});

test('[I2][INV-2] sync: partial mirror success exits 0, all-fail exits 1 with the synthesis', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, WORKSPACE_SEED);
    await writeMirrorConfig(root, [
      { id: 'mirror-live', server: 'live' },
      { id: 'mirror-dead', server: 'dead' },
    ]);

    // Mixed: the dead mirror warns per artifact, the live one succeeds → exit 0.
    const mixed = await runCaptured(['sync', '--create'], root);
    assert.equal(mixed.exitCode, 0);
    assert.equal(mixed.output.includes('all enabled mirrors failed'), false);
    assert.match(mixed.output, /mirror-dead]: .*timeout/);
    assert.match(mixed.output, /created ENG-\d+/);

    // Only the dead mirror remains enabled: total failure → exit 1 + synthesis.
    await writeMirrorConfig(root, [{ id: 'mirror-dead', server: 'dead' }]);
    const dead = await runCaptured(['sync', '--create'], root);
    assert.equal(dead.exitCode, 1);
    assert.match(dead.output, /all enabled mirrors failed \(1\/1\)/);
    assert.match(dead.output, /mirror-dead]: .*timeout/);
  } finally {
    await cleanup(root);
  }
});

// ============================================================================
// End-to-End Test (@e2e) — §8.1 scenario E1 [INV-1..INV-3]
// ============================================================================

test('[E1][INV-1][INV-2][INV-3] enable dry-run → enable → hint → sync all-fail → validate finding', async () => {
  const root = await makeWorkspace();
  try {
    // 1. Dry-run on a bare workspace: the plan is printed, nothing is created.
    const preview = await runCaptured(
      ['connectors', 'enable', 'linear', '--linear.mcp.command=npx', '--linear.mcp.args=-y', '--dry-run'],
      root,
    );
    assert.equal(preview.exitCode, 0);
    assert.match(preview.output, /\(dry-run: nothing was written\)/);
    assert.equal(await fileExists(root, '.sdd/config.json'), false);

    // 2. Init, then enable with teamKey only: the connector is enabled and the
    //    manifest hint is displayed (requiredSettings incomplete — no mcp).
    await runCaptured(['init'], root);
    const enabled = await runCaptured(['connectors', 'enable', 'linear', '--teamKey=ENG'], root);
    assert.equal(enabled.exitCode, 0);
    assert.match(enabled.output, /Run \/setup — it discovers the MCP transport in your host config/);

    // 3. sync --create: every mirror operation fails (no transport) → exit 1.
    await runCaptured(['upsert', 'initiative', '--slug', 'demo', '--title', 'Demo'], root);
    await runCaptured(['upsert', 'feature', '--slug', '01-login', '--title', 'Login', '--initiative', 'demo'], root);
    await runCaptured(['upsert', 'spec', '--slug', '042-login', '--title', 'Magic link', '--feature', '01-login'], root);
    const sync = await runCaptured(['sync', '--create'], root);
    assert.equal(sync.exitCode, 1);
    assert.match(sync.output, /all enabled mirrors failed \(1\/1\)/);
    assert.match(sync.output, /no MCP transport configured/);

    // 4. validate reports the connector-settings findings → exit 1.
    const gate = await runCapturedValidate(root);
    assert.equal(gate.exitCode, 1);
    assert.match(gate.output, /\[connector-settings\] connector linear: required setting "mcp" is missing or empty/);

    // 5. The final config is coherent: enabled, teamKey kept, no phantom mcp.
    const linear = getBackendConfig(await loadConfig(root), 'linear');
    assert.equal(linear.enabled, true);
    assert.equal(linear.settings.teamKey, 'ENG');
    assert.equal(linear.settings.mcp, undefined);
  } finally {
    await cleanup(root);
  }
});