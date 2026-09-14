import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMeta } from '../src/model/schema.js';
import { saveArtifact } from '../src/model/store.js';

/** Creates an isolated temporary workspace root. */
export async function makeWorkspace() {
  return mkdtemp(path.join(tmpdir(), 'sdd-'));
}

export async function cleanup(root) {
  await rm(root, { recursive: true, force: true });
}

/** Writes a map of `{ 'relative/path': 'content' }` files into a workspace. */
export async function writeFiles(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, 'utf8');
  }
}

export async function readWorkspaceFile(root, relative) {
  return readFile(path.join(root, relative), 'utf8');
}

export async function fileExists(root, relative) {
  try {
    await readFile(path.join(root, relative));
    return true;
  } catch {
    return false;
  }
}

/**
 * Seeds canonical model artifacts from plain definitions, written straight to
 * their definitive canonical location (stateless layout — relations only).
 * @returns {Promise<Array>} the created metadata objects
 */
export async function seedModel(root, definitions) {
  const created = [];

  for (const definition of definitions) {
    const meta = createMeta({
      kind: definition.kind,
      slug: definition.slug,
      title: definition.title,
      state: definition.state,
      relations: definition.relations,
      fields: definition.fields,
      progress: definition.progress,
    });
    await saveArtifact(root, meta, definition.body ?? '');
    created.push(meta);
  }

  return created;
}

/** Standard three-artifact fixture (initiative → feature → spec). */
export const MODEL_FIXTURE = [
  { kind: 'initiative', slug: 'demo', title: 'Demo', state: 'active', body: '## 1. Intent\n\nDemo.\n' },
  { kind: 'feature', slug: '01-login', title: 'Login', state: 'active', relations: { initiative: 'demo' }, body: '## 1. Problem\n\nLogin.\n' },
  {
    kind: 'spec',
    slug: '042-login',
    title: 'Magic link',
    state: 'active',
    relations: { feature: '01-login', initiative: 'demo' },
    body: '## 1. Intent\n\nMagic link.\n',
  },
];

/** Markdown projection fixture used by the legacy markdown scanners. */
export const FIXTURES = {
  '.specs/vision.md': '# Product Vision: Demo\n',
  '.specs/specs/planned/042-login.md':
    '# Spec: 042 - Login\n\n## Metadata\n* **Domain:** `.specs/knowledge/domains/auth/`\n',
  '.specs/specs/active/043-signup.md':
    '# Spec: 043 - Signup\n\n## Metadata\n* **Domain:** `.specs/knowledge/domains/auth/`\n',
  '.specs/initiatives/planned/demo/README.md':
    '# Initiative: Demo\n\n> **Status:** Planned  \n\n---\n\n## 4. Feature Roadmap\n\n- [ ] **`01-login`**: Login  \n',
  '.specs/initiatives/planned/demo/planned/01-login.md':
    '# Feature: Login\n\n> **Status:** Planned  \n\n---\n\n## 6. Implementation Spec(s)\n\n*No execution specs linked yet.*\n',
};
