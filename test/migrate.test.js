import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanTitle,
  extractSpecSlugs,
  parseArtifactDocument,
  parseFields,
  stripGeneratedSections,
} from '../src/migrate/parse.js';
import { importMarkdown } from '../src/migrate/import.js';
import { findByRef, loadModel } from '../src/model/store.js';
import { makeWorkspace, cleanup, writeFiles, fileExists } from './helpers.js';

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
> **Author(s):** Nanko  

---

## 1. Problem & Trigger

Users need login.

---

## 6. Implementation Spec(s)

- [ ] **\`042-login\`** : Magic link
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

test('cleanTitle strips the kind prefix', () => {
  assert.equal(cleanTitle('spec', 'Spec: 042 - Magic link'), 'Magic link');
  assert.equal(cleanTitle('initiative', 'Initiative: Demo'), 'Demo');
  assert.equal(cleanTitle('feature', 'Feature: Login'), 'Login');
  assert.equal(cleanTitle('vision', 'Product Vision: Demo'), 'Demo');
});

test('parseFields reads bullets and blockquotes, skipping derived keys', () => {
  const fields = parseFields([
    '* **Domain:** `x`',
    '> **Status:** Active  ',
    '> **Parent Initiative:** `demo`  ',
    '> **Author(s):** Nanko  ',
  ]);
  assert.equal(fields.Domain, '`x`');
  assert.equal(fields['Author(s)'], 'Nanko');
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

test('extractSpecSlugs collects every referenced spec', () => {
  assert.deepEqual(extractSpecSlugs(FEATURE_DOC), ['042-login']);
  assert.deepEqual(extractSpecSlugs('nothing'), []);
});

test('importMarkdown reconstructs the model from markdown documents', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, {
      '.specs/initiatives/active/demo/README.md': INITIATIVE_DOC,
      '.specs/initiatives/active/demo/planned/01-login.md': FEATURE_DOC,
      '.specs/specs/active/042-login.md': SPEC_DOC,
    });

    const results = await importMarkdown(root);
    assert.equal(results.filter((entry) => entry.status === 'imported').length, 3);
    assert.equal(await fileExists(root, '.specs/model/specs/active/042-login.json'), true);

    const artifacts = await loadModel(root);
    const spec = findByRef(artifacts, '042');
    assert.equal(spec.title, 'Magic link login');
    assert.equal(spec.state, 'active');
    assert.equal(spec.relations.feature, '01-login');
    assert.equal(spec.fields['Change Type'], '`New Capability`');

    const feature = findByRef(artifacts, '01-login', { kind: 'feature' });
    assert.equal(feature.relations.initiative, 'demo');
    assert.equal(feature.model.meta, 'initiatives/active/demo/planned/01-login.json');
  } finally {
    await cleanup(root);
  }
});

test('importMarkdown preserves existing model files unless forced', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, { '.specs/specs/active/042-login.md': SPEC_DOC });

    const first = await importMarkdown(root);
    assert.equal(first[0].status, 'imported');

    const second = await importMarkdown(root);
    assert.equal(second[0].status, 'skipped');

    const forced = await importMarkdown(root, { force: true });
    assert.equal(forced[0].status, 'imported');
  } finally {
    await cleanup(root);
  }
});
