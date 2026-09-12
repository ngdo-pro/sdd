import path from 'node:path';
import fsp from 'node:fs/promises';
import { BackendError } from '../core/errors.js';
import { STATE_DIRS, ensureDir, exists, toPosix } from '../core/paths.js';
import { listArtifacts, resolveArtifact } from '../core/artifact.js';
import { STATE_LABELS, assertTransition } from '../core/transitions.js';

/**
 * Filesystem backend — the framework default.
 *
 * It performs real, deterministic "movements": relocating artifacts between the
 * `planned/`, `active/` and `archive/` directories, refreshing their `Status:`
 * header, and wiring parent↔child markdown references.
 */
export default function createFilesystemBackend({ cwd }) {
  return {
    id: 'filesystem',
    type: 'filesystem',
    capabilities: { read: true, list: true, transition: true, link: true, create: false, remote: false },

    async resolve(reference, options = {}) {
      return resolveArtifact(cwd, reference, options);
    },

    async list(options = {}) {
      return listArtifacts(cwd, options);
    },

    /**
     * Moves an artifact to the requested lifecycle state.
     * @returns {Promise<{ moved: boolean, from?: string, to?: string }>}
     */
    async transition(artifact, toState, { dryRun = false } = {}) {
      const mustMove = assertTransition(artifact, toState);
      if (!mustMove) return { moved: false };

      const target = computeTransitionPath(artifact, toState);
      if (dryRun) return { moved: false, planned: true, from: artifact.path, to: target };

      const fromAbsolute = path.join(cwd, artifact.path);
      const toAbsolute = path.join(cwd, target);

      if (!(await exists(fromAbsolute))) {
        throw new BackendError(`Local artifact missing on disk: ${artifact.path}`);
      }

      await ensureDir(path.dirname(toAbsolute));
      await moveFile(fromAbsolute, toAbsolute);
      await updateStatusHeader(toAbsolute, toState);

      return { moved: true, from: artifact.path, to: target };
    },

    /**
     * Wires a child reference into its parent document.
     * @param {{ child: object, parent: object, relation: string }} input
     */
    async link({ child, parent, relation }, { dryRun = false } = {}) {
      if (!parent) throw new BackendError(`link(${relation}) requires a parent artifact.`);
      const parentAbsolute = path.join(cwd, parent.path);
      const childAbsolute = path.join(cwd, child.path);
      const linkTarget = toPosix(path.relative(path.dirname(parentAbsolute), childAbsolute));

      const spec = SPEC_LINK_RELATIONS[relation];
      const feat = FEATURE_LINK_RELATIONS[relation];
      const config = spec ?? feat;
      if (!config) throw new BackendError(`Unsupported link relation "${relation}".`);

      const original = await fsp.readFile(parentAbsolute, 'utf8');
      if (config.isPresent(original, child)) return { linked: false, alreadyLinked: true };

      const updated = config.render(original, child, linkTarget);
      if (updated === null) {
        throw new BackendError(`Could not locate section "${config.heading}" in ${parent.path}.`);
      }
      if (dryRun) return { linked: false, planned: true, parent: parent.path };

      await fsp.writeFile(parentAbsolute, updated, 'utf8');
      return { linked: true, parent: parent.path };
    },
  };
}

const SPEC_LINK_RELATIONS = {
  'spec-of-feature': {
    heading: '## 6. Implementation Spec(s)',
    placeholders: ['*No execution specs linked yet.*'],
    isPresent: (content, child) => content.includes(child.slug),
    render: (content, child, linkTarget) => insertEntry(content, {
      heading: '## 6. Implementation Spec(s)',
      placeholders: ['*No execution specs linked yet.*'],
      lines: [
        `- [ ] **\`${child.slug}\`** : ${child.title ?? child.slug}  `,
        `  ↳ *Spec:* [\`${linkTarget}\`](${linkTarget})`,
      ],
    }),
  },
};

const FEATURE_LINK_RELATIONS = {
  'feature-of-initiative': {
    heading: '## 4. Feature Roadmap',
    isPresent: (content, child) => content.includes(child.slug),
    render: (content, child, linkTarget) => insertEntry(content, {
      heading: '## 4. Feature Roadmap',
      lines: [
        `- [ ] **\`${child.slug}\`**: ${child.title ?? child.slug}  `,
        `  ↳ *File:* [\`${linkTarget}\`](${linkTarget})`,
      ],
    }),
  },
};

/** Computes the destination path of an artifact for a target state. */
export function computeTransitionPath(artifact, toState) {
  const segments = artifact.path.split('/');
  const dir = STATE_DIRS[toState];
  if (!dir) throw new BackendError(`Unknown target state "${toState}".`);

  if (artifact.kind === 'spec') {
    segments[2] = dir;
  } else if (artifact.kind === 'initiative') {
    segments[2] = dir;
  } else if (artifact.kind === 'feature') {
    // .specs/initiatives/<initiative-state>/<slug>/<feature-state>/<file>
    segments[4] = dir;
  } else {
    throw new BackendError(`Filesystem backend cannot transition kind "${artifact.kind}".`);
  }
  return segments.join('/');
}

async function moveFile(from, to) {
  try {
    await fsp.rename(from, to);
  } catch (error) {
    if (error.code === 'EXDEV') {
      await fsp.copyFile(from, to);
      await fsp.unlink(from);
      return;
    }
    throw new BackendError(`Failed to move ${from} → ${to}: ${error.message}`);
  }
}

/** Rewrites the `> **Status:** …` header of a moved document (no-op when absent). */
async function updateStatusHeader(absolutePath, toState) {
  if (!absolutePath.endsWith('.md')) return;
  const content = await fsp.readFile(absolutePath, 'utf8');
  const pattern = /^(\s*>\s*\*\*Status:\*\*\s*)([^\n]*?)(\s*)$/m;
  if (!pattern.test(content)) return;

  const label = STATE_LABELS[toState];
  const updated = content.replace(pattern, (_match, prefix, _value, trailing) => `${prefix}${label}${trailing}`);
  if (updated !== content) await fsp.writeFile(absolutePath, updated, 'utf8');
}

/**
 * Inserts markdown entry lines into the section identified by `heading`.
 * Replaces a known placeholder line when present; otherwise appends at the end
 * of the section. Returns `null` when the section cannot be found.
 */
export function insertEntry(content, { heading, placeholders = [], lines }) {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const parts = content.split(eol);
  const headingIndex = parts.findIndex((line) => line.trim() === heading.trim());
  if (headingIndex === -1) return null;

  let sectionEnd = parts.length;
  for (let index = headingIndex + 1; index < parts.length; index += 1) {
    if (/^##\s+/.test(parts[index])) {
      sectionEnd = index;
      break;
    }
  }

  for (let index = headingIndex + 1; index < sectionEnd; index += 1) {
    if (placeholders.some((placeholder) => parts[index].trim() === placeholder.trim())) {
      return [...parts.slice(0, index), ...lines, ...parts.slice(index + 1)].join(eol);
    }
  }

  let insertAt = sectionEnd;
  while (insertAt - 1 > headingIndex && parts[insertAt - 1].trim() === '') insertAt -= 1;

  return [...parts.slice(0, insertAt), '', ...lines, ...parts.slice(insertAt)].join(eol);
}

