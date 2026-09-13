/**
 * Builds the artifact graph: parent↔child relations, derived progress and
 * completion, which drive the generated roadmap sections and the archive cascade.
 */
export function buildGraph(artifacts) {
  const bySlug = new Map(artifacts.map((artifact) => [artifact.slug, artifact]));
  const childrenOf = new Map();

  for (const artifact of artifacts) {
    const parentSlug = parentSlugOf(artifact);
    if (!parentSlug) continue;
    if (!childrenOf.has(parentSlug)) childrenOf.set(parentSlug, []);
    childrenOf.get(parentSlug).push(artifact);
  }

  for (const [, children] of childrenOf) {
    children.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  const completionMemo = new Map();

  function isComplete(artifact) {
    if (completionMemo.has(artifact.slug)) return completionMemo.get(artifact.slug);
    completionMemo.set(artifact.slug, false); // guards against cycles

    let complete;
    const children = childrenOf.get(artifact.slug) ?? [];
    if (artifact.state === 'archived') {
      complete = true;
    } else if (children.length === 0) {
      complete = artifact.progress?.done === true;
    } else {
      complete = children.every((child) => isComplete(child));
    }

    completionMemo.set(artifact.slug, complete);
    return complete;
  }

  for (const artifact of artifacts) isComplete(artifact);

  return {
    artifacts,
    bySlug,
    childrenOf,
    children: (slug) => childrenOf.get(slug) ?? [],
    parentOf: (artifact) => {
      const slug = parentSlugOf(artifact);
      return slug ? bySlug.get(slug) ?? null : null;
    },
    isComplete,
    progressOf: (slug) => {
      const children = childrenOf.get(slug) ?? [];
      const completed = children.filter((child) => isComplete(child)).length;
      return {
        children: children.length,
        completed,
        complete: children.length > 0 ? completed === children.length : false,
      };
    },
    byKind: (kind) => artifacts.filter((artifact) => artifact.kind === kind),
    byState: (state) => artifacts.filter((artifact) => artifact.state === state),
  };
}

/** Slug of the parent artifact for a given child, or null. */
export function parentSlugOf(artifact) {
  if (artifact.kind === 'feature') return artifact.relations?.initiative ?? null;
  if (artifact.kind === 'spec') return artifact.relations?.feature ?? null;
  return null;
}

/**
 * Computes the artifacts that can be archived because every child is complete.
 * Parents are cascaded regardless of whether they were explicitly activated:
 * finishing the last child is the signal that the parent is delivered.
 * @returns {Array} `{ artifact, reason }`
 */
export function cascadeCandidates(graph) {
  const candidates = [];
  for (const artifact of graph.artifacts) {
    if (artifact.state === null || artifact.state === 'archived') continue;
    if (graph.children(artifact.slug).length === 0) continue;
    if (graph.progressOf(artifact.slug).complete) {
      candidates.push({ artifact, reason: 'all children complete' });
    }
  }
  return candidates;
}
