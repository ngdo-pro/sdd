import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBackends,
  discoverExtensionFactories,
  getSourceBackend,
  resolveFactories,
} from '../src/backends/registry.js';
import { defaultConfig, normalizeConfig } from '../src/core/config.js';
import { BackendError } from '../src/core/errors.js';
import { makeWorkspace, writeFiles, cleanup } from './helpers.js';

test('built-in factories always resolve', async () => {
  const factories = await resolveFactories();
  assert.equal(typeof factories.filesystem, 'function');
  assert.equal(typeof factories.linear, 'function');
});

test('discoverExtensionFactories picks up default-export factories', async () => {
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

test('createBackends instantiates the enabled backends only', async () => {
  const root = await makeWorkspace();
  try {
    const config = normalizeConfig({ backends: [{ id: 'linear', enabled: true }] });
    const backends = await createBackends(root, config);
    assert.deepEqual(backends.map((backend) => backend.id), ['filesystem', 'linear']);
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

test('createBackends errors when nothing is enabled', async () => {
  const root = await makeWorkspace();
  try {
    const config = normalizeConfig({ backends: [{ id: 'filesystem', enabled: false }] });
    const only = ['filesystem'];
    const backends = await createBackends(root, config, { only });
    assert.equal(backends.length, 1);
    await assert.rejects(() => createBackends(root, normalizeConfig({ backends: [] }), { only: ['nope'] }), BackendError);
  } finally {
    await cleanup(root);
  }
});

test('getSourceBackend defaults to the filesystem', async () => {
  const root = await makeWorkspace();
  try {
    const config = defaultConfig();
    const backends = await createBackends(root, config);
    assert.equal(getSourceBackend(backends, config).id, 'filesystem');
  } finally {
    await cleanup(root);
  }
});
