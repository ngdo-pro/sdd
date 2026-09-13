import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanTitle,
  extractParentInitiative,
  extractSpecSlugs,
  parseArtifactDocument,
  parseFields,
  stripGeneratedSections,
} from '../src/migrate/parse.js';
import { importMarkdown } from '../src/migrate/import.js';
import { UsageError } from '../src/core/errors.js';
import { findByRef, loadModel } from '../src/model/store.js';
import { makeWorkspace, cleanup, writeFiles, fileExists, readWorkspaceFile } from './helpers.js';

const SPEC_DOC = `# Spec: 042 - Magic link login

## Metadata
* **Domain:** \`.specs/knowledge/domains/auth/\`
* **Change Type:** \`New Capability\`
* **Complexity:** \`Medium\`

---

## 1. Intent & Context

Add login.

## 5. Business Invariants

* **INV-1 - Valid creds**  
  Login succeeds.  
  -> *Covered by:* login.ts
`;

const FEATURE_DOC = `# Feature: Login

> **Parent Initiative:** \`demo\`  
> **Status:** Active  
> **Author(s):** ngdo  

---

## 1. Problem & Trigger

Users need login.

---

## 6. Implementation Spec(s)

- [ ] **\`042-login\`** : Magic link
- [ ] **\`1042-signup\`** : Signup
`;

const INITIATIVE_DOC = `# Initiative: Demo

> **Initiative Slug:** \`demo\`  
> **Status:** Active  

---

## 1. Intent & The Gap

Today: nothing.

---

## 4. Feature Roadmap

- [ ] **\`01-login\`**: Login
`;

test('cleanTitle strips the kind prefix (3 and 4 digit ids)', () => {
  assert.equal(cleanTitle('spec', 'Spec: 042 - Magic link'), 'Magic link');
  assert.equal(cleanTitle('spec', 'Spec: 1042 - Magic link'), 'Magic link');
  assert.equal(cleanTitle('initiative', 'Initiative: Demo'), 'Demo');
  assert.equal(cleanTitle('feature', 'Feature: Login'), 'Login');
  assert.equal(cleanTitle('vision', 'Product Vision: Demo'), 'Demo');
});

test('parseFields reads bullets and blockquotes, skipping derived keys', () => {
  const fields = parseFields([
    '* **Domain:** `x`',
    '> **Status:** Active  ',
    '> **Parent Initiative:** `demo`  ',
    '> **Author(s):** ngdo  ',
  ]);
  assert.equal(fields.Domain, '`x`');
  assert.equal(fields['Author(s)'], 'ngdo');
  assert.equal('Status' in fields, false);
  assert.equal('Parent Initiative' in fields, false);
});

test('parseArtifactDocument splits a spec header from its body', () => {
  const parsed = parseArtifactDocument(SPEC_DOC, 'spec');
  assert.equal(parsed.title, 'Magic link login');
  assert.equal(parsed.fields.Domain, '`.specs/knowledge/domains/auth/`');
  assert.doesNotMatch(parsed.body, /## Metadata/);
  assert.match(parsed.body, /^## 1\. Intent & Context/);
});

test('parseArtifactDocument strips generated sections from the body', () => {
  const feature = parseArtifactDocument(FEATURE_DOC, 'feature');
  assert.doesNotMatch(feature.body, /## 6\. Implementation Spec\(s\)/);
  assert.match(feature.body, /^## 1\. Problem & Trigger/);

  const initiative = parseArtifactDocument(INITIATIVE_DOC, 'initiative');
  assert.doesNotMatch(initiative.body, /## 4\. Feature Roadmap/);
  assert.match(initiative.body, /^## 1\. Intent & The Gap/);
});

test('stripGeneratedSections keeps following sections', () => {
  const body = '## 4. Feature Roadmap\n\n- [ ] x\n\n## 5. Later\n\nkeep me\n';
  assert.equal(stripGeneratedSections(body, 'initiative').includes('keep me'), true);
  assert.equal(stripGeneratedSections(body, 'initiative').includes('Feature Roadmap'), false);
});

test('extractSpecSlugs collects every referenced spec, 4-digit ids included', () => {
  assert.deepEqual(extractSpecSlugs(FEATURE_DOC), ['042-login', '1042-signup']);
  assert.deepEqual(extractSpecSlugs('nothing'), []);
});

test('[U6] extractParentInitiative derives the relation from the content block', () => {
  assert.equal(extractParentInitiative(FEATURE_DOC), 'demo');
  assert.equal(extractParentInitiative('# Feature: Orphan\n\nNo block here.\n'), null);
});

test('importMarkdown reconstructs the model from markdown documents, retiring .specs/', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, {
      '.specs/initiatives/active/demo/README.md': INITIATIVE_DOC,
      '.specs/initiatives/active/demo/planned/01-login.md': FEATURE_DOC,
      '.specs/specs/active/042-login.md': SPEC_DOC,
    });

    const outcome = await importMarkdown(root);
    assert.equal(outcome.results.filter((entry) => entry.status === 'imported').length, 3);

    // v3 under the .sdd/ root: the importer writes to the canonical store.
    assert.equal(
      await fileExists(root, '.sdd/canonical/initiatives/demo/features/01-login/specs/042.json'),
      true,
    );

    const artifacts = await loadModel(root);
    const spec = findByRef(artifacts, '042');
    assert.equal(spec.title, 'Magic link login');
    assert.equal(spec.state, 'active');
    assert.equal(spec.relations.feature, '01-login');
    assert.equal(spec.relations.initiative, 'demo');
    assert.equal(spec.fields['Change Type'], '`New Capability`');
    // INV-3: imported field values are token-rewritten.
    assert.equal(spec.fields.Domain, '`.sdd/knowledge/domains/auth/`');

    const feature = findByRef(artifacts, '01-login', { kind: 'feature' });
    assert.equal(feature.relations.initiative, 'demo');
    assert.equal(feature.model.meta, 'initiatives/demo/features/01-login/01-login.json');

    // Shared finish: the strict gate passed → the legacy root is retired.
    assert.equal(await fileExists(root, '.specs'), false);
  } finally {
    await cleanup(root);
  }
});

test('importMarkdown refuses when a JSON model exists and orients to sdd migrate', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, {
      '.specs/initiatives/active/demo/README.md': INITIATIVE_DOC,
      '.specs/specs/active/042-login.md': SPEC_DOC,
      '.specs/model/index.json': JSON.stringify({ version: 2, artifacts: [] }),
    });

    await assert.rejects(
      () => importMarkdown(root),
      (error) => error instanceof UsageError && error.exitCode === 2 && /sdd migrate/.test(error.message),
    );
    // Nothing was written.
    assert.equal(await fileExists(root, '.sdd'), false);
  } finally {
    await cleanup(root);
  }
});

test('importMarkdown skips artifacts already in the canonical store unless forced', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, {
      '.specs/initiatives/active/demo/README.md': INITIATIVE_DOC,
      '.specs/initiatives/active/demo/planned/01-login.md': FEATURE_DOC,
      '.specs/specs/active/042-login.md': SPEC_DOC,
      // Pre-seeded canonical artifact WITHOUT any index.json (no JSON model).
      '.sdd/canonical/initiatives/demo/demo.json': JSON.stringify({
        version: 3, kind: 'initiative', id: 'demo', slug: 'demo', title: 'Demo',
        state: 'active', relations: {}, fields: {}, remote: {}, progress: { done: false },
        createdAt: '2026-09-13', updatedAt: '2026-09-13',
      }, null, 2),
      '.sdd/canonical/initiatives/demo/demo.md': INITIATIVE_DOC,
    });

    const outcome = await importMarkdown(root);
    const skipped = outcome.results.filter((entry) => entry.status === 'skipped').map((entry) => entry.slug);
    const imported = outcome.results.filter((entry) => entry.status === 'imported').map((entry) => entry.slug);
    assert.deepEqual(skipped, ['demo']);
    assert.deepEqual(imported.sort(), ['01-login', '042-login']);

    const forced = await importMarkdown(root, { force: true });
    // After a successful import .specs/ is retired — a second import finds
    // nothing (INV-1: the conversion is one-shot, git is the safety net).
    assert.equal(await fileExists(root, '.specs'), false);
    assert.deepEqual(forced.results, []);
  } finally {
    await cleanup(root);
  }
});

test('importMarkdown rewrites the root token inside imported bodies and fields', async () => {
  const root = await makeWorkspace();
  try {
    const BODY_TOKEN_DOC = `# Spec: 042 - Magic link login

## Metadata
* **Domain:** \`.specs/knowledge/domains/auth/\`

---

## 1. Intent & Context

Read the domain guide at \`.specs/knowledge/domains/auth/behavior.md\`.

## 5. Business Invariants

* **INV-1 - Valid creds**  
  Login succeeds.  
  -> *Covered by:* login.ts
`;
    await writeFiles(root, {
      '.specs/initiatives/active/demo/README.md': INITIATIVE_DOC,
      '.specs/initiatives/active/demo/planned/01-login.md': FEATURE_DOC,
      '.specs/specs/active/042-login.md': BODY_TOKEN_DOC,
    });

    const outcome = await importMarkdown(root);
    assert.equal(outcome.rewrites.length >= 1, true);

    const body = await readWorkspaceFile(root, '.sdd/canonical/initiatives/demo/features/01-login/specs/042.md');
    assert.match(body, /Read the domain guide at `\.sdd\/knowledge\/domains\/auth\/behavior\.md`/);
    assert.doesNotMatch(body, /\.specs\//);

    const meta = JSON.parse(
      await readWorkspaceFile(root, '.sdd/canonical/initiatives/demo/features/01-login/specs/042.json'),
    );
    assert.equal(meta.fields.Domain, '`.sdd/knowledge/domains/auth/`');
  } finally {
    await cleanup(root);
  }
});