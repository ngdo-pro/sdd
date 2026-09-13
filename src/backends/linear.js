import { BackendError } from '../core/errors.js';
import { DEFAULT_LINEAR_SETTINGS } from '../core/config.js';

const LINEAR_ENDPOINT = 'https://api.linear.app/graphql';

/**
 * Linear backend — mirrors local artifacts onto Linear issues.
 *
 * The local filesystem stays the source of truth. Each artifact is linked to at
 * most one Linear issue through `.specs/.remote-map.json`, which keeps the sync
 * idempotent and committable.
 */
export default function createLinearBackend({ config, backendConfig }) {
  const settings = { ...DEFAULT_LINEAR_SETTINGS, ...(backendConfig.settings ?? {}) };
  const backendId = backendConfig.id;
  const apiKey = settings.apiKey ?? process.env.LINEAR_API_KEY ?? null;
  let teamCache = null;

  async function graphql(query, variables) {
    if (!apiKey) {
      throw new BackendError(
        `Linear backend "${backendId}" has no API key. Export LINEAR_API_KEY or set settings.apiKey in .specs/config.json.`,
      );
    }
    let response;
    try {
      response = await fetch(LINEAR_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: apiKey },
        body: JSON.stringify({ query, variables }),
      });
    } catch (error) {
      throw new BackendError(`Linear request failed: ${error.message}`);
    }
    if (!response.ok) {
      throw new BackendError(`Linear API HTTP ${response.status}: ${await response.text()}`);
    }
    const payload = await response.json();
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw new BackendError(`Linear API error: ${payload.errors.map((error) => error.message).join('; ')}`);
    }
    return payload.data;
  }

  async function getTeam() {
    if (teamCache) return teamCache;
    if (!settings.teamKey) {
      throw new BackendError(`Linear backend "${backendId}" requires settings.teamKey in .specs/config.json.`);
    }
    const data = await graphql(TEAM_QUERY, { key: settings.teamKey });
    const team = data.teams?.nodes?.[0];
    if (!team) throw new BackendError(`Linear team "${settings.teamKey}" not found.`);
    teamCache = team;
    return team;
  }

  function findState(team, stateName) {
    return team.states?.nodes?.find(
      (state) => state.name.toLowerCase() === String(stateName).toLowerCase(),
    ) ?? null;
  }

  function findLabel(team, labelName) {
    if (!labelName) return null;
    return team.labels?.nodes?.find(
      (label) => label.name.toLowerCase() === String(labelName).toLowerCase(),
    ) ?? null;
  }

  async function resolveStateId(state) {
    const team = await getTeam();
    const stateName = settings.stateMap?.[state];
    if (!stateName) {
      throw new BackendError(`No Linear state mapping for framework state "${state}". Update settings.stateMap.`);
    }
    const match = findState(team, stateName);
    if (!match) {
      throw new BackendError(`Linear team "${settings.teamKey}" has no workflow state named "${stateName}".`);
    }
    return match;
  }

  async function fetchIssue(identifier) {
    const data = await graphql(ISSUE_QUERY, { id: identifier });
    return data.issue ?? null;
  }

  function buildDescription(artifact) {
    const modelPath = artifact.model?.meta ? `.specs/model/${artifact.model.meta}` : '—';
    const projection = artifact.projection ? `.specs/${artifact.projection}` : '—';
    return [
      '_Synced by Spec Framework — do not edit structural fields manually._',
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
    const team = await getTeam();
    const targetState = findState(team, settings.stateMap?.[state] ?? settings.stateMap?.planned);
    const label = findLabel(team, settings.labels?.[artifact.kind]);

    const input = {
      teamId: team.id,
      title: artifact.title ?? artifact.slug,
      description: buildDescription(artifact),
    };
    if (targetState) input.stateId = targetState.id;
    if (label) input.labelIds = [label.id];

    const data = await graphql(CREATE_ISSUE_MUTATION, { input });
    if (!data.issueCreate?.success) {
      throw new BackendError('Linear issueCreate returned success=false.');
    }
    return data.issueCreate.issue;
  }

  return {
    id: backendId,
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
        state: issue.state?.name ?? null,
        path: null,
      };
    },

    async list({ kind } = {}) {
      const team = await getTeam();
      const data = await graphql(ISSUES_QUERY, { teamId: team.id });
      const nodes = data.team?.issues?.nodes ?? [];
      const issues = nodes.map((issue) => ({
        kind: 'issue',
        id: issue.identifier,
        slug: issue.identifier,
        title: issue.title,
        state: issue.state?.name ?? null,
        labels: issue.labels?.nodes?.map((label) => label.name) ?? [],
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
        throw new BackendError(`No Linear state mapping for framework state "${toState}".`);
      }

      const ref = artifact.remote?.[backendId] ?? null;
      if (!ref) {
        if (!settings.createOnMove) {
          throw new BackendError(
            `Artifact "${artifact.slug}" is not linked to Linear. Run \`spec sync ${artifact.slug} --create\`, or set settings.createOnMove=true.`,
          );
        }
        if (dryRun) return { moved: false, planned: true, action: 'create', state: targetName };
        const created = await createIssue(artifact, artifact.state);
        return { moved: true, action: 'create', remoteRef: created.identifier, state: targetName };
      }

      const issue = await fetchIssue(ref);
      if (!issue) {
        throw new BackendError(`Linear issue "${ref}" not found (mapped from ${artifact.slug}).`);
      }
      if ((issue.state?.name ?? '').toLowerCase() === targetName.toLowerCase()) {
        return { moved: false, remoteRef: ref, state: targetName };
      }

      const targetState = await resolveStateId(toState);
      if (dryRun) return { moved: false, planned: true, remoteRef: ref, state: targetName };

      const data = await graphql(UPDATE_ISSUE_MUTATION, { id: issue.id, input: { stateId: targetState.id } });
      if (!data.issueUpdate?.success) {
        throw new BackendError(`Linear issueUpdate failed for ${ref}.`);
      }
      return { moved: true, remoteRef: ref, state: targetName };
    },

    /** Creates the remote issue for an artifact, returning its reference. */
    async create(artifact, { dryRun = false } = {}) {
      const existing = artifact.remote?.[backendId] ?? null;
      if (existing) return { created: false, remoteRef: existing };
      if (dryRun) return { created: false, planned: true };
      const created = await createIssue(artifact, artifact.state);
      return { created: true, remoteRef: created.identifier };
    },

    async link() {
      return { linked: false, skipped: true, reason: 'Linear relations are not managed by the framework yet.' };
    },
  };
}

const TEAM_QUERY = `
  query SpecFrameworkTeam($key: String!) {
    teams(filter: { key: { eq: $key } }) {
      nodes {
        id
        key
        name
        states { nodes { id name } }
        labels { nodes { id name } }
      }
    }
  }
`;

const ISSUE_QUERY = `
  query SpecFrameworkIssue($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      state { id name }
      labels { nodes { id name } }
    }
  }
`;

const ISSUES_QUERY = `
  query SpecFrameworkIssues($teamId: String!) {
    team(id: $teamId) {
      issues(first: 100) {
        nodes {
          id
          identifier
          title
          state { id name }
          labels { nodes { id name } }
        }
      }
    }
  }
`;

const CREATE_ISSUE_MUTATION = `
  mutation SpecFrameworkIssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue { id identifier title }
    }
  }
`;

const UPDATE_ISSUE_MUTATION = `
  mutation SpecFrameworkIssueUpdate($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      issue { id identifier state { id name } }
    }
  }
`;
