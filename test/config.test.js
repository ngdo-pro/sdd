import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG_VERSION,
  assertKnownBackends,
  convertConfig,
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
  assert.equal(config.version, 3);
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

  // normalizeConfig always stamps the current schema version — a legacy v1
  // input lands on v3.
  assert.equal(config.version, 3);
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

    await writeFiles(root, { '.sdd/config.json': JSON.stringify({ backends: [{ id: 'linear', enabled: true }] }) });
    assert.equal(getBackendConfig(await loadConfig(root), 'linear').enabled, true);
  } finally {
    await cleanup(root);
  }
});

test('[U5][INV-4] loadConfig tolerates a missing projections.markdown', async () => {
  const root = await makeWorkspace();
  try {
    // A config.json without the `projections` key at all → markdown enabled.
    await writeFiles(root, { '.sdd/config.json': JSON.stringify({ version: 2, sourceOfTruth: 'model' }) });
    assert.equal((await loadConfig(root)).projections.markdown, true);

    // An explicit false is honoured.
    await writeFiles(root, {
      '.sdd/config.json': JSON.stringify({ version: 2, projections: { markdown: false } }),
    });
    assert.equal((await loadConfig(root)).projections.markdown, false);
  } finally {
    await cleanup(root);
  }
});

test('normalizeConfig defaults projections.markdown to true when absent', () => {
  assert.equal(normalizeConfig({}).projections.markdown, true);
  assert.equal(normalizeConfig({ projections: { markdown: false } }).projections.markdown, false);
});

test('loadConfig rejects malformed JSON', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, { '.sdd/config.json': '{ not json' });
    await assert.rejects(() => loadConfig(root), ConfigError);
  } finally {
    await cleanup(root);
  }
});

// ============================================================================
// convertConfig — schéma v3 (feature 03-sdd-migration, §8.1 scenario U3)
// ============================================================================

test('[U3][INV-3] convertConfig produces a clean v3 config with exact warnings', () => {
  const { config, warnings } = convertConfig({
    version: 2,
    sourceOfTruth: 'model',
    legacyDirs: ['.specs/model'],
    projections: { markdown: true },
    backends: [
      { id: 'filesystem', type: 'filesystem', enabled: true },
      { id: 'linear', type: 'linear', enabled: true, settings: { teamKey: 'ENG' } },
    ],
  });

  assert.equal(config.version, 3);
  assert.equal(config.sourceOfTruth, 'model');
  assert.equal('legacyDirs' in config, false);
  assert.equal(warnings.join(' ').includes('legacyDirs'), true);
  assert.deepEqual(config.backends.map((backend) => backend.id), ['linear']);
  assert.equal(getBackendConfig(config, 'linear').enabled, true);
  assert.equal(getBackendConfig(config, 'linear').settings.teamKey, 'ENG');
  // Exactly one warning for the unknown key and one for the dropped backend.
  assert.equal(warnings.filter((warning) => warning.includes('legacyDirs')).length, 1);
  assert.equal(warnings.filter((warning) => warning.includes('filesystem')).length, 1);
  assert.equal(warnings.length, 2);
});

test('convertConfig keeps a compliant v3 config untouched and warns nothing', () => {
  const { config, warnings } = convertConfig(defaultConfig());
  assert.equal(config.version, 3);
  assert.deepEqual(warnings, []);
  assert.deepEqual(config.backends.map((backend) => backend.id), ['linear']);
});
