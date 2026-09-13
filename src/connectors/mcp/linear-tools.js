/**
 * Mirror mapping (INV-3): the framework's mirror ops onto the Linear MCP
 * tools — tool names, arguments and result parsing live here so `linear.js`
 * stays a thin orchestrator.
 */
export const linearTools = {
  resolve: (ref) => ({ tool: 'get_issue', args: { id: ref } }),
  list: (filter) => ({ tool: 'list_issues', args: filter }),
  transition: (ref, st) => ({ tool: 'update_issue', args: { id: ref, state: st } }),
  create: (artifact) => ({ tool: 'create_issue', args: artifact }),
  link: (ref, meta) => ({ tool: 'update_issue', args: { id: ref, ...meta } }),
};

/**
 * Extracts the JSON payload of a `tools/call` result (text content blocks).
 * Tool-level failures (`isError`) surface as `ConnectorError`; a `null`
 * payload (e.g. an unknown issue) is a legitimate result.
 */
export function parseToolPayload(result) {
  const text = (result?.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  if (result?.isError) {
    throw new Error(text.trim() || 'tool call failed');
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Normalizes one Linear issue payload into the mirror descriptor shape. */
export function parseIssue(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const stateName = typeof payload.state === 'string'
    ? payload.state
    : payload.state?.name ?? null;
  const labels = (payload.labels ?? []).map((label) => (typeof label === 'string' ? label : label.name));
  return {
    identifier: payload.identifier,
    title: payload.title,
    state: stateName,
    labels,
    description: payload.description ?? null,
  };
}

/** Normalizes an `list_issues` payload into an array of issue descriptors. */
export function parseIssues(payload) {
  const issues = Array.isArray(payload) ? payload : payload?.issues ?? [];
  return issues.map((issue) => parseIssue(issue)).filter(Boolean);
}