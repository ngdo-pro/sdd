import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG_VERSION,
  assertKnownBackends,
  defaultConfig,
  getBackendConfig,
  loadConfig,
  normalizeConfig,
  selectBackendConfigs,
} from '../src/core/config.js';
import { ConfigError } from '../src/core/errors.js';
import { makeWorkspace, cleanup, writeFiles } from './helpers.js';

test('defaultConfig is model-first with one disabled mirror', () => {
  const config = defaultConfig();
  assert.equal(config.version, CONFIG_VERSION);
  assert.equal(config.sourceOfTruth, 'model');
  assert.equal(config.projections.markdown, true);
  assert.deepEqual(config.backends.map((backend) => backend.id), ['linear']);
  assert.equal(config.backends[0].enabled, false);
});

test('normalizeConfig upgrades a legacy v1 config, dropping the intrinsic filesystem backend', () => {
  const config = normalizeConfig({
    version: 1,
    sourceOfTruth: 'filesystem',
    backends: [
      { id: 'filesystem', type: 'filesystem', enabled: true, required: true },
      { id: 'linear', type: 'linear', enabled: true, settings: { teamKey: 'ENG' } },
    ],
  });

  assert.equal(config.version, 2);
  assert.equal(config.sourceOfTruth, 'model');
  assert.deepEqual(config.backends.map((backend) => backend.id), ['linear']);
  assert.equal(getBackendConfig(config, 'linear').enabled, true);
  assert.equal(getBackendConfig(config, 'linear').settings.teamKey, 'ENG');
});

test('normalizeConfig merges partial mirror settings onto defaults', () => {
  const config = normalizeConfig({ backends: [{ id: 'linear', settings: { labels: { spec: 'spec' } } }] });
  const linear = getBackendConfig(config, 'linear');
  assert.equal(linear.settings.stateMap.active, 'In Progress');
  assert.equal(linear.settings.labels.spec, 'spec');
  assert.equal(linear.settings.labels.feature, 'feature');
});

test('normalizeConfig keeps unknown third-party mirrors', () => {
  const config = normalizeConfig({ backends: [{ id: 'jira', type: 'jira', enabled: true }] });
  assert.ok(getBackendConfig(config, 'jira'));
});

test('selectBackendConfigs honours enabled flags and explicit filters', () => {
  const config = normalizeConfig({ backends: [{ id: 'linear', enabled: true }] });
  assert.deepEqual(selectBackendConfigs(config).map((backend) => backend.id), ['linear']);
  assert.deepEqual(selectBackendConfigs(config, { only: ['linear'] }).map((backend) => backend.id), ['linear']);
  assert.deepEqual(selectBackendConfigs(defaultConfig()), []);
});

test('assertKnownBackends reports unknown ids', () => {
  const config = defaultConfig();
  assert.doesNotThrow(() => assertKnownBackends(config, ['linear']));
  assert.throws(() => assertKnownBackends(config, ['ghost']), ConfigError);
});

test('loadConfig falls back to defaults and reads an on-disk config', async () => {
  const root = await makeWorkspace();
  try {
    assert.equal((await loadConfig(root)).sourceOfTruth, 'model');

    await writeFiles(root, { '.specs/config.json': JSON.stringify({ backends: [{ id: 'linear', enabled: true }] }) });
    assert.equal(getBackendConfig(await loadConfig(root), 'linear').enabled, true);
  } finally {
    await cleanup(root);
  }
});

test('loadConfig rejects malformed JSON', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, { '.specs/config.json': '{ not json' });
    await assert.rejects(() => loadConfig(root), ConfigError);
  } finally {
    await cleanup(root);
  }
});
