import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { detectLayout, planMigration, runMigration } from '../src/migrate/migrate.js';
import { importMarkdown } from '../src/migrate/import.js';
import { MigrationError } from '../src/core/errors.js';
import { findPortablePathViolations } from '../src/core/rules.js';
import { convertConfig } from '../src/core/config.js';
import { extractParentInitiative, extractSpecSlugs } from '../src/migrate/parse.js';
import { loadModel, findByRef } from '../src/model/store.js';
import { init } from '../src/cli/commands/init.js';
import { upsert } from '../src/cli/commands/upsert.js';
import { move } from '../src/cli/commands/move.js';
import { render } from '../src/cli/commands/render.js';
import { status } from '../src/cli/commands/status.js';
import { validate } from '../src/cli/commands/validate.js';
import { list } from '../src/cli/commands/list.js';
import { importArtifacts } from '../src/cli/commands/import.js';
import { migrate } from '../src/cli/commands/migrate.js';
import { model } from '../src/cli/commands/model.js';
import { existsSync } from 'node:fs';
import { makeWorkspace, cleanup, writeFiles, fileExists, readWorkspaceFile } from './helpers.js';

// ============================================================================
// Fixtures — legacy layouts under the LITERAL .specs/ root (watchout §6:
// legacy fixtures are never routed via SPECS_DIRNAME, which is .sdd/ now).
// ============================================================================

const V2_MARKDOWN = {
  initiative: '# Initiative: Demo\n\n---\n\n## 1. Intent & The Gap\n\nDemo initiative.\n',
  feature: (with1042) => `# Feature: Login\n\n> **Parent Initiative:** \`demo\`\n\n---\n\n## 1. Problem\n\nLogin.\n\n---\n\n## 6. Implementation Spec(s)\n\n- [ ] **\`042-login\`** : Magic link${with1042 ? '\n- [ ] **`1042-signup`** : Signup' : ''}\n`,
};

/** A pure v2 workspace: model/ index + JSON metadata + sibling bodies. */
function v2ModelWorkspace({ spec042State = 'planned', link1042 = true } = {}) {
  const files = {
    '.specs/config.json': JSON.stringify({ version: 2, sourceOfTruth: 'model', projections: { markdown: true } }),
    '.specs/model/index.json': JSON.stringify({
      version: 2,
      sourceOfTruth: 'model',
      artifacts: link1042
        ? [
          { kind: 'vision', id: 'vision', slug: 'vision' },
          { kind: 'initiative', id: 'demo', slug: 'demo' },
          { kind: 'feature', id: '01-login', slug: '01-login' },
          { kind: 'spec', id: '042', slug: '042-login' },
          { kind: 'spec', id: '1042', slug: '1042-signup' },
        ]
        : [
          { kind: 'vision', id: 'vision', slug: 'vision' },
          { kind: 'initiative', id: 'demo', slug: 'demo' },
          { kind: 'feature', id: '01-login', slug: '01-login' },
          { kind: 'spec', id: '042', slug: '042-login' },
        ],
    }, null, 2),
    '.specs/model/vision.json': JSON.stringify({
      version: 2, kind: 'vision', id: 'vision', slug: 'vision', title: 'Demo', state: null,
      relations: {}, fields: {}, remote: {}, progress: { done: false },
      createdAt: '2026-09-12', updatedAt: '2026-09-12',
    }, null, 2),
    '.specs/model/vision.md': '# Product Vision: Demo\n\n## 1. Core Purpose\n\nDemo.\n',
    '.specs/model/initiatives/planned/demo/demo.json': JSON.stringify({
      version: 2, kind: 'initiative', id: 'demo', slug: 'demo', title: 'Demo', state: 'planned',
      relations: {}, fields: {}, remote: {}, progress: { done: false },
      createdAt: '2026-09-12', updatedAt: '2026-09-12',
    }, null, 2),
    '.specs/model/initiatives/planned/demo/demo.md': V2_MARKDOWN.initiative,
    '.specs/model/initiatives/planned/demo/active/01-login/01-login.json': JSON.stringify({
      version: 2, kind: 'feature', id: '01-login', slug: '01-login', title: 'Login', state: 'active',
      relations: { initiative: 'demo' }, fields: {}, remote: {}, progress: { done: false },
      createdAt: '2026-09-12', updatedAt: '2026-09-12',
    }, null, 2),
    '.specs/model/initiatives/planned/demo/active/01-login/01-login.md': V2_MARKDOWN.feature(link1042),
    '.specs/model/specs/planned/042-login.json': JSON.stringify({
      version: 2, kind: 'spec', id: '042', slug: '042-login', title: 'Magic link', state: spec042State,
      relations: { feature: '01-login' }, fields: { Domain: '`.specs/knowledge/domains/auth/`' },
      remote: {}, progress: { done: false }, createdAt: '2026-09-12', updatedAt: '2026-09-12',
    }, null, 2),
    '.specs/model/specs/planned/042-login.md':
      '# Spec: 042 - Magic link\n\n---\n\n## 1. Intent\n\nMagic link login.\n\n## 5. Business Invariants\n\n* **INV-1 - Valid creds**\n  Login succeeds.\n  -> *Covered by:* login.ts\n',
  };
  if (link1042) {
    files['.specs/model/specs/active/1042-signup.json'] = JSON.stringify({
      version: 2, kind: 'spec', id: '1042', slug: '1042-signup', title: 'Signup', state: 'active',
      relations: { feature: '01-login' }, fields: {}, remote: {}, progress: { done: false },
      createdAt: '2026-09-12', updatedAt: '2026-09-12',
    }, null, 2);
    files['.specs/model/specs/active/1042-signup.md'] =
      '# Spec: 1042 - Signup\n\n---\n\n## 1. Intent\n\nSignup.\n\n## 5. Business Invariants\n\n* **INV-1 - Verified email**\n  Email verified.\n  -> *Covered by:* signup.ts\n';
  } else {
    // The spec files exist but NO feature document references 1042 → its
    // relations are un-derivable (blocking divergence).
    files['.specs/model/specs/active/1042-signup.json'] = JSON.stringify({
      version: 2, kind: 'spec', id: '1042', slug: '1042-signup', title: 'Signup', state: 'active',
      relations: { feature: '01-orphan' }, fields: {}, remote: {}, progress: { done: false },
      createdAt: '2026-09-12', updatedAt: '2026-09-12',
    }, null, 2);
    files['.specs/model/specs/active/1042-signup.md'] =
      '# Spec: 1042 - Signup\n\n---\n\n## 1. Intent\n\nSignup.\n\n## 5. Business Invariants\n\n* **INV-1 - Verified email**\n  Email verified.\n  -> *Covered by:* signup.ts\n';
  }
  // Stray legacy projection files: detection NEVER reads disk shapes.
  files['.specs/specs/planned/042-login.md'] = '# Spec: 042 - Magic link\n';
  files['.specs/vision.md'] = '# Product Vision: Demo\n';
  return files;
}

/** A v3-canonical workspace under .specs/ (index v3 + stateless canonical tree). */
function v3CanonicalWorkspace(extra = {}) {
  return {
    '.specs/config.json': JSON.stringify({ version: 2, sourceOfTruth: 'model', projections: { markdown: true } }),
    '.specs/canonical/index.json': JSON.stringify({ version: 3, sourceOfTruth: 'model', artifacts: [] }, null, 2),
    '.specs/canonical/vision.json': JSON.stringify({
      version: 3, kind: 'vision', id: 'vision', slug: 'vision', title: 'Demo', state: null,
      relations: {}, fields: {}, remote: {}, progress: { done: false },
      createdAt: '2026-09-12', updatedAt: '2026-09-12',
    }, null, 2),
    '.specs/canonical/vision.md': '# Product Vision: Demo\n\n## 1. Core Purpose\n\nDemo.\n',
    '.specs/canonical/initiatives/demo/demo.json': JSON.stringify({
      version: 3, kind: 'initiative', id: 'demo', slug: 'demo', title: 'Demo', state: 'active',
      relations: {}, fields: {}, remote: {}, progress: { done: false },
      createdAt: '2026-09-12', updatedAt: '2026-09-12',
    }, null, 2),
    '.specs/canonical/initiatives/demo/demo.md': '# Initiative: Demo\n\n---\n\n## 1. Intent\n\nDemo initiative.\n',
    '.specs/canonical/initiatives/demo/features/01-login/01-login.json': JSON.stringify({
      version: 3, kind: 'feature', id: '01-login', slug: '01-login', title: 'Login', state: 'active',
      relations: { initiative: 'demo' }, fields: {}, remote: {}, progress: { done: false },
      createdAt: '2026-09-12', updatedAt: '2026-09-12',
    }, null, 2),
    '.specs/canonical/initiatives/demo/features/01-login/01-login.md':
      '# Feature: Login\n\n---\n\n## 1. Problem\n\nLogin.\n',
    '.specs/canonical/initiatives/demo/features/01-login/specs/042.json': JSON.stringify({
      version: 3, kind: 'spec', id: '042', slug: '042-login', title: 'Magic link', state: 'active',
      relations: { feature: '01-login', initiative: 'demo' },
      fields: { Domain: '`.specs/knowledge/domains/auth/`' },
      remote: { linear: 'ENG-142' }, progress: { done: true },
      createdAt: '2026-09-12', updatedAt: '2026-09-12',
    }, null, 2),
    '.specs/canonical/initiatives/demo/features/01-login/specs/042.md':
      '# Spec: 042 - Magic link\n\n---\n\n## 1. Intent\n\nMagic link login.\n\n## 5. Business Invariants\n\n* **INV-1 - Valid creds**\n  Login succeeds.\n  -> *Covered by:* login.ts\n',
    '.specs/knowledge/domains/auth/tech.md':
      '# Domaine auth\n\nLe modèle vit sous `.specs/canonical/`.\n',
    ...extra,
  };
}

/** The v3-canonical fixture + a second initiative holding a duplicate spec id 042. */
function duplicateIdFiles() {
  return {
    '.specs/canonical/initiatives/other/other.json': JSON.stringify({
      version: 3, kind: 'initiative', id: 'other', slug: 'other', title: 'Other', state: 'planned',
      relations: {}, fields: {}, remote: {}, progress: { done: false },
      createdAt: '2026-09-12', updatedAt: '2026-09-12',
    }, null, 2),
    '.specs/canonical/initiatives/other/other.md': '# Initiative: Other\n\n---\n\n## 1. Intent\n\nOther.\n',
    '.specs/canonical/initiatives/other/features/01-dup/01-dup.json': JSON.stringify({
      version: 3, kind: 'feature', id: '01-dup', slug: '01-dup', title: 'Dup', state: 'planned',
      relations: { initiative: 'other' }, fields: {}, remote: {}, progress: { done: false },
      createdAt: '2026-09-12', updatedAt: '2026-09-12',
    }, null, 2),
    '.specs/canonical/initiatives/other/features/01-dup/01-dup.md': '# Feature: Dup\n\n---\n\n## 1. Problem\n\nDup.\n',
    '.specs/canonical/initiatives/other/features/01-dup/specs/042.json': JSON.stringify({
      version: 3, kind: 'spec', id: '042', slug: '042-dup', title: 'Dup', state: 'planned',
      relations: { feature: '01-dup', initiative: 'other' }, fields: {}, remote: {}, progress: { done: false },
      createdAt: '2026-09-12', updatedAt: '2026-09-12',
    }, null, 2),
    '.specs/canonical/initiatives/other/features/01-dup/specs/042.md': '# Spec: 042 - Dup\n\n---\n\n## 1. Intent\n\nDup.\n',
  };
}

const BASE_FLAGS = {
  to: undefined, kind: undefined, state: undefined, slug: undefined, title: undefined,
  from: undefined, feature: undefined, initiative: undefined, field: undefined,
  backends: undefined, create: false, force: false, check: false, write: false,
  cascade: false, undo: false, done: false, dryRun: false, json: false,
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

async function capturing(handler) {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    await handler();
  } finally {
    process.stdout.write = original;
  }
  return chunks.join('');
}

async function exitCodeOf(handler) {
  return silently(async () => {
    process.exitCode = 0;
    await handler();
    return process.exitCode;
  });
}

/** Full workspace snapshot: `{ workspaceRelativePath: content }`. */
async function snapshotTree(root) {
  const files = {};
  async function walk(directory) {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else files[path.relative(root, absolute).split(path.sep).join('/')] = await fsp.readFile(absolute, 'utf8');
    }
  }
  await walk(root);
  return files;
}

// ============================================================================
// Unit Tests (@unit) — §8.1 scenarios U1–U6
// ============================================================================

test('[U1][INV-1][INV-2] detectLayout is deterministic and declared by config/index', async () => {
  // migrated: .sdd/canonical present, .specs/ absent.
  const migrated = await makeWorkspace();
  // coexistence: .sdd/canonical AND .specs/ present.
  const coexistence = await makeWorkspace();
  // v3-canonical: .specs/canonical/index.json (version 3), .sdd/ absent.
  const v3 = await makeWorkspace();
  // v2-model: .specs/model/index.json (version 2), .sdd/ absent.
  const v2 = await makeWorkspace();
  // unsupported: markdown without any index.
  const markdownOnly = await makeWorkspace();
  try {
    await writeFiles(migrated, v3CanonicalWorkspace());
    await fsp.rename(path.join(migrated, '.specs'), path.join(migrated, '.sdd'));

    await writeFiles(coexistence, v3CanonicalWorkspace());
    await fsp.cp(path.join(coexistence, '.specs'), path.join(coexistence, '.sdd'), { recursive: true });

    await writeFiles(v3, v3CanonicalWorkspace());
    await writeFiles(v2, v2ModelWorkspace());
    await writeFiles(markdownOnly, { '.specs/specs/active/042-login.md': '# Spec: 042 - Login\n' });

    assert.equal((await detectLayout(migrated)).layout, 'migrated');
    assert.equal((await detectLayout(coexistence)).layout, 'coexistence');
    const v3Layout = await detectLayout(v3);
    assert.equal(v3Layout.layout, 'v3-canonical');
    assert.equal(v3Layout.sourceRoot, '.specs/canonical');
    const v2Layout = await detectLayout(v2);
    assert.equal(v2Layout.layout, 'v2-model');
    assert.equal(v2Layout.sourceRoot, '.specs/model');
    assert.equal((await detectLayout(markdownOnly)).layout, 'unsupported');

    // No disk-shape heuristic: stray directories never influence the verdict.
    await writeFiles(v2, { '.specs/generated/initiatives/demo/README.md': '# Junk\n' });
    assert.equal((await detectLayout(v2)).layout, 'v2-model');
    await writeFiles(v3, { '.specs/model/leftover.json': JSON.stringify({ junk: true }) });
    assert.equal((await detectLayout(v3)).layout, 'v3-canonical');
  } finally {
    await cleanup(migrated);
    await cleanup(coexistence);
    await cleanup(v3);
    await cleanup(v2);
    await cleanup(markdownOnly);
  }
});

test('[U2][INV-3] the token rewrite is literal, scoped and listed', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, v3CanonicalWorkspace({
      // A token inside a spec body…
      '.specs/canonical/initiatives/demo/features/01-login/specs/042.md':
        '# Spec: 042 - Magic link\n\n---\n\n## 1. Intent\n\nVoir `.specs/knowledge/domains/auth/behavior.md`.\n\n## 5. Business Invariants\n\n* **INV-1 - Valid creds**\n  Login succeeds.\n  -> *Covered by:* login.ts\n',
      // …a bare `.specs` mention (no trailing slash) in a feature body…
      '.specs/canonical/initiatives/demo/features/01-login/01-login.md':
        '# Feature: Login\n\n> Parent root: `.specs` (bare mention, no trailing slash)\n\n---\n\n## 1. Problem\n\nLogin.\n',
      // …and a knowledge markdown carrying the token.
      '.specs/knowledge/domains/auth/behavior.md': '# Behavior\n\nLes corps vivent sous `.specs/canonical/`.\n',
    }));

    const plan = await planMigration(root);
    // Every rewrite is listed with its file and occurrence count (INV-3).
    const byFile = Object.fromEntries(plan.rewrites.map((entry) => [entry.file, entry.occurrences]));
    assert.equal(byFile['.specs/canonical/initiatives/demo/features/01-login/specs/042.md'], 1);
    assert.equal(byFile['.specs/canonical/initiatives/demo/features/01-login/specs/042.json'], 1); // field value
    assert.equal(byFile['.specs/knowledge/domains/auth/tech.md'], 1);
    assert.equal(byFile['.specs/knowledge/domains/auth/behavior.md'], 1);
    // The bare `.specs` mention is listed as NOT rewritten (information only).
    const bare = plan.unrewritten.find((entry) => entry.file === '.specs/canonical/initiatives/demo/features/01-login/01-login.md');
    assert.ok(bare);
    assert.equal(bare.occurrences, 1);

    const result = await runMigration(root);
    assert.equal(result.status, 'migrated');

    const body = await readWorkspaceFile(root, '.sdd/canonical/initiatives/demo/features/01-login/specs/042.md');
    assert.match(body, /Voir `\.sdd\/knowledge\/domains\/auth\/behavior\.md`/);
    const meta = JSON.parse(await readWorkspaceFile(root, '.sdd/canonical/initiatives/demo/features/01-login/specs/042.json'));
    assert.equal(meta.fields.Domain, '`.sdd/knowledge/domains/auth/`');
    const knowledge = await readWorkspaceFile(root, '.sdd/knowledge/domains/auth/tech.md');
    assert.match(knowledge, /\.sdd\/canonical\//);
    // The bare mention survived verbatim.
    const featureBody = await readWorkspaceFile(root, '.sdd/canonical/initiatives/demo/features/01-login/01-login.md');
    assert.match(featureBody, /Parent root: `\.specs` \(bare mention, no trailing slash\)/);
  } finally {
    await cleanup(root);
  }
});

test('[U3][INV-3] convertConfig produces a clean v3 config with exact warnings', () => {
  const { config, warnings } = convertConfig({
    version: 2,
    sourceOfTruth: 'model',
    legacyDirs: ['.specs/model'],
    backends: [
      { id: 'filesystem', type: 'filesystem', enabled: true },
      { id: 'linear', type: 'linear', enabled: false },
    ],
  });
  assert.equal(config.version, 3);
  assert.equal('legacyDirs' in config, false);
  assert.deepEqual(config.backends.map((backend) => backend.id), ['linear']);
  assert.equal(warnings.filter((entry) => entry.includes('legacyDirs')).length, 1);
  assert.equal(warnings.filter((entry) => entry.includes('filesystem')).length, 1);
});

test('[U4][arbitrage 10] portable-paths: bare .sdd/ is workspace-relative, /.sdd/ is a violation', () => {
  const relative = findPortablePathViolations('Les corps vivent sous `.sdd/canonical/initiatives/demo/specs/042.md`.');
  assert.deepEqual(relative, []);

  const absolute = findPortablePathViolations('La config vit à /.sdd/config.json.');
  assert.equal(absolute.length, 1);
  assert.equal(absolute[0], '/.sdd');
});

test('[U5][INV-2] the plan lists disk-versus-metadata divergences without using them as destinations', async () => {
  const root = await makeWorkspace();
  try {
    // Spec 042 declares state "active" in its metadata but rests in planned/;
    // spec 1042 is referenced by NO feature (un-derivable relations).
    await writeFiles(root, v2ModelWorkspace({ spec042State: 'active', link1042: false }));

    const plan = await planMigration(root);
    const mismatch = plan.divergences.find((entry) => entry.type === 'state-mismatch' && entry.slug === '042-login');
    assert.deepEqual(
      { kind: mismatch.kind, type: mismatch.type, expected: mismatch.expected, actual: mismatch.actual },
      { kind: 'spec', type: 'state-mismatch', expected: 'active', actual: 'planned' },
    );

    const unresolved = plan.divergences.filter((entry) => entry.type === 'unresolved-relations');
    assert.equal(unresolved.length >= 1, true);
    assert.equal(unresolved.some((entry) => entry.slug === '1042-signup'), true);

    // The reconstruction follows the METADATA: 042 would be rebuilt with
    // state "active" at its relations-derived destination.
    const artifact = plan.artifacts.find((entry) => entry.slug === '042-login');
    assert.equal(artifact.state, 'active');
    assert.deepEqual(artifact.relations, { feature: '01-login', initiative: 'demo' });
  } finally {
    await cleanup(root);
  }
});

test('[U6][arbitrage 8] the legacy scanners tolerate 4-digit ids and derive relations from content', () => {
  const featureDoc = V2_MARKDOWN.feature(false).replace('042-login', '1042-login');
  assert.deepEqual(extractSpecSlugs(featureDoc), ['1042-login']);
  assert.equal(extractParentInitiative(featureDoc), 'demo');
});

// ============================================================================
// Component Tests (@component) — §8.1 scenarios C1–C7
// ============================================================================

test('[C1][INV-1] migrating a pure v2 workspace: full reconstruction, graph preserved', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, v2ModelWorkspace());

    const result = await runMigration(root);
    assert.equal(result.status, 'migrated');

    // The same artifacts at derived paths — spec files named by bare id.
    assert.equal(await fileExists(root, '.sdd/canonical/vision.json'), true);
    assert.equal(await fileExists(root, '.sdd/canonical/initiatives/demo/demo.json'), true);
    assert.equal(await fileExists(root, '.sdd/canonical/initiatives/demo/features/01-login/01-login.json'), true);
    assert.equal(await fileExists(root, '.sdd/canonical/initiatives/demo/features/01-login/specs/042.json'), true);
    assert.equal(await fileExists(root, '.sdd/canonical/initiatives/demo/features/01-login/specs/1042.json'), true);

    const artifacts = await loadModel(root);
    const spec042 = findByRef(artifacts, '042');
    assert.equal(spec042.state, 'planned');
    assert.deepEqual(spec042.relations, { feature: '01-login', initiative: 'demo' });
    const spec1042 = findByRef(artifacts, '1042');
    assert.equal(spec1042.state, 'active');
    assert.deepEqual(spec1042.relations, { feature: '01-login', initiative: 'demo' });

    // .specs/ is gone and a second runMigration is a no-op (INV-1).
    assert.equal(await fileExists(root, '.specs'), false);
    const second = await runMigration(root);
    assert.equal(second.status, 'noop');
  } finally {
    await cleanup(root);
  }
});

test('[C2][INV-2] destinations follow the metadata, never the disk position', async () => {
  const root = await makeWorkspace();
  try {
    // Feature 02-x declares state "archived" in its metadata but rests
    // physically inside a planned/ directory (misplaced canonical file).
    await writeFiles(root, v3CanonicalWorkspace({
      '.specs/canonical/initiatives/demo/features/planned/02-x/02-x.json': JSON.stringify({
        version: 3, kind: 'feature', id: '02-x', slug: '02-x', title: 'X', state: 'archived',
        relations: { initiative: 'demo' }, fields: {}, remote: {}, progress: { done: true },
        createdAt: '2026-09-12', updatedAt: '2026-09-12',
      }, null, 2),
      '.specs/canonical/initiatives/demo/features/planned/02-x/02-x.md': '# Feature: X\n\n---\n\n## 1. Problem\n\nX.\n',
    }));

    const plan = await planMigration(root);
    const mismatch = plan.divergences.find((entry) => entry.type === 'state-mismatch' && entry.slug === '02-x');
    assert.deepEqual(
      { expected: mismatch.expected, actual: mismatch.actual },
      { expected: 'archived', actual: 'planned' },
    );

    const result = await runMigration(root);
    assert.equal(result.status, 'migrated');

    // Rebuilt at the metadata-derived destination; nothing was copied from
    // the divergent location.
    assert.equal(await fileExists(root, '.sdd/canonical/initiatives/demo/features/02-x/02-x.json'), true);
    assert.equal(await fileExists(root, '.sdd/canonical/initiatives/demo/features/planned/02-x'), false);
    const meta = JSON.parse(await readWorkspaceFile(root, '.sdd/canonical/initiatives/demo/features/02-x/02-x.json'));
    assert.equal(meta.state, 'archived');
  } finally {
    await cleanup(root);
  }
});

test('[C3][INV-1] an amputated .sdd/ is restarted from zero', async () => {
  const root = await makeWorkspace();
  try {
    // First migration fails the strict gate (duplicate id) → coexistence.
    await writeFiles(root, { ...v3CanonicalWorkspace(), ...duplicateIdFiles() });
    await assert.rejects(() => runMigration(root), MigrationError);
    assert.equal(await fileExists(root, '.sdd/.migration-failed.json'), true);
    assert.equal(existsSync(path.join(root, '.specs')), true);

    // Fix the source, then amputate .sdd/: drop a spec body, truncate the index.
    await fsp.rm(path.join(root, '.specs/canonical/initiatives/other'), { recursive: true, force: true });
    await fsp.rm(path.join(root, '.sdd/canonical/initiatives/demo/features/01-login/specs/042.md'), { force: true });
    await writeFiles(root, { '.sdd/canonical/index.json': JSON.stringify({ version: 3, artifacts: [] }) });

    const result = await runMigration(root);
    assert.equal(result.status, 'migrated');

    // The missing spec is back and .specs/ is gone; the marker is cleared.
    assert.equal(await fileExists(root, '.sdd/canonical/initiatives/demo/features/01-login/specs/042.md'), true);
    assert.equal(await fileExists(root, '.specs'), false);
    assert.equal(await fileExists(root, '.sdd/.migration-failed.json'), false);
  } finally {
    await cleanup(root);
  }
});

test('[C4][INV-4] strict gate failure: marker written, source kept, exit 1', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, { ...v3CanonicalWorkspace(), ...duplicateIdFiles() });

    await assert.rejects(
      () => runMigration(root),
      (error) => error instanceof MigrationError && error.exitCode === 1,
    );

    const marker = JSON.parse(await readWorkspaceFile(root, '.sdd/.migration-failed.json'));
    assert.equal(marker.stage, 'validate');
    assert.match(marker.message, /finding/);
    // The source is intact and no projection was rendered after the failure.
    assert.equal(existsSync(path.join(root, '.specs')), true);
    assert.equal(await fileExists(root, '.sdd/generated'), false);
  } finally {
    await cleanup(root);
  }
});

test('[C5][INV-5] coexistence: mutations refused, reads operate on .sdd/', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, { ...v3CanonicalWorkspace(), ...duplicateIdFiles() });
    await assert.rejects(() => runMigration(root), MigrationError); // coexistence established

    await assert.rejects(
      () => upsert(ctx(root, ['initiative'], { slug: 'extra', title: 'Extra' })),
      (error) => error instanceof MigrationError && /coexist/i.test(error.message) && /spec migrate/.test(error.message),
    );
    await assert.rejects(() => move(ctx(root, ['demo'], { to: 'archived' })), MigrationError);
    await assert.rejects(() => render(ctx(root)), MigrationError);
    await assert.rejects(() => importArtifacts(ctx(root)), MigrationError);
    await assert.rejects(() => init(ctx(root, [], { force: true })), MigrationError);
    await assert.rejects(() => model(ctx(root, [], { write: true })), MigrationError);
    // Nothing was written by the refused mutations.
    assert.equal(await fileExists(root, '.sdd/canonical/initiatives/extra'), false);

    // Reads run against .sdd/ exclusively — they execute (drift may be reported).
    await silently(() => status(ctx(root)));
    await silently(() => list(ctx(root)));
    await exitCodeOf(() => validate(ctx(root)));
    await exitCodeOf(() => render(ctx(root, [], { check: true })));
    await exitCodeOf(() => render(ctx(root, [], { dryRun: true })));
    process.exitCode = 0;
  } finally {
    await cleanup(root);
  }
});

test('[C6][INV-6] migrate --dry-run writes nothing', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, v3CanonicalWorkspace());

    const before = await snapshotTree(root);
    const output = await capturing(() => migrate(ctx(root, [], { dryRun: true })));
    assert.deepEqual(await snapshotTree(root), before); // bit-for-bit unchanged

    assert.match(output, /Migration plan \(layout: v3-canonical, source: \.specs\/canonical\)/);
    assert.match(output, /rewrites\s+\d+ token rewrite\(s\)/);
    assert.match(output, /\(dry-run: nothing was written\)\s*$/);
  } finally {
    await cleanup(root);
  }
});

test('[C7][INV-1][INV-3] a second migrate is a no-op and preservation is verified field by field', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, v2ModelWorkspace());
    const first = await runMigration(root);
    assert.equal(first.status, 'migrated');

    const before = {};
    for (const record of await loadModel(root)) {
      before[`${record.kind}:${record.slug}`] = {
        id: record.id,
        state: record.state,
        relations: record.relations,
        progress: record.progress,
        remote: record.remote,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    }

    const output = await capturing(() => migrate(ctx(root)));
    assert.match(output, /already migrated/i);

    for (const record of await loadModel(root)) {
      assert.deepEqual(
        {
          id: record.id,
          state: record.state,
          relations: record.relations,
          progress: record.progress,
          remote: record.remote,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        },
        before[`${record.kind}:${record.slug}`],
      );
    }

    const statusJson = JSON.parse(await capturing(() => status(ctx(root, [], { json: true }))));
    assert.equal(statusJson.total, 5);
  } finally {
    await cleanup(root);
  }
});

// ============================================================================
// Integration Tests (@integration) — §8.1 scenarios I1, I2
// ============================================================================

test('[I1][INV-3][INV-4] full v3-canonical conversion with v3 config and rewritten tokens', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, v3CanonicalWorkspace({
      '.specs/config.json': JSON.stringify({
        version: 2,
        sourceOfTruth: 'model',
        legacyDirs: ['.specs/model'],
        projections: { markdown: true },
        backends: [
          { id: 'filesystem', type: 'filesystem', enabled: true },
          { id: 'linear', type: 'linear', enabled: false, settings: { teamKey: 'ENG' } },
        ],
      }),
    }));

    const dryRun = await capturing(() => migrate(ctx(root, [], { dryRun: true })));
    assert.match(dryRun, /divergences\s+\d+/);
    assert.match(dryRun, /token rewrite\(s\)/);
    assert.match(dryRun, /unknown top-level key "legacyDirs" dropped/);
    assert.match(dryRun, /legacy backend "filesystem" dropped/);
    assert.match(dryRun, /removals\s+\.specs\/ \(whole tree, after strict gate\)/);

    const result = await runMigration(root);
    assert.equal(result.status, 'migrated');

    // Config v3 without the obsolete option.
    const config = JSON.parse(await readWorkspaceFile(root, '.sdd/config.json'));
    assert.equal(config.version, 3);
    assert.equal('legacyDirs' in config, false);
    assert.deepEqual(config.backends.map((backend) => backend.id), ['linear']);

    // Canonical rebuilt, knowledge moved with rewritten tokens, index prefixed .sdd/.
    assert.equal(await fileExists(root, '.sdd/canonical/initiatives/demo/features/01-login/specs/042.json'), true);
    const knowledge = await readWorkspaceFile(root, '.sdd/knowledge/domains/auth/tech.md');
    assert.match(knowledge, /\.sdd\/canonical\//);
    const index = JSON.parse(await readWorkspaceFile(root, '.sdd/canonical/index.json'));
    assert.equal(index.version, 3);
    for (const entry of index.artifacts) {
      assert.match(entry.meta, /^\.sdd\/canonical\//);
      assert.match(entry.projection, /^\.sdd\/generated\//);
    }
    assert.equal(await fileExists(root, '.sdd/generated/initiatives/demo/specs/042.md'), true);

    // remote and progress preserved.
    const spec = findByRef(await loadModel(root), '042');
    assert.deepEqual(spec.remote, { linear: 'ENG-142' });
    assert.equal(spec.progress.done, true);

    assert.equal(await exitCodeOf(() => validate(ctx(root))), 0);
    assert.equal(await exitCodeOf(() => render(ctx(root, [], { check: true }))), 0);
    process.exitCode = 0;
    assert.equal(await fileExists(root, '.specs'), false);
  } finally {
    await cleanup(root);
  }
});

test('[I2][INV-6][arbitrage 8] spec import converts a markdown-only workspace post-cutover', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, {
      '.specs/initiatives/active/demo/README.md': V2_MARKDOWN.initiative,
      '.specs/initiatives/active/demo/planned/01-login.md': V2_MARKDOWN.feature(true),
      '.specs/specs/active/042-login.md':
        '# Spec: 042 - Magic link\n\n## Metadata\n* **Domain:** `.specs/knowledge/domains/auth/`\n\n---\n\n## 1. Intent\n\nMagic link login.\n\n## 5. Business Invariants\n\n* **INV-1 - Valid creds**\n  Login succeeds.\n  -> *Covered by:* login.ts\n',
    });

    const before = await snapshotTree(root);
    const preview = await capturing(() => importArtifacts(ctx(root, [], { dryRun: true })));
    assert.deepEqual(await snapshotTree(root), before);
    assert.match(preview, /\(dry-run: nothing was written\)/);

    await silently(() => importArtifacts(ctx(root)));
    const spec = findByRef(await loadModel(root), '042');
    // Relations derived from CONTENT (## 6. → spec; Parent Initiative → feature).
    assert.deepEqual(spec.relations, { feature: '01-login', initiative: 'demo' });
    assert.equal(spec.fields.Domain, '`.sdd/knowledge/domains/auth/`');
    assert.equal(await fileExists(root, '.specs'), false);

    // A workspace with a JSON model refuses the import (orientation migrate).
    const withModel = await makeWorkspace();
    try {
      await writeFiles(withModel, v2ModelWorkspace());
      await assert.rejects(
        () => importMarkdown(withModel),
        (error) => error.exitCode === 2 && /spec migrate/.test(error.message),
      );
    } finally {
      await cleanup(withModel);
    }
  } finally {
    await cleanup(root);
  }
});

// ============================================================================
// End-to-End Tests (@e2e) — §8.1 scenarios E1, E2
// ============================================================================

test('[E1][INV-1..INV-6] full journey: pure v2 workspace to an operational .sdd/ workspace', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, v2ModelWorkspace());

    const dryRun = await capturing(() => migrate(ctx(root, [], { dryRun: true })));
    assert.match(dryRun, /\(dry-run: nothing was written\)/);
    assert.equal(await fileExists(root, '.sdd'), false); // the dry-run wrote nothing

    const migration = await capturing(() => migrate(ctx(root)));
    assert.match(migration, /Workspace migrated to \.sdd\//);
    assert.equal(await fileExists(root, '.specs'), false);

    // The complete CLI cycle works on .sdd/: upsert writes under
    // .sdd/canonical/, projections under .sdd/generated/.
    await silently(() => upsert(ctx(root, ['spec'], {
      slug: '043-signup', title: 'Signup flow', feature: '01-login',
      field: ['Domain=`.sdd/knowledge/domains/auth/`'],
    })));
    const created = findByRef(await loadModel(root), '043');
    assert.equal(created.model.meta, 'initiatives/demo/features/01-login/specs/043.json');
    assert.equal(await fileExists(root, '.sdd/generated/initiatives/demo/specs/043.md'), true);

    await silently(() => move(ctx(root, ['043'], { to: 'active' })));
    assert.equal(findByRef(await loadModel(root), '043').state, 'active');

    assert.equal(await exitCodeOf(() => validate(ctx(root))), 0);
    assert.equal(await exitCodeOf(() => render(ctx(root, [], { check: true }))), 0);
    process.exitCode = 0;

    // A second migrate is a no-op and the gates stay green.
    const again = await capturing(() => migrate(ctx(root)));
    assert.match(again, /already migrated/i);
    assert.equal(await exitCodeOf(() => validate(ctx(root))), 0);
    assert.equal(await exitCodeOf(() => render(ctx(root, [], { check: true }))), 0);
    process.exitCode = 0;
  } finally {
    await cleanup(root);
  }
});

test('[E2][INV-4][INV-5] gate failure, coexistence lock, recovery from zero', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, { ...v3CanonicalWorkspace(), ...duplicateIdFiles() });
    await assert.rejects(() => runMigration(root), MigrationError); // gate fails → coexistence + marker

    // The mutation is refused (exit 1) during the coexistence; the marker is readable.
    await assert.rejects(
      () => upsert(ctx(root, ['initiative'], { slug: 'x', title: 'X' })),
      (error) => error instanceof MigrationError && error.exitCode === 1,
    );
    const marker = JSON.parse(await readWorkspaceFile(root, '.sdd/.migration-failed.json'));
    assert.equal(marker.stage, 'validate');

    // Fix the source, then re-migrate: .sdd/ is wiped, rebuilt, the gate
    // passes, the marker then .specs/ disappear.
    await fsp.rm(path.join(root, '.specs/canonical/initiatives/other'), { recursive: true, force: true });
    const result = await runMigration(root);
    assert.equal(result.status, 'migrated');
    assert.equal(await fileExists(root, '.sdd/.migration-failed.json'), false);
    assert.equal(await fileExists(root, '.specs'), false);
    assert.equal(await exitCodeOf(() => validate(ctx(root))), 0);
    assert.equal(await exitCodeOf(() => render(ctx(root, [], { check: true }))), 0);
    process.exitCode = 0;
  } finally {
    await cleanup(root);
  }
});