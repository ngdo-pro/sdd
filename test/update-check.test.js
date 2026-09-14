import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { checkUpdate, updateCheckDisabled } from '../src/cli/update-check.js';
import { run } from '../src/cli/main.js';
import { VERSION } from '../src/cli/help.js';
import { makeWorkspace, cleanup, seedModel, MODEL_FIXTURE } from './helpers.js';

const NOW = 1_700_000_000_000;
const PKG = { name: '@ngdo-pro/sdd', version: '2.0.0' };
const NOTICE = '· update available: v2.1.0 (installed: v2.0.0) — npm i -g @ngdo-pro/sdd\n';

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
    assert.equal(state.urls[0], 'https://registry.npmjs.org/%40ngdo-pro%2Fsdd/latest');
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
    // 2 h old: zero fetch, the notice is served from the cache. (Spec 011:
    // the seed carries the installedVersion stamp — an unstamped cache is
    // legacy and would be invalidated, see U12.)
    await writeCache(fresh, { lastCheck: NOW - 2 * 60 * 60 * 1000, latest: '2.1.0', installedVersion: '2.0.0' });
    const freshStub = registry('2.1.0');
    const freshResult = await checkUpdate({ cwd: fresh, pkg: PKG, now: NOW, fetchImpl: freshStub.fetchImpl });
    assert.equal(freshStub.state.fetches, 0);
    assert.equal(freshResult.cached, true);
    assert.equal(freshResult.notice, NOTICE);

    // 25 h old: exactly one fetch, then the cache is rewritten.
    await writeCache(expired, { lastCheck: NOW - 25 * 60 * 60 * 1000, latest: '2.1.0', installedVersion: '2.0.0' });
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

// ============================================================================
// Cache invalidation on binary version change — spec 011, §8.1
// Every cache entry (memory + dotfile) carries `installedVersion`. A fresh
// (< 24 h) entry is ignored when its stamp differs from the running binary's
// version, or when it has no stamp (legacy / partially formed dotfile) — an
// upgrade always triggers exactly one fresh check. Equality keeps the strict
// 009 behavior: zero fetch. The mismatch is simulated through the `pkg` seam
// only — the real package.json is never bumped, and no test talks to the
// network (fetchImpl is always injected).
// ============================================================================

test('[U10][INV-1] a fresh cache stamped with another version is ignored: one fetch, rewrite stamped with the running version', async () => {
  const equal = await makeWorkspace();
  const superior = await makeWorkspace();
  try {
    const upgraded = { ...PKG, version: '2.0.2' };

    // Fresh (< 24 h) but stamped with the OLD binary version 2.0.1 → invalid.
    await writeCache(equal, { lastCheck: NOW - 2 * 60 * 60 * 1000, latest: '2.0.2', installedVersion: '2.0.1' });
    const equalStub = registry('2.0.2');
    const equalResult = await checkUpdate({ cwd: equal, pkg: upgraded, now: NOW, fetchImpl: equalStub.fetchImpl });
    assert.equal(equalStub.state.fetches, 1, 'version mismatch invalidates the cache despite < 24 h');
    assert.equal(equalResult.cached, false);
    assert.equal(equalResult.notice, null, 'registry equal to the installed version: silence');
    // The dotfile was never deleted — the fresh check rewrote it in place,
    // stamped with the running version (§4.1: zero extra fs on the read path).
    assert.deepEqual(await readCache(equal), { lastCheck: NOW, latest: '2.0.2', installedVersion: '2.0.2' });

    // Same mismatch, registry superior → the notice finally surfaces.
    await writeCache(superior, { lastCheck: NOW - 2 * 60 * 60 * 1000, latest: '2.0.2', installedVersion: '2.0.1' });
    const superiorStub = registry('2.0.3');
    const superiorResult = await checkUpdate({ cwd: superior, pkg: upgraded, now: NOW, fetchImpl: superiorStub.fetchImpl });
    assert.equal(superiorStub.state.fetches, 1);
    assert.equal(superiorResult.cached, false);
    assert.equal(superiorResult.notice, '· update available: v2.0.3 (installed: v2.0.2) — npm i -g @ngdo-pro/sdd\n');
  } finally {
    await cleanup(equal);
    await cleanup(superior);
  }
});

test('[U11][INV-1] an upgrade mid-session refetches: the memory cache is invalidated too (the production bug)', async () => {
  const root = await makeWorkspace();
  try {
    await seedSddRoot(root);
    // Session 1 (binary 2.0.1): the probe fails during the npm replication
    // window — the cache keeps `latest: null` for 24 h.
    const failing = async () => {
      throw new Error('version not replicated yet');
    };
    const first = await checkUpdate({ cwd: root, pkg: { ...PKG, version: '2.0.1' }, now: NOW, fetchImpl: failing });
    assert.equal(first.notice, null);

    // Session 2: the binary is upgraded to 2.0.2 — the < 24 h memory entry is
    // stamped 2.0.1 → ignored, exactly one fresh fetch, and the registry (now
    // replicated) answers: the notice appears instead of staying hidden until
    // cache expiry.
    const stub = registry('2.0.3');
    const second = await checkUpdate({ cwd: root, pkg: { ...PKG, version: '2.0.2' }, now: NOW + 1000, fetchImpl: stub.fetchImpl });
    assert.equal(stub.state.fetches, 1, 'upgrade ⇒ exactly one fresh check despite the < 24 h cache');
    assert.equal(second.cached, false);
    assert.equal(second.notice, '· update available: v2.0.3 (installed: v2.0.2) — npm i -g @ngdo-pro/sdd\n');
    assert.deepEqual(await readCache(root), { lastCheck: NOW + 1000, latest: '2.0.3', installedVersion: '2.0.2' });
  } finally {
    await cleanup(root);
  }
});

test('[U12][INV-2] legacy caches without installedVersion and non-string stamps are ignored', async () => {
  const legacy = await makeWorkspace();
  const malformed = await makeWorkspace();
  try {
    await seedSddRoot(legacy);
    await seedSddRoot(malformed);
    // Legacy: a fresh dotfile written before spec 011 — no installedVersion.
    await writeCache(legacy, { lastCheck: NOW, latest: '9.9.9' });
    // Partially formed dotfile: the key exists but the value is not a string.
    await writeCache(malformed, { lastCheck: NOW, latest: '9.9.9', installedVersion: 42 });

    for (const [root, label] of [[legacy, 'legacy'], [malformed, 'non-string stamp']]) {
      const stub = registry('9.9.9');
      const result = await checkUpdate({ cwd: root, pkg: PKG, now: NOW, fetchImpl: stub.fetchImpl });
      assert.equal(stub.state.fetches, 1, `${label}: the cache is ignored despite being fresh`);
      assert.equal(result.cached, false);
      assert.equal(result.notice, '· update available: v9.9.9 (installed: v2.0.0) — npm i -g @ngdo-pro/sdd\n');
      // The rewrite heals the cache: stamped with the running version.
      assert.deepEqual(await readCache(root), { lastCheck: NOW, latest: '9.9.9', installedVersion: '2.0.0' });
    }
  } finally {
    await cleanup(legacy);
    await cleanup(malformed);
  }
});

test('[U13][INV-3] equality keeps the 009 behavior: a fresh, correctly stamped cache serves with zero fetch', async () => {
  const root = await makeWorkspace();
  try {
    await seedSddRoot(root);
    // Exactly what spec 011 writes from now on: fresh + stamped with the
    // running version — the servable case must be strictly unchanged (009).
    await writeCache(root, { lastCheck: NOW - 2 * 60 * 60 * 1000, latest: '2.1.0', installedVersion: '2.0.0' });
    const stub = registry('2.1.0');
    const result = await checkUpdate({ cwd: root, pkg: PKG, now: NOW, fetchImpl: stub.fetchImpl });
    assert.equal(stub.state.fetches, 0, 'fresh + same version ⇒ zero fetch (009 unchanged)');
    assert.equal(result.cached, true);
    assert.equal(result.notice, NOTICE);
  } finally {
    await cleanup(root);
  }
});

test('[U14][INV-3] every write carries installedVersion — success, network failure and the memory cache', async () => {
  const success = await makeWorkspace();
  const failure = await makeWorkspace();
  try {
    await seedSddRoot(success);
    await seedSddRoot(failure);

    // Success path: the dotfile is stamped (INV-3: additive schema).
    const okStub = registry('2.1.0');
    await checkUpdate({ cwd: success, pkg: PKG, now: NOW, fetchImpl: okStub.fetchImpl });
    assert.deepEqual(await readCache(success), { lastCheck: NOW, latest: '2.1.0', installedVersion: '2.0.0' });

    // Network-failure path: the silent rewrite still carries the stamp — a
    // single unstamped write would leave the bug alive on this path (§6).
    let failures = 0;
    const down = async () => {
      failures += 1;
      throw new Error('offline');
    };
    await checkUpdate({ cwd: failure, pkg: PKG, now: NOW, fetchImpl: down });
    assert.deepEqual(await readCache(failure), { lastCheck: NOW, latest: null, installedVersion: '2.0.0' });

    // Memory write path: the next call is served from the stamped memory
    // entry — zero fetch (otherwise failures would count 2).
    const later = await checkUpdate({ cwd: failure, pkg: PKG, now: NOW + 1000, fetchImpl: down });
    assert.equal(failures, 1, 'the second call is served from the memory cache');
    assert.equal(later.cached, true);
    assert.equal(later.notice, null);
  } finally {
    await cleanup(success);
    await cleanup(failure);
  }
});

// ============================================================================
// @component — spec 011 §8.1: the e2e upgrade journey through the real CLI
// ============================================================================

/**
 * Runs the real CLI (post-run hook included) capturing stdout and stderr as
 * ordered events — the update notice must stay the last event. Mirrors the
 * `runObserved` harness of cli.test.js: `SDD_NO_UPDATE_CHECK` is neutralized
 * so the check actually runs, and `fetchImpl` is injected so no test ever
 * talks to the real npm registry.
 */
async function runObserved(args, root, { fetchImpl } = {}) {
  const events = [];
  const originalStdout = process.stdout.write;
  const originalStderr = process.stderr.write;
  const originalEnv = process.env.SDD_NO_UPDATE_CHECK;
  delete process.env.SDD_NO_UPDATE_CHECK;
  process.stdout.write = (chunk) => {
    events.push(['stdout', String(chunk)]);
    return true;
  };
  process.stderr.write = (chunk) => {
    events.push(['stderr', String(chunk)]);
    return true;
  };
  try {
    process.exitCode = 0;
    await run([...args, '--cwd', root], { fetchImpl });
    const stream = (name) => events.filter(([writer]) => writer === name).map(([, text]) => text).join('');
    return { events, stdout: stream('stdout'), stderr: stream('stderr'), exitCode: process.exitCode };
  } finally {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
    if (originalEnv === undefined) delete process.env.SDD_NO_UPDATE_CHECK;
    else process.env.SDD_NO_UPDATE_CHECK = originalEnv;
    process.exitCode = 0;
  }
}

test('[C1][INV-1] e2e upgrade: `sdd list` ignores the stale cache, refetches once and rewrites it with the running version', async () => {
  assert.notEqual(VERSION, '0.0.0', 'the seed simulates the previous binary version — it must differ from the real one');
  const equal = await makeWorkspace();
  const superior = await makeWorkspace();
  try {
    // Both workspaces hold a < 24 h cache written by the previous binary
    // ("0.0.0") while the running binary is the real package version.
    for (const root of [equal, superior]) {
      await seedModel(root, MODEL_FIXTURE);
      await writeCache(root, {
        lastCheck: Date.now() - 60 * 60 * 1000,
        latest: VERSION,
        installedVersion: '0.0.0',
      });
    }

    // Registry equal to the running version: the upgrade triggers exactly one
    // fresh check whose answer stays silent — but the cache is rewritten,
    // stamped with the running version (the stale `latest` cannot outlive it).
    const equalRegistry = registry(VERSION);
    const first = await runObserved(['list'], equal, { fetchImpl: equalRegistry.fetchImpl });
    assert.equal(equalRegistry.state.fetches, 1, 'upgrade ⇒ one fresh check despite the < 24 h cache');
    assert.equal(first.exitCode, 0);
    assert.match(first.stdout, /artifact/);
    assert.equal(first.stderr, '', 'registry equal to the installed version: silence');
    const equalCache = await readCache(equal);
    assert.equal(equalCache.installedVersion, VERSION);
    assert.equal(equalCache.latest, VERSION);
    assert.ok(Number.isFinite(equalCache.lastCheck));

    // Rerun: the rewritten cache is servable — zero fetch, zero stderr (009).
    const second = await runObserved(['list'], equal, { fetchImpl: equalRegistry.fetchImpl });
    assert.equal(equalRegistry.state.fetches, 1, 'the rewritten cache is served without fetching');
    assert.equal(second.stderr, '');

    // Registry superior: after the very same upgrade the notice surfaces —
    // stderr only, strictly after the command output.
    const superiorRegistry = registry('9.9.9');
    const upgraded = await runObserved(['list'], superior, { fetchImpl: superiorRegistry.fetchImpl });
    assert.equal(superiorRegistry.state.fetches, 1);
    assert.equal(
      upgraded.stderr,
      `· update available: v9.9.9 (installed: v${VERSION}) — npm i -g @ngdo-pro/sdd\n`,
    );
    assert.ok(upgraded.events.length > 1);
    assert.equal(upgraded.events[upgraded.events.length - 1][0], 'stderr');
    assert.ok(upgraded.events.slice(0, -1).every(([writer]) => writer === 'stdout'));
    assert.equal((await readCache(superior)).installedVersion, VERSION);
  } finally {
    await cleanup(equal);
    await cleanup(superior);
  }
});