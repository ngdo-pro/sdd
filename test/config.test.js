import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultConfig,
  normalizeConfig,
  loadConfig,
  selectBackendConfigs,
  getBackendConfig,
} from '../src/core/config.js';
import { writeFiles, makeWorkspace, cleanup } from './helpers.js';

test('defaultConfig ships filesystem (required) and linear (disabled)', () => {
  const config = defaultConfig();
  assert.equal(config.sourceOfTruth, 'filesystem');
  assert.equal(getBackendConfig(config, 'filesystem').required, true);
  assert.equal(getBackendConfig(config, 'linear').enabled, false);
});

test('normalizeConfig merges partial backend settings onto defaults', () => {
  const config = normalizeConfig({
    backends: [{ id: 'linear', enabled: true, settings: { teamKey: 'ENG' } }],
  });
  const linear = getBackendConfig(config, 'linear');
  assert.equal(linear.enabled, true);
  assert.equal(linear.settings.teamKey, 'ENG');
  assert.equal(linear.settings.stateMap.active, 'In Progress');
});

test('normalizeConfig keeps unknown third-party backends', () => {
  const config = normalizeConfig({ backends: [{ id: 'jira', type: 'jira', enabled: true }] });
  assert.ok(getBackendConfig(config, 'jira'));
});

test('selectBackendConfigs honours the enabled flag and an explicit filter', () => {
  const config = normalizeConfig({ backends: [{ id: 'linear', enabled: true }] });
  assert.deepEqual(selectBackendConfigs(config).map((b) => b.id), ['filesystem', 'linear']);
  assert.deepEqual(selectBackendConfigs(config, { only: ['linear'] }).map((b) => b.id), ['linear']);
});

test('loadConfig falls back to defaults when config.json is absent', async () => {
  const root = await makeWorkspace();
  try {
    const config = await loadConfig(root);
    assert.equal(config.sourceOfTruth, 'filesystem');
  } finally {
    await cleanup(root);
  }
});

test('loadConfig reads an on-disk config', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, {
      '.specs/config.json': JSON.stringify({ sourceOfTruth: 'filesystem', backends: [{ id: 'linear', enabled: true }] }),
    });
    const config = await loadConfig(root);
    assert.equal(getBackendConfig(config, 'linear').enabled, true);
  } finally {
    await cleanup(root);
  }
});
