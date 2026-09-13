import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { ALLOWED_ROOT_ENTRIES, generatedRoot, standardLayout } from '../src/core/paths.js';
import { projectionRelativePath } from '../src/model/layout.js';
import { createMeta } from '../src/model/schema.js';
import { loadModel } from '../src/model/store.js';
import { renderProjections } from '../src/render/projections.js';
import { linkTarget } from '../src/render/markdown.js';
import { init } from '../src/cli/commands/init.js';
import { upsert } from '../src/cli/commands/upsert.js';
import { move } from '../src/cli/commands/move.js';
import { render } from '../src/cli/commands/render.js';
import { validate } from '../src/cli/commands/validate.js';
import { makeWorkspace, cleanup, seedModel, writeFiles, fileExists, MODEL_FIXTURE } from './helpers.js';
import { writeIndex } from '../src/model/index.js';

/** The fixture extended with the vision (the fourth projected artifact). */
const FULL_FIXTURE = [
  { kind: 'vision', slug: 'vision', title: 'Demo', body: '## 1. Core Purpose\n\nDemo.\n' },
  ...MODEL_FIXTURE,
];

const BASE_FLAGS = {
  to: undefined, kind: undefined, state: undefined, slug: undefined, title: undefined,
  from: undefined, feature: undefined, initiative: undefined, field: undefined,
  backends: undefined, create: false, force: false, check: false, write: false,
  cascade: false, undo: false, done: false, site: false, dryRun: false, json: false,
};

function ctx(cwd, positionals = [], flags = {}) {
  return { cwd, positionals, flags: { ...BASE_FLAGS, ...flags } };
}

async function silently(handler) {
  const original = process.stdout.write;
  process.stdout.write = () => true;
  try {
    return await handler();
  } finally {
    process.stdout.write = original;
  }
}

/** Captures stdout while measuring `process.exitCode` (validate checks). */
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

/** Runs a handler muting stdout and returns the resulting process.exitCode. */
async function exitCodeOf(handler) {
  return silently(async () => {
    process.exitCode = 0;
    await handler();
    return process.exitCode;
  });
}

/** Snapshot of every file under a directory: `{ relativePath: content }`. */
async function snapshot(root, base) {
  const files = {};
  async function walk(directory) {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        const relative = path.relative(root, absolute).split(path.sep).join('/');
        files[relative] = await fsp.readFile(absolute, 'utf8');
      }
    }
  }
  await walk(path.join(root, base));
  return files;
}

/** Sorted list of every path under a base directory (files + dirs). */
async function listPaths(root, base) {
  const paths = [];
  async function walk(directory) {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const relative = path.relative(root, path.join(directory, entry.name)).split(path.sep).join('/');
      paths.push(relative);
      if (entry.isDirectory()) await walk(path.join(directory, entry.name));
    }
  }
  await walk(path.join(root, base));
  return paths.sort();
}

/** Seeds the full fixture (overridable state), renders it and writes the index. */
async function seedModelAndRender(root, state = 'active') {
  await seedModel(root, FULL_FIXTURE.map((definition) => ({ ...definition, state })));
  const artifacts = await loadModel(root);
  await renderProjections(root, artifacts);
  await writeIndex(root, artifacts);
}

// ============================================================================
// Unit Tests (@unit) — §8.1 scenarios U1–U4
// ============================================================================

test('[U1][INV-1] projection paths derive from relations alone, under generated/', () => {
  const vision = createMeta({ kind: 'vision', slug: 'vision' });
  const initiative = createMeta({ kind: 'initiative', slug: 'demo', state: 'active' });
  const feature = createMeta({
    kind: 'feature',
    slug: '01-login',
    state: 'active',
    relations: { initiative: 'demo' },
  });
  const spec = createMeta({
    kind: 'spec',
    slug: '042-login',
    state: 'active',
    relations: { feature: '01-login', initiative: 'demo' },
  });

  // The signature no longer threads any option — no state ever reaches a path.
  assert.equal(projectionRelativePath.length, 1);
  assert.equal(projectionRelativePath(vision), 'generated/vision.md');
  assert.equal(projectionRelativePath(initiative), 'generated/initiatives/demo/README.md');
  assert.equal(projectionRelativePath(feature), 'generated/initiatives/demo/features/01-login.md');
  // Flat at the initiative level: file name is the bare id, zero state segment.
  assert.equal(projectionRelativePath(spec), 'generated/initiatives/demo/specs/042.md');

  // A transition never changes a projection path (end of state renames).
  assert.equal(
    projectionRelativePath({ ...spec, state: 'archived' }),
    projectionRelativePath({ ...spec, state: 'planned' }),
  );
});

test('[U2][INV-1] generatedRoot, exhaustive root and untouched init layout', async () => {
  const root = await makeWorkspace();
  try {
    assert.equal(generatedRoot(root), path.join(root, '.sdd', 'generated'));
    // `site/` appended by feature 04-static-site: tolerated, never required,
    // never pre-allocated.
    assert.deepEqual([...ALLOWED_ROOT_ENTRIES], ['config.json', 'canonical', 'generated', 'knowledge', 'site']);

    // `spec init` still pre-allocates nothing beyond the canonical store.
    assert.deepEqual(standardLayout(root), [path.join(root, '.sdd'), path.join(root, '.sdd', 'canonical')]);
    await silently(() => init(ctx(root)));
    assert.deepEqual(await listPaths(root, '.sdd'), ['.sdd/canonical', '.sdd/config.json']);
  } finally {
    await cleanup(root);
  }
});

test('[U3][INV-2] the prune removes an orphan projection from generated/ and lists it', async () => {
  const root = await makeWorkspace();
  try {
    await seedModelAndRender(root);
    await writeFiles(root, { '.sdd/generated/initiatives/notes.md': '# Notes\n' });

    const results = await renderProjections(root, await loadModel(root));
    const orphan = results.find((entry) => entry.kind === 'orphan');

    assert.equal(await fileExists(root, '.sdd/generated/initiatives/notes.md'), false);
    assert.deepEqual(
      { kind: orphan.kind, status: orphan.status, path: orphan.path },
      { kind: 'orphan', status: 'removed', path: 'generated/initiatives/notes.md' },
    );
  } finally {
    await cleanup(root);
  }
});

test('[U4][INV-1] generated cross links resolve in relative POSIX form', () => {
  // Feature → spec, both flattened under the initiative namespace.
  assert.equal(
    linkTarget('generated/initiatives/demo/features/01-login.md', 'generated/initiatives/demo/specs/042.md'),
    '../specs/042.md',
  );
  // Vision → initiative README, from generated/vision.md.
  assert.equal(
    linkTarget('generated/vision.md', 'generated/initiatives/demo/README.md'),
    './initiatives/demo/README.md',
  );
});

// ============================================================================
// Component Tests (@component) — §8.1 scenarios C1–C6
// ============================================================================

test('[C1][INV-2] move regenerates at the same projection path — no rename, no removal', async () => {
  const root = await makeWorkspace();
  try {
    await seedModelAndRender(root, 'planned');
    const canonicalBefore = await listPaths(root, '.sdd/canonical');
    const generatedBefore = await listPaths(root, '.sdd/generated');
    const projectionBefore = await snapshot(root, '.sdd/generated');

    await silently(() => move(ctx(root, ['042'], { to: 'active' })));

    // Same path — no projection renamed, removed, or re-created. A spec
    // projection renders no lifecycle field, so its content is even
    // bit-identical: transitions live in metadata and the index only.
    assert.equal(await fileExists(root, '.sdd/generated/initiatives/demo/specs/042.md'), true);
    assert.deepEqual(await listPaths(root, '.sdd/generated'), generatedBefore);
    assert.deepEqual(await listPaths(root, '.sdd/canonical'), canonicalBefore);
    assert.equal(
      await fsp.readFile(path.join(root, '.sdd/generated/initiatives/demo/specs/042.md'), 'utf8'),
      projectionBefore['.sdd/generated/initiatives/demo/specs/042.md'],
    );
  } finally {
    await cleanup(root);
  }
});

test('[C2][INV-2] render writes generated/ and leaves legacy entries to spec migrate', async () => {
  const root = await makeWorkspace();
  try {
    await seedModelAndRender(root);
    // Legacy v2-named entries parked at the .sdd/ root: the render's horizon
    // is generated/ ONLY — the v2 sweep was retired with the .sdd/ cutover.
    await writeFiles(root, {
      '.sdd/config.json': JSON.stringify({ version: 2 }),
      '.sdd/vision.md': '# Product Vision: Demo\n',
      '.sdd/specs/active/042-login.md': '# Spec: 042 - Magic link\n',
      '.sdd/initiatives/active/demo/README.md': '# Initiative: Demo\n',
      '.sdd/initiatives/active/demo/active/01-login.md': '# Feature: Login\n',
    });

    const results = await renderProjections(root, await loadModel(root));

    // Every expected projection is (re)written under generated/, vision included.
    assert.equal(await fileExists(root, '.sdd/generated/vision.md'), true);
    assert.equal(await fileExists(root, '.sdd/generated/initiatives/demo/README.md'), true);
    assert.equal(await fileExists(root, '.sdd/generated/initiatives/demo/features/01-login.md'), true);
    assert.equal(await fileExists(root, '.sdd/generated/initiatives/demo/specs/042.md'), true);

    // The legacy tree is untouched — no sweep. `spec migrate` owns conversion.
    assert.equal(await fileExists(root, '.sdd/vision.md'), true);
    assert.equal(await fileExists(root, '.sdd/specs/active/042-login.md'), true);
    assert.equal(await fileExists(root, '.sdd/initiatives/active/demo/README.md'), true);
    assert.equal(results.some((entry) => entry.kind === 'orphan' && entry.status === 'removed'), false);

    // Authored content is out of the render's reach.
    assert.equal(await fileExists(root, '.sdd/canonical/initiatives/demo/demo.json'), true);
  } finally {
    await cleanup(root);
  }
});

test('[C3][INV-2] render --dry-run previews removals without writing anything', async () => {
  const root = await makeWorkspace();
  try {
    // An orphan under generated/ only: legacy entries are outside the horizon.
    await seedModel(root, FULL_FIXTURE);
    await renderProjections(root, await loadModel(root));
    await writeFiles(root, { '.sdd/generated/stray.md': '# Stray\n' });
    const before = await snapshot(root, '.sdd');

    const results = await renderProjections(root, await loadModel(root), { dryRun: true });

    assert.deepEqual(await snapshot(root, '.sdd'), before);
    assert.equal(results.filter((entry) => entry.status === 'created').length, 0);
    assert.deepEqual(
      results.filter((entry) => entry.status === 'removed').map((entry) => entry.path).sort(),
      ['generated/stray.md'],
    );
  } finally {
    await cleanup(root);
  }
});

test('[C4][INV-3] render --check fails on any generated/ drift and on it alone', async () => {
  const root = await makeWorkspace();
  try {
    await seedModelAndRender(root);

    // Stale + missing projections, plus a parasite under knowledge/ (out of scope).
    await fsp.writeFile(path.join(root, '.sdd/generated/vision.md'), 'tampered\n', 'utf8');
    await fsp.rm(path.join(root, '.sdd/generated/initiatives/demo/specs/042.md'));
    await writeFiles(root, { '.sdd/knowledge/domains/auth/stray.md': '# Stray\n' });

    const drift = await renderProjections(root, await loadModel(root), { check: true });
    assert.deepEqual(
      drift
        .filter((entry) => entry.status === 'stale' || entry.status === 'missing')
        .map((entry) => [entry.status, entry.path])
        .sort(),
      [
        ['missing', 'generated/initiatives/demo/specs/042.md'],
        ['stale', 'generated/vision.md'],
      ],
    );
    assert.equal(drift.some((entry) => entry.path.includes('knowledge/')), false);

    // An unexpected markdown under generated/ is reported as an orphan finding.
    await writeFiles(root, { '.sdd/generated/stray.md': '# Stray\n' });
    const unexpected = await renderProjections(root, await loadModel(root), { check: true });
    const found = unexpected.find((entry) => entry.path === 'generated/stray.md');
    assert.deepEqual({ kind: found.kind, status: found.status }, { kind: 'orphan', status: 'unexpected' });
  } finally {
    await cleanup(root);
  }
});

test('[C5][INV-1] validate enforces the exhaustive root and tolerates dotfiles', async () => {
  const root = await makeWorkspace();
  try {
    await seedModelAndRender(root);
    await writeFiles(root, { '.sdd/docs/notes.md': '# Notes\n', '.sdd/.DS_Store': '' });

    const { output, exitCode } = await capturingExitCode(() => validate(ctx(root)));
    assert.match(output, /\[root-layout\]/);
    assert.match(output, /unexpected root entry "docs\/"/);
    assert.equal(output.includes('.DS_Store'), false);
    assert.equal(exitCode, 1);
    process.exitCode = 0;
  } finally {
    await cleanup(root);
  }
});

test('[C6][INV-4] projections.markdown false cuts every markdown projection write', async () => {
  const root = await makeWorkspace();
  try {
    await silently(() => init(ctx(root)));
    await writeFiles(root, {
      '.sdd/config.json': JSON.stringify({ version: 2, projections: { markdown: false } }),
    });

    await silently(() => upsert(ctx(root, ['initiative'], { slug: 'demo', title: 'Demo' })));

    // No markdown outside canonical/; the index is still regenerated.
    assert.equal(await fileExists(root, '.sdd/generated'), false);
    assert.equal(await fileExists(root, '.sdd/canonical/initiatives/demo/demo.json'), true);
    const index = JSON.parse(await fsp.readFile(path.join(root, '.sdd/canonical/index.json'), 'utf8'));
    assert.equal(index.artifacts.length, 1);

    await silently(() => render(ctx(root)));
    assert.equal(await fileExists(root, '.sdd/generated'), false);

    // --check exits 0 vacuously (zero projection expected or verified).
    assert.equal(await exitCodeOf(() => render(ctx(root, [], { check: true }))), 0);
    process.exitCode = 0;
  } finally {
    await cleanup(root);
  }
});

// ============================================================================
// Integration Tests (@integration) — §8.1 scenarios I1, I2
// ============================================================================

test('[I1][INV-1][INV-2] full CLI cycle: exact and stable generated tree', async () => {
  const root = await makeWorkspace();
  try {
    await silently(() => init(ctx(root)));
    await silently(() => upsert(ctx(root, ['vision'], {})));
    await silently(() => upsert(ctx(root, ['initiative'], { slug: 'demo', title: 'Demo' })));
    await silently(() => upsert(ctx(root, ['feature'], { slug: '01-login', title: 'Login', initiative: 'demo' })));
    await silently(() => upsert(ctx(root, ['spec'], { slug: '042-login', title: 'Magic link', feature: '01-login' })));

    const expectedTree = [
      '.sdd/generated/initiatives',
      '.sdd/generated/initiatives/demo',
      '.sdd/generated/initiatives/demo/README.md',
      '.sdd/generated/initiatives/demo/features',
      '.sdd/generated/initiatives/demo/features/01-login.md',
      '.sdd/generated/initiatives/demo/specs',
      '.sdd/generated/initiatives/demo/specs/042.md',
      '.sdd/generated/vision.md',
    ].sort();
    assert.deepEqual(await listPaths(root, '.sdd/generated'), expectedTree);

    // Every move regenerates content at the same paths — no projection file
    // is ever created or deleted by a transition.
    for (const [reference, to] of [['demo', 'active'], ['01-login', 'active'], ['042', 'active']]) {
      await silently(() => move(ctx(root, [reference], { to })));
      assert.deepEqual(await listPaths(root, '.sdd/generated'), expectedTree);
    }

    const index = JSON.parse(await fsp.readFile(path.join(root, '.sdd/canonical/index.json'), 'utf8'));
    assert.deepEqual(
      index.artifacts.map((artifact) => artifact.projection).sort(),
      [
        '.sdd/generated/initiatives/demo/README.md',
        '.sdd/generated/initiatives/demo/features/01-login.md',
        '.sdd/generated/initiatives/demo/specs/042.md',
        '.sdd/generated/vision.md',
      ],
    );
  } finally {
    await cleanup(root);
  }
});

test('[I2][INV-1] validate is green on the exhaustive root, flags violations otherwise', async () => {
  const root = await makeWorkspace();
  try {
    await seedModelAndRender(root);
    assert.equal(await exitCodeOf(() => validate(ctx(root))), 0);

    await writeFiles(root, { '.sdd/legacy/old.md': '# Old\n' });
    const { output, exitCode } = await capturingExitCode(() => validate(ctx(root)));
    assert.match(output, /\[root-layout\]/);
    assert.match(output, /legacy\/"/);
    assert.equal(exitCode, 1);
    process.exitCode = 0;
  } finally {
    await cleanup(root);
  }
});
