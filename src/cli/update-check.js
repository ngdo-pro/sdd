import path from 'node:path';
import fsp from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDir, specsRoot } from '../core/paths.js';

/**
 * Post-run update notice (spec 009-update-notice): one best-effort npm
 * registry probe per CLI invocation, with a 24 h cache. Every failure is
 * silent and the caller (main.js post-run hook) additionally wraps the whole
 * check in a total try/catch — a failing check never affects a command's
 * output order, stdout purity or exit code.
 */

const REGISTRY_URL = 'https://registry.npmjs.org'; // INV-5: official registry, stdlib fetch only.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_FILENAME = '.update-check.json'; // dotfile at the .sdd root — tolerated by root-layout (INV-4).

let installedPkg;

/** The CLI's own `{ name, version }`, read from package.json (memoized). */
function installedPackage() {
  if (!installedPkg) {
    installedPkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
    );
  }
  return installedPkg;
}

/**
 * Strict 3-segment numeric semver — `2.1.0`. No ranges, no prereleases;
 * anything else (including remote garbage) is treated as malformed.
 * @returns {number[] | null} [major, minor, patch]
 */
function parseSemver(version) {
  if (typeof version !== 'string') return null;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return match ? match.slice(1).map(Number) : null;
}

/** Strict major.minor.patch comparison: `candidate > installed` (numeric). */
function isNewer(candidate, installed) {
  const a = parseSemver(candidate);
  const b = parseSemver(installed);
  if (!a || !b) return false;
  for (let segment = 0; segment < 3; segment += 1) {
    if (a[segment] !== b[segment]) return a[segment] > b[segment];
  }
  return false;
}

function noticeFor(latest, installed, name) {
  return `· update available: v${latest} (installed: v${installed}) — npm i -g ${name}\n`;
}

/**
 * Opt-outs (INV-3): the `--no-update-check` flag or a non-empty
 * `SDD_NO_UPDATE_CHECK` environment value (any value counts, even `0`)
 * disable the check entirely — no fetch, no cache write.
 */
export function updateCheckDisabled({ flag = false, env = process.env } = {}) {
  if (flag) return true;
  const value = env.SDD_NO_UPDATE_CHECK;
  return typeof value === 'string' && value.length > 0;
}

// Per-process memory cache, one entry per workspace root (INV-4: when no
// `.sdd/` exists this is the only cache — lifetime = session).
const memoryCache = new Map(); // cwd → { lastCheck, latest }

async function readDotfileCache(cwd) {
  try {
    const parsed = JSON.parse(await fsp.readFile(path.join(specsRoot(cwd), CACHE_FILENAME), 'utf8'));
    if (typeof parsed.lastCheck !== 'number' || !Number.isFinite(parsed.lastCheck)) return null;
    return {
      lastCheck: parsed.lastCheck,
      latest: typeof parsed.latest === 'string' ? parsed.latest : null,
    };
  } catch {
    return null;
  }
}

/**
 * Writes the dotfile cache when a `.sdd/` workspace exists (never creates
 * one); best-effort — a read-only filesystem is tolerated silently (INV-2).
 */
async function writeDotfileCache(cwd, cache) {
  try {
    if (!(await isDir(specsRoot(cwd)))) return;
    await fsp.writeFile(path.join(specsRoot(cwd), CACHE_FILENAME), `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  } catch {
    // Cache write failures must never surface.
  }
}

/**
 * One best-effort update check.
 * @returns {Promise<{ notice: string | null, cached: boolean }>}
 *   `notice` is the one-line stderr message when a newer version is known —
 *   freshly fetched or remembered from a fresh cache; `cached` is true when
 *   the answer came from the cache without a fetch. Callers display the
 *   notice only when `!cached` (§4.2 "Fraîcheur: aucun fetch, aucun
 *   affichage"), which caps it at one display per 24 h per workspace while
 *   the module itself stays a pure `{ notice, cached }` API.
 *
 * Never throws; the cache is refreshed even when the fetch fails (offline
 * sessions must not re-probe on every command — §4.2) and even during
 * `--dry-run` invocations (the dotfile lives outside the model graph).
 */
export async function checkUpdate({ cwd, pkg, timeoutMs = 1500, now = Date.now(), fetchImpl = globalThis.fetch } = {}) {
  let installed;
  let name;
  try {
    ({ version: installed, name } = pkg ?? installedPackage());
  } catch {
    return { notice: null, cached: false };
  }

  // 1. Fresh cache (memory first, then the dotfile) → serve without fetching.
  const memory = memoryCache.get(cwd);
  if (memory && now - memory.lastCheck < CACHE_TTL_MS) {
    return {
      notice: isNewer(memory.latest, installed) ? noticeFor(memory.latest, installed, name) : null,
      cached: true,
    };
  }
  const dotfile = await readDotfileCache(cwd);
  if (dotfile && now - dotfile.lastCheck < CACHE_TTL_MS) {
    memoryCache.set(cwd, dotfile);
    return {
      notice: isNewer(dotfile.latest, installed) ? noticeFor(dotfile.latest, installed, name) : null,
      cached: true,
    };
  }

  // 2. Expired or absent cache → exactly one registry fetch (INV-5).
  const previousLatest = memory?.latest ?? dotfile?.latest ?? null;
  let latest = null;
  try {
    const response = await fetchImpl(`${REGISTRY_URL}/${encodeURIComponent(name)}/latest`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`registry responded ${response.status}`);
    const payload = await response.json();
    if (!parseSemver(payload?.version)) throw new Error('malformed remote version');
    latest = payload.version;
  } catch {
    // Timeout, HTTP error, malformed JSON/semver, offline — all silent;
    // `lastCheck` is still refreshed and the last known `latest` is kept.
    memoryCache.set(cwd, { lastCheck: now, latest: previousLatest });
    await writeDotfileCache(cwd, { lastCheck: now, latest: previousLatest });
    return { notice: null, cached: false };
  }

  // 3. Refresh the cache (equality included — §6) and decide on the notice.
  memoryCache.set(cwd, { lastCheck: now, latest });
  await writeDotfileCache(cwd, { lastCheck: now, latest });
  return { notice: isNewer(latest, installed) ? noticeFor(latest, installed, name) : null, cached: false };
}