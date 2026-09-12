import { BackendError } from '../../src/core/errors.js';

/**
 * Template backend factory.
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
  const settings = backendConfig.settings ?? {};

  /** Replace with a real client call. */
  async function callApi() {
    throw new BackendError('Example backend is not implemented yet.');
  }

  return {
    id: backendConfig.id,
    type: backendConfig.type,
    remote: true,
    capabilities: { read: true, list: true, transition: true, create: true, link: true },

    async resolve(reference, options = {}) {
      // Return an artifact descriptor or null. Prefer delegating to the local
      // filesystem resolution and then mapping to your remote identifier.
      return null;
    },

    async list({ kind, state } = {}) {
      // Return artifact descriptors.
      return [];
    },

    async transition(artifact, toState, { remoteMap, dryRun = false } = {}) {
      // 1. Read the remote reference from the shared map.
      // 2. If missing, either create it (when allowed) or throw a BackendError.
      // 3. Update the remote state. Respect dryRun and stay idempotent.
      const remoteRef = remoteMap?.[artifact.path]?.[backendConfig.id] ?? null;
      if (!remoteRef) {
        throw new BackendError(`"${artifact.path}" is not linked to ${backendConfig.id}.`);
      }
      if (dryRun) return { moved: false, planned: true, remoteRef };
      await callApi();
      return { moved: false, remoteRef };
    },

    async create(artifact, { remoteMap, dryRun = false } = {}) {
      if (dryRun) return { created: false, planned: true };
      await callApi();
      return { created: false };
    },

    async link({ child, parent, relation }, { dryRun = false } = {}) {
      // Optional. Return `{ skipped: true }` when unsupported.
      return { linked: false, skipped: true };
    },
  };
}
