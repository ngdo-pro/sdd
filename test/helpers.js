import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Creates an isolated temporary workspace root. */
export async function makeWorkspace() {
  return mkdtemp(path.join(tmpdir(), 'spec-framework-'));
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

export async function cleanup(root) {
  await rm(root, { recursive: true, force: true });
}

/** Canonical fixture matching the framework's on-disk layout. */
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
