import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coerceSetting,
  createBackends,
  discoverExtensionFactories,
  findManifest,
  listCatalogIds,
  listManifests,
  manifestFor,
  resolveConnectorDeclarations,
  resolveFactories,
} from '../src/connectors/registry.js';
import { defaultConfig, normalizeConfig } from '../src/core/config.js';
import { ConnectorError, UsageError } from '../src/core/errors.js';
import { makeWorkspace, cleanup, writeFiles } from './helpers.js';

test('the built-in linear factory always resolves', async () => {
  const factories = await resolveFactories();
  assert.equal(typeof factories.linear, 'function');
});

test('discoverExtensionFactories picks up default-export factories only', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, {
      'custom/connector.js': 'export default function createCustom() { return { id: "custom" }; }\n',
      '.private/connector.js': 'export default function createPrivate() { return { id: "private" }; }\n',
      '_TEMPLATE/connector.js': 'export default function createTemplate() { return { id: "template" }; }\n',
      'noentry/README.md': 'no connector.js here\n',
    });
    const factories = await discoverExtensionFactories(root);
    assert.deepEqual(Object.keys(factories), ['custom']);
  } finally {
    await cleanup(root);
  }
});

test('createBackends instantiates enabled mirrors only', async () => {
  const root = await makeWorkspace();
  try {
    const config = normalizeConfig({ connectors: [{ id: 'linear', enabled: true }] });
    const connectors = await createBackends(root, config);
    assert.deepEqual(connectors.map((connector) => connector.id), ['linear']);
  } finally {
    await cleanup(root);
  }
});

test('createBackends returns nothing when no mirror is enabled', async () => {
  const root = await makeWorkspace();
  try {
    assert.deepEqual(await createBackends(root, defaultConfig()), []);
  } finally {
    await cleanup(root);
  }
});

test('createBackends rejects unknown connector types', async () => {
  const root = await makeWorkspace();
  try {
    const config = normalizeConfig({ connectors: [{ id: 'ghost', type: 'ghost', enabled: true }] });
    await assert.rejects(() => createBackends(root, config), ConnectorError);
  } finally {
    await cleanup(root);
  }
});

test('createBackends loads a third-party extension from a custom directory', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, {
      'ext/custom/connector.js': 'export default function create({ connectorConfig }) { return { id: connectorConfig.id }; }\n',
    });
    const config = normalizeConfig({ connectors: [{ id: 'custom', type: 'custom', enabled: true }] });
    const connectors = await createBackends(root, config, { extensionsDir: `${root}/ext` });
    assert.deepEqual(connectors.map((connector) => connector.id), ['custom']);
  } finally {
    await cleanup(root);
  }
});

// ============================================================================
// Manifest contract & coercion (spec 004-declarative-init, phase 1)
// ============================================================================

test('[INV-1] manifestFor resolves the bundled linear manifest with the extended contract', async () => {
  const root = await makeWorkspace();
  try {
    const manifest = await manifestFor(root, 'linear');
    assert.equal(manifest.id, 'linear');
    assert.equal(manifest.type, 'linear');
    assert.equal(manifest.settingTypes.teamKey, 'string');
    assert.equal(manifest.settingTypes.createOnMove, 'boolean');
    assert.equal(manifest.settingTypes.mcp, 'object');
    assert.deepEqual(manifest.requiredSettings, ['teamKey', 'mcp']);
    assert.equal(manifest.settings.teamKey, '');
    assert.equal(manifest.settings.createOnMove, false);
    assert.deepEqual(manifest.settings.mcp, {});
    // INV-1 (spec 005): no authentication block, no apiKey setting anywhere.
    assert.equal(manifest.authentication, undefined);
    assert.deepEqual(Object.keys(manifest.settings).filter((key) => key.toLowerCase().includes('key') && key !== 'teamKey'), []);
  } finally {
    await cleanup(root);
  }
});

test('[INV-1] the template folder is never part of the catalog', async () => {
  const root = await makeWorkspace();
  try {
    assert.deepEqual(await listCatalogIds(root), ['linear']);
    assert.deepEqual((await listManifests(root)).map((manifest) => manifest.id), ['linear']);
  } finally {
    await cleanup(root);
  }
});

test('[INV-1] findManifest tolerates manifest-less connectors, manifestFor rejects unknown ids', async () => {
  const root = await makeWorkspace();
  try {
    assert.equal(await findManifest(root, 'ghost'), null);
    await assert.rejects(() => manifestFor(root, 'ghost'), UsageError);

    // A malformed manifest is a hard error, not a silent skip.
    await writeFiles(root, { 'extensions/broken/extension.json': '{ not json' });
    await assert.rejects(() => findManifest(root, 'broken'), UsageError);
  } finally {
    await cleanup(root);
  }
});

test('[INV-2] coerceSetting coerces scalars and rejects invalid types', () => {
  assert.equal(coerceSetting('linear', 'teamKey', 'ENG'), 'ENG');
  assert.equal(coerceSetting('linear', 'teamKey', 'ENG', 'string'), 'ENG');
  assert.equal(coerceSetting('linear', 'teamKey', '42', 'number'), 42);
  assert.equal(coerceSetting('linear', 'port', 8080, 'number'), 8080);
  assert.equal(coerceSetting('linear', 'createOnMove', 'true', 'boolean'), true);
  assert.equal(coerceSetting('linear', 'createOnMove', 'false', 'boolean'), false);
  for (const raw of ['1', 'yes', 'on']) {
    assert.throws(() => coerceSetting('linear', 'createOnMove', raw, 'boolean'), UsageError);
  }
  assert.throws(() => coerceSetting('linear', 'teamKey', '', 'number'), UsageError);
  assert.throws(() => coerceSetting('linear', 'teamKey', 'x', 'nonsense'), UsageError);
});

test('[INV-2] resolveConnectorDeclarations seeds manifest defaults and coerces overrides', async () => {
  const root = await makeWorkspace();
  try {
    const [declaration] = await resolveConnectorDeclarations(root, ['linear'], {
      'linear.teamKey': 'ENG',
      'linear.labels.spec': 'SPEC',
      'linear.createOnMove': 'true',
    });
    assert.equal(declaration.id, 'linear');
    assert.equal(declaration.type, 'linear');
    assert.equal(declaration.enabled, true);
    assert.deepEqual(declaration.explicit, ['teamKey', 'labels.spec', 'createOnMove']);
    assert.equal(declaration.settings.teamKey, 'ENG');
    assert.equal(declaration.settings.labels.spec, 'SPEC');
    assert.equal(declaration.settings.createOnMove, true);
    assert.deepEqual(declaration.settings.stateMap, { planned: 'Backlog', active: 'In Progress', archived: 'Done' });
  } finally {
    await cleanup(root);
  }
});

test('[INV-2] resolveConnectorDeclarations rejects unknown ids, namespaces and depths', async () => {
  const root = await makeWorkspace();
  try {
    await assert.rejects(() => resolveConnectorDeclarations(root, ['ghost'], {}), UsageError);
    await assert.rejects(
      () => resolveConnectorDeclarations(root, ['linear'], { 'ghost.teamKey': 'X' }),
      (error) => error instanceof UsageError && error.message.includes('namespace "ghost"'),
    );
    await assert.rejects(
      () => resolveConnectorDeclarations(root, ['linear'], { 'teamKey': 'ENG' }),
      (error) => error instanceof UsageError && error.message.includes('missing its connector namespace'),
    );
    await assert.rejects(
      () => resolveConnectorDeclarations(root, ['linear'], { 'linear.a.b.c': 'X' }),
      (error) => error instanceof UsageError && error.message.includes('depth'),
    );
  } finally {
    await cleanup(root);
  }
});

test('[INV-1] resolveConnectorDeclarations tolerates config-only ids when the manifest is optional', async () => {
  const root = await makeWorkspace();
  try {
    const [declaration] = await resolveConnectorDeclarations(
      root,
      ['jira'],
      { 'jira.project': 'SDD' },
      { requireManifest: false },
    );
    assert.deepEqual(declaration, { id: 'jira', settings: {}, explicit: [], enabled: true });
  } finally {
    await cleanup(root);
  }
});