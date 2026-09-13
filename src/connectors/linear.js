import { ConnectorError } from '../core/errors.js';
import { DEFAULT_LINEAR_SETTINGS } from '../core/config.js';
import { createMcpClient } from './mcp/client.js';
import { linearTools, parseIssue, parseIssues, parseToolPayload } from './mcp/linear-tools.js';

/**
 * Linear connector — mirrors local artifacts onto Linear issues through the
 * Linear MCP server (JSON-RPC stdio or HTTP), never through an API key (INV-1).
 * The authenticated transport lives in `settings.mcp` (resolved by /setup), so
 * the auth never leaves the environment.
 *
 * The local filesystem stays the source of truth. Each artifact is linked to at
 * most one Linear issue through `.sdd/.remote-map.json`, which keeps the sync
 * idempotent and committable.
 */
export default function createLinearBackend({ config, connectorConfig }) {
  const settings = { ...DEFAULT_LINEAR_SETTINGS, ...(connectorConfig.settings ?? {}) };
  const connectorId = connectorConfig.id;
  let client = null;

  /**
   * Resolves (and caches for the whole command invocation, INV-4) the MCP
   * transport. Without `settings.mcp` the connector is inoperative (INV-2).
   */
  function transport() {
    if (client && !client.closed) return client;
    const mcp = settings.mcp;
    if (!mcp || typeof mcp !== 'object' || Array.isArray(mcp) || Object.keys(mcp).length === 0) {
      throw new ConnectorError(`Linear connector "${connectorId}" has no MCP transport configured — run /setup.`);
    }
    client = createMcpClient(mcp); // malformed shape → UsageError (exit 2)
    return client;
  }

  /** Runs one mapped tool call, appending the /setup invite to transport failures. */
  async function call({ tool, args }) {
    const mcp = transport();
    try {
      return await mcp.call(tool, args);
    } catch (error) {
      if (error instanceof ConnectorError && !error.message.includes('/setup')) {
        throw new ConnectorError(`${error.message} — run /setup to check the connector transport.`);
      }
      throw error;
    }
  }

  async function fetchIssue(identifier) {
    const payload = parseToolPayload(await call(linearTools.resolve(identifier)));
    return parseIssue(payload);
  }

  function buildDescription(artifact) {
    const modelPath = artifact.model?.meta ? `.sdd/canonical/${artifact.model.meta}` : '—';
    const projection = artifact.projection ? `.sdd/${artifact.projection}` : '—';
    return [
      '_Synced by SDD Framework — do not edit structural fields manually._',
      '',
      '| Field | Value |',
      '|---|---|',
      `| Kind | \`${artifact.kind}\` |`,
      `| ID | \`${artifact.id}\` |`,
      `| Slug | \`${artifact.slug}\` |`,
      `| Model | \`${modelPath}\` |`,
      `| Projection | \`${projection}\` |`,
    ].join('\n');
  }

  async function createIssue(artifact, state) {
    if (!settings.teamKey) {
      throw new ConnectorError(`Linear connector "${connectorId}" requires settings.teamKey in .sdd/config.json.`);
    }
    const input = {
      teamKey: settings.teamKey,
      title: artifact.title ?? artifact.slug,
      description: buildDescription(artifact),
    };
    const stateName = settings.stateMap?.[state] ?? settings.stateMap?.planned ?? null;
    if (stateName) input.state = stateName;
    const labelName = settings.labels?.[artifact.kind] ?? null;
    if (labelName) input.labels = [labelName];

    const payload = parseToolPayload(await call(linearTools.create(input)));
    const created = parseIssue(payload);
    if (!created?.identifier) {
      throw new ConnectorError('Linear create_issue returned no identifier.');
    }
    return created;
  }

  return {
    id: connectorId,
    type: 'linear',
    remote: true,
    capabilities: { read: true, list: true, transition: true, link: false, create: true, remote: true },

    /** Resolves a Linear identifier (e.g. `ENG-142`) into a remote descriptor. */
    async resolve(reference) {
      if (!/^[A-Z][A-Z0-9]*-\d+$/.test(reference ?? '')) return null;
      const issue = await fetchIssue(reference);
      if (!issue) return null;
      return {
        kind: 'issue',
        id: issue.identifier,
        slug: issue.identifier,
        title: issue.title,
        state: issue.state,
        path: null,
      };
    },

    async list({ kind } = {}) {
      if (!settings.teamKey) {
        throw new ConnectorError(`Linear connector "${connectorId}" requires settings.teamKey in .sdd/config.json.`);
      }
      const payload = parseToolPayload(await call(linearTools.list({ teamKey: settings.teamKey })));
      const issues = parseIssues(payload).map((issue) => ({
        kind: 'issue',
        id: issue.identifier,
        slug: issue.identifier,
        title: issue.title,
        state: issue.state,
        labels: issue.labels ?? [],
        path: null,
      }));
      if (!kind) return issues;
      const labelName = settings.labels?.[kind];
      return labelName ? issues.filter((issue) => issue.labels.includes(labelName)) : issues;
    },

    /**
     * Applies a lifecycle transition to the linked Linear issue.
     * Creates the issue first when `settings.createOnMove` is enabled.
     * The remote reference is returned so the caller can persist it in the model.
     */
    async transition(artifact, toState, { dryRun = false } = {}) {
      const targetName = settings.stateMap?.[toState];
      if (!targetName) {
        throw new ConnectorError(`No Linear state mapping for framework state "${toState}".`);
      }

      const ref = artifact.remote?.[connectorId] ?? null;
      if (!ref) {
        if (!settings.createOnMove) {
          throw new ConnectorError(
            `Artifact "${artifact.slug}" is not linked to Linear. Run \`sdd sync ${artifact.slug} --create\`, or set settings.createOnMove=true.`,
          );
        }
        if (dryRun) return { moved: false, planned: true, action: 'create', state: targetName };
        const created = await createIssue(artifact, artifact.state);
        return { moved: true, action: 'create', remoteRef: created.identifier, state: targetName };
      }

      const issue = await fetchIssue(ref);
      if (!issue) {
        throw new ConnectorError(`Linear issue "${ref}" not found (mapped from ${artifact.slug}).`);
      }
      if ((issue.state ?? '').toLowerCase() === targetName.toLowerCase()) {
        return { moved: false, remoteRef: ref, state: targetName };
      }
      if (dryRun) return { moved: false, planned: true, remoteRef: ref, state: targetName };

      await call(linearTools.transition(ref, targetName));
      return { moved: true, remoteRef: ref, state: targetName };
    },

    /** Creates the remote issue for an artifact, returning its reference. */
    async create(artifact, { dryRun = false } = {}) {
      const existing = artifact.remote?.[connectorId] ?? null;
      if (existing) return { created: false, remoteRef: existing };
      if (dryRun) return { created: false, planned: true };
      const created = await createIssue(artifact, artifact.state);
      return { created: true, remoteRef: created.identifier };
    },

    async link() {
      return { linked: false, skipped: true, reason: 'Linear relations are not managed by the framework yet.' };
    },

    /** Releases the underlying MCP transport early (INV-4, test/diagnostic hook). */
    async close() {
      if (!client) return;
      await client.close();
      client = null;
    },
  };
}