import { BackendError } from '../../src/core/errors.js';

/**
 * Template mirror backend factory.
 *
 * Copy `extensions/_TEMPLATE/` to `extensions/<your-id>/`, implement the methods
 * below, then enable it with `spec backend enable <your-id>`.
 *
 * @param {object} context
 * @param {string} context.cwd            Workspace root.
 * @param {object} context.config         Full normalized framework config.
 * @param {object} context.backendConfig  This backend's entry in `.specs/config.json`.
 */
export default function createExampleBackend({ backendConfig }) {
  const backendId = backendConfig.id;

  /** Replace with a real client call. */
  async function callApi() {
    throw new BackendError('Example backend is not implemented yet.');
  }

  return {
    id: backendId,
    type: backendConfig.type,
    remote: true,
    capabilities: { read: true, list: true, transition: true, create: true, link: true },

    async resolve(reference, options = {}) {
      // Return a remote descriptor for `reference`, or null when unknown.
      return null;
    },

    async list({ kind, state } = {}) {
      // Return remote descriptors.
      return [];
    },

    async transition(artifact, toState, { dryRun = false } = {}) {
      // 1. Read the existing remote reference from the artifact metadata.
      // 2. If missing, either create it (when allowed) or throw a BackendError.
      // 3. Update the remote state; return the reference for the CLI to persist.
      const remoteRef = artifact.remote?.[backendId] ?? null;
      if (!remoteRef) {
        throw new BackendError(`"${artifact.slug}" is not linked to ${backendId}.`);
      }
      if (dryRun) return { moved: false, planned: true, remoteRef };
      await callApi();
      return { moved: false, remoteRef };
    },

    async create(artifact, { dryRun = false } = {}) {
      if (dryRun) return { created: false, planned: true };
      await callApi();
      return { created: true, remoteRef: null };
    },

    async link({ child, parent, relation }, { dryRun = false } = {}) {
      // Optional. Return `{ skipped: true }` when unsupported.
      return { linked: false, skipped: true };
    },
  };
}
