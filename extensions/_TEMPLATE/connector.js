import { ConnectorError } from '../../src/core/errors.js';

/**
 * Template mirror connector factory.
 *
 * Copy `extensions/_TEMPLATE/` to `extensions/<your-id>/`, implement the methods
 * below, then enable it with `sdd connectors enable <your-id>`.
 *
 * @param {object} context
 * @param {string} context.cwd            Workspace root.
 * @param {object} context.config         Full normalized framework config.
 * @param {object} context.connectorConfig  This connector's entry in `.sdd/config.json`.
 */
export default function createExampleConnector({ connectorConfig }) {
  const connectorId = connectorConfig.id;

  /** Replace with a real client call. */
  async function callApi() {
    throw new ConnectorError('Example connector is not implemented yet.');
  }

  return {
    id: connectorId,
    type: connectorConfig.type,
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
      // 2. If missing, either create it (when allowed) or throw a ConnectorError.
      // 3. Update the remote state; return the reference for the CLI to persist.
      const remoteRef = artifact.remote?.[connectorId] ?? null;
      if (!remoteRef) {
        throw new ConnectorError(`"${artifact.slug}" is not linked to ${connectorId}.`);
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
