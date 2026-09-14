import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { checkUpdate, updateCheckDisabled } from '../src/cli/update-check.js';
import { makeWorkspace, cleanup } from './helpers.js';

const NOW = 1_700_000_000_000;
const PKG = { name: 'shodo', version: '2.0.0' };
const NOTICE = '· update available: v2.1.0 (installed: v2.0.0) — npm i -g shodo\n';

/** Counting registry stub: answers `{ version }`, records urls and options. */
function registry(version) {
  const state = { fetches: 0, urls: [], options: [] };
  const fetchImpl = async (url, options = {}) => {
    state.fetches += 1;
    state.urls.push(url);
    state.options.push(options);
    return { ok: true, json: async () => ({ version }) };
  };
  return { state, fetchImpl };
}

async function readCache(root) {
  return JSON.parse(await fsp.readFile(path.join(root, '.sdd', '.update-check.json'), 'utf8'));
}

async function writeCache(root, cache) {
  await fsp.mkdir(path.join(root, '.sdd'), { recursive: true });
  await fsp.writeFile(path.join(root, '.sdd', '.update-check.json'), JSON.stringify(cache, null, 2), 'utf8');
}

/** The dotfile cache is only written inside an existing `.sdd/` (INV-4). */
async function seedSddRoot(root) {
  await fsp.mkdir(path.join(root, '.sdd'), { recursive: true });
}

async function fileExistsSafe(root, relative) {
  try {
    await fsp.readFile(path.join(root, relative));
    return true;
  } catch {
    return false;
  }
}

test('[U1][INV-5][INV-2] fetches the official registry endpoint and renders the notice', async () => {
  const root = await makeWorkspace();
  try {
    await seedSddRoot(root);
    const { state, fetchImpl } = registry('2.1.0');
    const result = await checkUpdate({ cwd: root, pkg: PKG, now: NOW, fetchImpl });

    // INV-5: stdlib fetch against the official npm registry endpoint only.
    assert.equal(state.urls[0], 'https://registry.npmjs.org/shodo/latest');
    assert.ok(state.options[0].signal instanceof AbortSignal);
    assert.equal(result.cached, false);
    assert.equal(result.notice, NOTICE);

    // The cache is refreshed on success (§3.2: { lastCheck, latest }).
    const cache = await readCache(root);
    assert.equal(cache.lastCheck, NOW);
    assert.equal(cache.latest, '2.1.0');
  } finally {
    await cleanup(root);
  }
});

test('[U2][INV-2] equal or lower remote version: no notice, cache still refreshed', async () => {
  const lower = await makeWorkspace();
  const equal = await makeWorkspace();
  try {
    await seedSddRoot(lower);
    await seedSddRoot(equal);
    const lowerStub = registry('1.9.9');
    const lowerResult = await checkUpdate({ cwd: lower, pkg: PKG, now: NOW, fetchImpl: lowerStub.fetchImpl });
    assert.equal(lowerResult.notice, null);
    assert.equal((await readCache(lower)).latest, '1.9.9');

    const equalStub = registry('2.0.0');
    const equalCheck = await checkUpdate({ cwd: equal, pkg: PKG, now: NOW, fetchImpl: equalStub.fetchImpl });
    assert.equal(equalCheck.notice, null);
    assert.equal(equalCheck.cached, false);
    // §6: equality refreshes the cache — otherwise every run would re-fetch.
    assert.equal(equalStub.state.fetches, 1);
    assert.equal((await readCache(equal)).latest, '2.0.0');
    assert.equal((await readCache(equal)).lastCheck, NOW);
  } finally {
    await cleanup(lower);
    await cleanup(equal);
  }
});

test('[U3][INV-2] malformed remote versions are silent', async () => {
  for (const version of ['2.1.0-beta', 'abc', '1.2', 'v2.1.0', '[IP_ADDRESS]']) {
    const root = await makeWorkspace();
    try {
      await seedSddRoot(root);
      const { state, fetchImpl } = registry(version);
      const result = await checkUpdate({ cwd: root, pkg: PKG, now: NOW, fetchImpl });
      assert.equal(result.notice, null, `version "${version}" must stay silent`);
      // A malformed answer is a failed check: lastCheck is refreshed anyway.
      const cache = await readCache(root);
      assert.equal(cache.lastCheck, NOW);
      assert.equal(cache.latest, null);
      assert.equal(state.fetches, 1);
    } finally {
      await cleanup(root);
    }
  }
});

test('[U4][INV-2] failures are silent and still refresh lastCheck: timeout, 500, malformed JSON, rejection', async () => {
  const cases = [
    {
      name: 'timeout',
      // A fetch that honors the abort signal (like the real stdlib fetch).
      fetchImpl: (_url, options = {}) => new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(options.signal.reason ?? new Error('aborted')));
      }),
      timeoutMs: 25,
    },
    { name: 'HTTP 500', fetchImpl: async () => ({ ok: false, status: 500 }) },
    { name: 'malformed JSON', fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token'); } }) },
    { name: 'rejected fetch', fetchImpl: async () => { throw new Error('registry unreachable'); } },
  ];

  for (const { name, fetchImpl, timeoutMs } of cases) {
    const root = await makeWorkspace();
    try {
      await seedSddRoot(root);
      const result = await checkUpdate({ cwd: root, pkg: PKG, now: NOW, timeoutMs, fetchImpl });
      assert.equal(result.notice, null, `${name}: silence`);
      assert.equal(result.cached, false);
      // §4.2/§6: lastCheck is updated even on failure — offline commands
      // must not re-probe (and re-pay the timeout) on every invocation.
      const cache = await readCache(root);
      assert.equal(cache.lastCheck, NOW, `${name}: lastCheck refreshed`);
      assert.equal(cache.latest, null, `${name}: no latest known`);
    } finally {
      await cleanup(root);
    }
  }
});

test('[U5][INV-1] the 24 h cache: fresh cache never fetches, expired cache fetches once', async () => {
  const fresh = await makeWorkspace();
  const expired = await makeWorkspace();
  try {
    // 2 h old: zero fetch, the notice is served from the cache.
    await writeCache(fresh, { lastCheck: NOW - 2 * 60 * 60 * 1000, latest: '2.1.0' });
    const freshStub = registry('2.1.0');
    const freshResult = await checkUpdate({ cwd: fresh, pkg: PKG, now: NOW, fetchImpl: freshStub.fetchImpl });
    assert.equal(freshStub.state.fetches, 0);
    assert.equal(freshResult.cached, true);
    assert.equal(freshResult.notice, NOTICE);

    // 25 h old: exactly one fetch, then the cache is rewritten.
    await writeCache(expired, { lastCheck: NOW - 25 * 60 * 60 * 1000, latest: '2.1.0' });
    const expiredStub = registry('2.1.0');
    const expiredResult = await checkUpdate({ cwd: expired, pkg: PKG, now: NOW, fetchImpl: expiredStub.fetchImpl });
    assert.equal(expiredStub.state.fetches, 1);
    assert.equal(expiredResult.cached, false);
    assert.equal(expiredResult.notice, NOTICE);
    assert.equal((await readCache(expired)).lastCheck, NOW);
  } finally {
    await cleanup(fresh);
    await cleanup(expired);
  }
});

test('[U6][INV-1] the per-process memory cache serves subsequent checks without fetching', async () => {
  const root = await makeWorkspace();
  try {
    const stub = registry('2.1.0');
    const first = await checkUpdate({ cwd: root, pkg: PKG, now: NOW, fetchImpl: stub.fetchImpl });
    assert.equal(first.cached, false);
    assert.equal(stub.state.fetches, 1);

    const second = await checkUpdate({ cwd: root, pkg: PKG, now: NOW + 1000, fetchImpl: stub.fetchImpl });
    assert.equal(stub.state.fetches, 1, 'no second fetch within the TTL');
    assert.equal(second.cached, true);
    assert.equal(second.notice, NOTICE);
  } finally {
    await cleanup(root);
  }
});

test('[U7][INV-4] without .sdd/ the cache is memory-only — nothing is ever written', async () => {
  const root = await makeWorkspace();
  try {
    const stub = registry('2.1.0');
    const first = await checkUpdate({ cwd: root, pkg: PKG, now: NOW, fetchImpl: stub.fetchImpl });
    assert.equal(first.notice, NOTICE);
    assert.equal(await fileExistsSafe(root, '.sdd/.update-check.json'), false);

    const second = await checkUpdate({ cwd: root, pkg: PKG, now: NOW + 5000, fetchImpl: stub.fetchImpl });
    assert.equal(stub.state.fetches, 1, 'memory cache prevents a second fetch');
    assert.equal(second.cached, true);
    assert.equal(await fileExistsSafe(root, '.sdd/.update-check.json'), false);
  } finally {
    await cleanup(root);
  }
});

test('[U8][INV-2] an unwritable cache file is tolerated silently', async () => {
  const root = await makeWorkspace();
  try {
    // The cache path is occupied by a directory — every write fails (the
    // hermetic stand-in for a read-only filesystem, cf. §6).
    await fsp.mkdir(path.join(root, '.sdd', '.update-check.json'), { recursive: true });
    const stub = registry('2.1.0');
    const result = await checkUpdate({ cwd: root, pkg: PKG, now: NOW, fetchImpl: stub.fetchImpl });
    assert.equal(stub.state.fetches, 1);
    assert.equal(result.notice, NOTICE);
  } finally {
    await cleanup(root);
  }
});

test('[U9][INV-3] opt-outs: --no-update-check flag or any non-empty SDD_NO_UPDATE_CHECK', () => {
  assert.equal(updateCheckDisabled({ flag: true }), true);
  assert.equal(updateCheckDisabled({ flag: true, env: {} }), true);
  assert.equal(updateCheckDisabled({ env: { SDD_NO_UPDATE_CHECK: '1' } }), true);
  assert.equal(updateCheckDisabled({ env: { SDD_NO_UPDATE_CHECK: '0' } }), true, 'any non-empty value counts');
  assert.equal(updateCheckDisabled({ env: { SDD_NO_UPDATE_CHECK: 'false' } }), true);
  assert.equal(updateCheckDisabled({ env: { SDD_NO_UPDATE_CHECK: '' } }), false);
  assert.equal(updateCheckDisabled({ env: {} }), false);
});