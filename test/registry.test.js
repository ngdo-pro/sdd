import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackends, discoverExtensionFactories, resolveFactories } from '../src/backends/registry.js';
import { defaultConfig, normalizeConfig } from '../src/core/config.js';
import { BackendError } from '../src/core/errors.js';
import { makeWorkspace, cleanup, writeFiles } from './helpers.js';

test('the built-in linear factory always resolves', async () => {
  const factories = await resolveFactories();
  assert.equal(typeof factories.linear, 'function');
});

test('discoverExtensionFactories picks up default-export factories only', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, {
      'custom/backend.js': 'export default function createCustom() { return { id: "custom" }; }\n',
      '.private/backend.js': 'export default function createPrivate() { return { id: "private" }; }\n',
      '_TEMPLATE/backend.js': 'export default function createTemplate() { return { id: "template" }; }\n',
      'noentry/README.md': 'no backend.js here\n',
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
    const config = normalizeConfig({ backends: [{ id: 'linear', enabled: true }] });
    const backends = await createBackends(root, config);
    assert.deepEqual(backends.map((backend) => backend.id), ['linear']);
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

test('createBackends rejects unknown backend types', async () => {
  const root = await makeWorkspace();
  try {
    const config = normalizeConfig({ backends: [{ id: 'ghost', type: 'ghost', enabled: true }] });
    await assert.rejects(() => createBackends(root, config), BackendError);
  } finally {
    await cleanup(root);
  }
});

test('createBackends loads a third-party extension from a custom directory', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, {
      'ext/custom/backend.js': 'export default function create({ backendConfig }) { return { id: backendConfig.id }; }\n',
    });
    const config = normalizeConfig({ backends: [{ id: 'custom', type: 'custom', enabled: true }] });
    const backends = await createBackends(root, config, { extensionsDir: `${root}/ext` });
    assert.deepEqual(backends.map((backend) => backend.id), ['custom']);
  } finally {
    await cleanup(root);
  }
});