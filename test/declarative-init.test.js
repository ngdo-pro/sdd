import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/cli/main.js';
import { validate } from '../src/cli/commands/validate.js';
import { coerceSetting, listCatalogIds, manifestFor } from '../src/connectors/registry.js';
import { mergeSettingOverrides, getBackendConfig, loadConfig } from '../src/core/config.js';
import { UsageError } from '../src/core/errors.js';
import { makeWorkspace, cleanup, writeFiles, fileExists } from './helpers.js';

// Hermeticity (spec 009): the post-run update check is exercised with a fake
// fetch in cli.test.js — opt out here so no test ever touches the registry.
process.env.SDD_NO_UPDATE_CHECK = '1';

const CUSTOM_MANIFEST = {
  id: 'custom',
  name: 'Custom Connector',
  type: 'custom',
  kind: 'mirror',
  description: 'Workspace extension used by the declarative-init scenarios.',
  settings: { endpoint: '', retries: 1 },
  settingTypes: { endpoint: 'string', retries: 'number' },
  requiredSettings: ['endpoint'],
};

function argv(args, root) {
  return [...args, '--cwd', root];
}

/** Runs the real CLI (flag parsing included) while muting stdout. */
async function cli(args, root) {
  const original = process.stdout.write;
  process.stdout.write = () => true;
  try {
    return await run(argv(args, root));
  } finally {
    process.stdout.write = original;
  }
}

/** Runs the real CLI capturing stdout (for the dry-run JSON preview). */
async function cliCaptured(args, root) {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    await run(argv(args, root));
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

async function readConfig(root) {
  return loadConfig(root);
}

// ============================================================================
// Unit Tests (@unit) — §8.1 scenarios U1–U3
// ============================================================================

test('[U1][INV-2] mergeSettingOverrides deep-merges namespaced overrides, defaults intact', () => {
  const base = { teamKey: '', labels: { spec: 'spec', feature: 'feature' } };
  const merged = mergeSettingOverrides(base, { teamKey: 'ENG', 'labels.spec': 'SPEC' });
  assert.deepEqual(merged, { teamKey: 'ENG', labels: { spec: 'SPEC', feature: 'feature' } });
  // Watchout §6: the merge must never mutate its inputs (defaultConfig is shared).
  assert.deepEqual(base, { teamKey: '', labels: { spec: 'spec', feature: 'feature' } });
});

test('[U2][INV-2] coerceSetting types values and rejects non-coercible ones', () => {
  assert.equal(coerceSetting('linear', 'createOnMove', 'true', 'boolean'), true);
  assert.equal(coerceSetting('linear', 'createOnMove', 'false', 'boolean'), false);
  assert.equal(coerceSetting('linear', 'teamKey', '42', 'number'), 42);
  assert.equal(coerceSetting('linear', 'teamKey', 'ENG', 'string'), 'ENG');

  // Strict booleans: `1/0/yes/no` are rejected, citing `id.key`.
  for (const raw of ['1', '0', 'yes', 'no', 'TRUE', '']) {
    assert.throws(
      () => coerceSetting('linear', 'createOnMove', raw, 'boolean'),
      (error) => error instanceof UsageError
        && error.exitCode === 2
        && error.message.includes('linear.createOnMove'),
      `expected strict boolean rejection for ${JSON.stringify(raw)}`,
    );
  }
  assert.throws(
    () => coerceSetting('linear', 'teamKey', 'abc', 'number'),
    (error) => error instanceof UsageError && error.message.includes('linear.teamKey'),
  );
  // An object setting expects its leaves via subkeys (cites `id.key`).
  assert.throws(
    () => coerceSetting('linear', 'labels', 'spec', 'object'),
    (error) => error instanceof UsageError && error.message.includes('linear.labels'),
  );
});

test('[U3][INV-1] manifestFor resolves the builtin and workspace catalog, rejects the unknown', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, { 'extensions/custom/extension.json': JSON.stringify(CUSTOM_MANIFEST) });

    const linear = await manifestFor(root, 'linear');
    assert.equal(linear.id, 'linear');
    assert.equal(linear.settingTypes.createOnMove, 'boolean');
    assert.equal(linear.settingTypes.mcp, 'object');
    assert.deepEqual(linear.requiredSettings, ['teamKey', 'mcp']);

    const custom = await manifestFor(root, 'custom');
    assert.equal(custom.settings.retries, 1);

    assert.deepEqual(await listCatalogIds(root), ['custom', 'linear']);
    await assert.rejects(
      () => manifestFor(root, 'ghost'),
      (error) => error instanceof UsageError
        && error.exitCode === 2
        && error.message.includes('ghost')
        && error.message.includes('custom')
        && error.message.includes('linear'),
    );
  } finally {
    await cleanup(root);
  }
});

test('[U3][INV-1] a manifest without settingTypes/requiredSettings stays valid (retrocompatible)', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, {
      'extensions/legacy/extension.json': JSON.stringify({ id: 'legacy', type: 'legacy', settings: { apiKey: '' } }),
    });
    const manifest = await manifestFor(root, 'legacy');
    assert.deepEqual(manifest.settingTypes, {});
    assert.deepEqual(manifest.requiredSettings, []);
  } finally {
    await cleanup(root);
  }
});

// ============================================================================
// Component Tests (@component) — §8.1 scenarios C1–C3
// ============================================================================

test('[C1][INV-1][INV-2] declarative init seeds the manifest and rejects errors before any write', async () => {
  const root = await makeWorkspace();
  try {
    await cli(['init', '--connector', 'linear', '--linear.teamKey=ENG', '--linear.labels.spec=SPEC'], root);
    const config = await readConfig(root);
    const linear = getBackendConfig(config, 'linear');
    assert.equal(linear.enabled, true);
    assert.equal(linear.settings.teamKey, 'ENG');
    assert.equal(linear.settings.labels.spec, 'SPEC');
    // Sibling defaults come from the manifest, untouched.
    assert.deepEqual(linear.settings.stateMap, { planned: 'Backlog', active: 'In Progress', archived: 'Done' });
    assert.equal(linear.settings.createOnMove, false);
    assert.deepEqual(config.connectors.map((connector) => connector.id), ['linear']);

    for (const broken of [
      ['init', '--connector', 'ghost'],
      ['init', '--connector', 'linear', '--linear.teamKey'],
      ['init', '--connector', 'linear', '--ghost.teamKey=X'],
    ]) {
      await assert.rejects(
        () => cli(broken, root),
        (error) => error instanceof UsageError && error.exitCode === 2,
      );
    }
    // The three failures left the workspace untouched (INV-1/INV-2: reject
    // before write — the nominal config.json is byte-identical).
    const after = await readConfig(root);
    assert.equal(getBackendConfig(after, 'linear').settings.teamKey, 'ENG');
    assert.deepEqual(after.connectors, config.connectors);
  } finally {
    await cleanup(root);
  }
});

test('[C1][INV-1][INV-2] the three error paths leave a fresh workspace unwritten', async () => {
  const root = await makeWorkspace();
  try {
    for (const broken of [
      ['init', '--connector', 'ghost'],
      ['init', '--connector', 'linear', '--linear.teamKey'],
      ['init', '--connector', 'linear', '--ghost.teamKey=X'],
    ]) {
      await assert.rejects(() => cli(broken, root), UsageError);
      assert.equal(await fileExists(root, '.sdd/config.json'), false);
      assert.equal(await fileExists(root, '.sdd/canonical'), false);
    }
  } finally {
    await cleanup(root);
  }
});

test('[C2][INV-3] re-init is idempotent: explicit values survive, manifest defaults never overwrite', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, { 'extensions/custom/extension.json': JSON.stringify(CUSTOM_MANIFEST) });

    await cli(['init', '--connector', 'linear', '--linear.teamKey=ENG'], root);
    // Second pass declares a new connector and re-declares linear with no override.
    await cli(['init', '--connector', 'custom', '--connector', 'linear'], root);

    const config = await readConfig(root);
    assert.deepEqual(config.connectors.map((connector) => connector.id), ['custom', 'linear']);
    assert.equal(getBackendConfig(config, 'linear').settings.teamKey, 'ENG');
    assert.equal(getBackendConfig(config, 'linear').enabled, true);
    const custom = getBackendConfig(config, 'custom');
    assert.equal(custom.enabled, true);
    assert.equal(custom.type, 'custom');
    assert.deepEqual(custom.settings, { endpoint: '', retries: 1 });
  } finally {
    await cleanup(root);
  }
});

test('[C3][INV-5][INV-2] validate refuses an enabled connector missing its requiredSettings', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, {
      '.sdd/config.json': JSON.stringify({
        version: 3,
        sourceOfTruth: 'model',
        connectors: [{ id: 'linear', type: 'linear', enabled: true, settings: {} }],
      }),
    });
    const { output, exitCode } = await capturingExitCode(() => validate({ cwd: root, flags: { json: false } }));
    assert.equal(exitCode, 1);
    assert.match(output, /\[connector-settings\] connector linear/);
    assert.match(output, /requiredSettings: \["teamKey", ?"mcp"\]/);
    process.exitCode = 0;
  } finally {
    await cleanup(root);
  }
});

test('[C4][INV-1] validate rejects secret-shaped settings keys and accepts lookalike keys', async () => {
  const root = await makeWorkspace();
  const config = (settings) => JSON.stringify({
    version: 3,
    sourceOfTruth: 'model',
    connectors: [{ id: 'linear', type: 'linear', enabled: true, settings }],
  });
  try {
    // Top-level apiKey (Gherkin scenario 3) and suffix variants.
    await writeFiles(root, {
      '.sdd/config.json': config({
        teamKey: 'ENG',
        mcp: { command: 'npx', args: ['-y', '@linear/mcp-server'] },
        apiKey: 'lin_api_xxx',
        authToken: 'mcp_tok',
      }),
    });
    const rejected = await capturingExitCode(() => validate({ cwd: root, flags: { json: false } }));
    assert.equal(rejected.exitCode, 1);
    assert.match(rejected.output, /settings must not contain secrets \(apiKey\)/);
    assert.match(rejected.output, /settings must not contain secrets \(authToken\)/);
    process.exitCode = 0;

    await writeFiles(root, { '.sdd/config.json': config({
      teamKey: 'ENG',
      createOnMove: false,
      mcp: { command: 'npx', args: ['-y', '@linear/mcp-server'], apiToken: 'x' },
    }) });
    const nested = await capturingExitCode(() => validate({ cwd: root, flags: { json: false } }));
    assert.equal(nested.exitCode, 1);
    assert.match(nested.output, /settings must not contain secrets \(mcp\.apiToken\)/);
    process.exitCode = 0;

    // `tokenBucketRate` is a legit key: no secret finding.
    await writeFiles(root, { '.sdd/config.json': config({
      teamKey: 'ENG',
      tokenBucketRate: 10,
      mcp: { url: 'https://mcp.linear.app/sse' },
    }) });
    const compliant = await capturingExitCode(() => validate({ cwd: root, flags: { json: false } }));
    assert.equal(compliant.exitCode, 0);
    assert.equal(compliant.output.includes('secrets'), false);
  } finally {
    await cleanup(root);
  }
});

test('[C5][INV-2] validate requires the resolved mcp transport for an enabled linear connector', async () => {
  const root = await makeWorkspace();
  const config = (settings) => JSON.stringify({
    version: 3,
    sourceOfTruth: 'model',
    connectors: [{ id: 'linear', type: 'linear', enabled: true, settings }],
  });
  try {
    await writeFiles(root, { '.sdd/config.json': config({ teamKey: 'ENG' }) });
    const missing = await capturingExitCode(() => validate({ cwd: root, flags: { json: false } }));
    assert.equal(missing.exitCode, 1);
    assert.match(missing.output, /required setting "mcp" is missing or empty/);

    await writeFiles(root, { '.sdd/config.json': config({ teamKey: 'ENG', mcp: {} }) });
    const empty = await capturingExitCode(() => validate({ cwd: root, flags: { json: false } }));
    assert.equal(empty.exitCode, 1);
    assert.match(empty.output, /required setting "mcp" is missing or empty/);
    process.exitCode = 0;

    await writeFiles(root, { '.sdd/config.json': config({
      teamKey: 'ENG',
      mcp: { command: 'npx', args: ['-y', '@linear/mcp-server'] },
    }) });
    const resolved = await capturingExitCode(() => validate({ cwd: root, flags: { json: false } }));
    assert.equal(resolved.exitCode, 0);
    process.exitCode = 0;
  } finally {
    await cleanup(root);
  }
});

test('[C6][INV-2] repeated --linear.mcp.args flags build the settings.mcp args array', async () => {
  const root = await makeWorkspace();
  try {
    await cli([
      'init', '--connector', 'linear',
      '--linear.teamKey=ENG',
      '--linear.mcp.command=npx',
      '--linear.mcp.args=-y',
      '--linear.mcp.args=@linear/mcp-server',
    ], root);
    const config = await readConfig(root);
    const linear = getBackendConfig(config, 'linear');
    // settings.mcp is the only transport: { command, args } leaves, depth ≤ 2.
    assert.deepEqual(linear.settings.mcp, { command: 'npx', args: ['-y', '@linear/mcp-server'] });
  } finally {
    await cleanup(root);
  }
});

// ============================================================================
// Component Test (@component) — spec 007-connector-hardening, §8.1 [INV-1]
// Grammar parity: `connectors enable|disable` resolve settings through the
// same registry helpers as `sdd init`.
// ============================================================================

test('[C7][INV-1] connectors enable resolves the same flags identically to sdd init', async () => {
  const flags = [
    '--linear.teamKey=ENG',
    '--linear.mcp.command=npx',
    '--linear.mcp.args=-y',
    '--linear.mcp.args=@linear/mcp-server',
  ];
  const viaInit = await makeWorkspace();
  const viaEnable = await makeWorkspace();
  const topLevel = await makeWorkspace();
  try {
    await cli(['init', '--connector', 'linear', ...flags], viaInit);
    await cli(['init'], viaEnable);
    await cli(['connectors', 'enable', 'linear', ...flags], viaEnable);
    await cli(['init'], topLevel);
    // Top-level (un-namespaced) flags bind to the positional id and must land
    // on the exact same resolved settings as the namespaced forms.
    await cli([
      'connectors', 'enable', 'linear',
      '--teamKey=ENG',
      '--mcp.command=npx',
      '--linear.mcp.args=-y',
      '--linear.mcp.args=@linear/mcp-server',
    ], topLevel);

    const initSettings = getBackendConfig(await readConfig(viaInit), 'linear').settings;
    const enableSettings = getBackendConfig(await readConfig(viaEnable), 'linear').settings;
    const topSettings = getBackendConfig(await readConfig(topLevel), 'linear').settings;

    assert.equal(getBackendConfig(await readConfig(viaEnable), 'linear').enabled, true);
    assert.deepEqual(enableSettings, initSettings);
    assert.deepEqual(topSettings, initSettings);
    assert.deepEqual(initSettings.mcp, { command: 'npx', args: ['-y', '@linear/mcp-server'] });
  } finally {
    await cleanup(viaInit);
    await cleanup(viaEnable);
    await cleanup(topLevel);
  }
});

test('[C3][INV-5] validate reports invalid setting types and passes a compliant connector', async () => {
  const root = await makeWorkspace();
  const config = (settings) => JSON.stringify({
    version: 3,
    sourceOfTruth: 'model',
    connectors: [{ id: 'linear', type: 'linear', enabled: true, settings }],
  });
  try {
    await writeFiles(root, {
      '.sdd/config.json': config({ teamKey: 'ENG', createOnMove: 'yes', mcp: { command: 'npx', args: ['-y', '@linear/mcp-server'] } }),
    });
    const invalid = await capturingExitCode(() => validate({ cwd: root, flags: { json: false } }));
    assert.equal(invalid.exitCode, 1);
    assert.match(invalid.output, /settings\.createOnMove must be boolean \(got string\)/);
    process.exitCode = 0;

    await writeFiles(root, {
      '.sdd/config.json': config({ teamKey: 'ENG', createOnMove: true, mcp: { command: 'npx', args: ['-y', '@linear/mcp-server'] } }),
    });
    const compliant = await capturingExitCode(() => validate({ cwd: root, flags: { json: false } }));
    assert.equal(compliant.exitCode, 0);
    assert.equal(compliant.output.includes('connector-settings'), false);
  } finally {
    await cleanup(root);
  }
});
