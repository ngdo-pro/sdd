import path from 'node:path';
import { toPosix } from '../core/paths.js';

/** Sections generated from the graph (stripped from bodies, appended on render). */
export const GENERATED_SECTIONS = {
  vision: ['## 5. Strategic Initiatives Roadmap'],
  initiative: ['## 4. Feature Roadmap'],
  feature: ['## 6. Implementation Spec(s)'],
  spec: [],
};

const STATUS_LABEL = { planned: 'Planned', active: 'Active', archived: 'Archived' };

function blockquote(pairs) {
  return pairs
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([label, value]) => `> **${label}:** ${value}  `)
    .join('\n');
}

function field(entries, label) {
  return entries.find(([key]) => key === label)?.[1];
}

function checkbox(done) {
  return done ? '[x]' : '[ ]';
}

/** Relative POSIX link target between two projection-relative paths. */
function linkTarget(fromRelative, toRelative) {
  const target = toPosix(path.relative(path.dirname(fromRelative), toRelative));
  return target.startsWith('.') ? target : `./${target}`;
}

/** Renders the document header (title + metadata) for any artifact kind. */
export function renderHeader(artifact) {
  const entries = Object.entries(artifact.fields ?? {});

  switch (artifact.kind) {
    case 'spec': {
      const lines = entries.map(([key, value]) => `* **${key}:** ${value}`);
      if (artifact.relations?.feature) lines.push(`* **Feature:** \`${artifact.relations.feature}\``);
      if (artifact.relations?.initiative) lines.push(`* **Initiative:** \`${artifact.relations.initiative}\``);
      return [
        `# Spec: ${artifact.id} - ${artifact.title}`,
        '',
        '## Metadata',
        ...(lines.length > 0 ? lines : ['* _(no metadata)_']),
      ].join('\n');
    }
    case 'initiative': {
      const pairs = [
        ['Type', field(entries, 'Type') ?? 'Product / UX'],
        ['Initiative Slug', `\`${artifact.slug}\``],
        ['Owner', field(entries, 'Owner') ?? 'TBD'],
        ['Status', STATUS_LABEL[artifact.state] ?? 'Planned'],
        ['Started', field(entries, 'Started') ?? artifact.createdAt],
      ];
      return [`# Initiative: ${artifact.title}`, '', blockquote(pairs)].join('\n');
    }
    case 'feature': {
      const pairs = [
        ['Parent Initiative', `\`${artifact.relations?.initiative ?? 'unknown'}\``],
        ['Status', STATUS_LABEL[artifact.state] ?? 'Planned'],
        ['Author(s)', field(entries, 'Author(s)') ?? 'TBD'],
        ['Last Updated', artifact.updatedAt ?? artifact.createdAt],
      ];
      return [`# Feature: ${artifact.title}`, '', blockquote(pairs)].join('\n');
    }
    case 'vision': {
      const pairs = [
        ['Product', field(entries, 'Product') ?? artifact.title],
        ['Last Revision', artifact.updatedAt ?? artifact.createdAt],
        ['Status', 'Living (Amendable only during strategic pivots)'],
      ];
      return [`# Product Vision: ${artifact.title}`, '', blockquote(pairs)].join('\n');
    }
    default:
      return `# ${artifact.title}`;
  }
}

/** Generated `## 4. Feature Roadmap` section of an initiative. */
function renderFeatureRoadmap(artifact, graph) {
  const children = graph.children(artifact.slug);
  const header = ['## 4. Feature Roadmap', '', '*Ordered sequence of discrete features planned for this initiative:*', ''];

  if (children.length === 0) {
    return [...header, '_No features framed yet (create one via `/feature`)._'].join('\n');
  }

  const lines = [];
  for (const child of children) {
    const target = linkTarget(artifact.projection, child.projection);
    const stateLabel = child.state === 'active'
      ? '*(Active 🛠️)*'
      : child.state === 'archived' ? '*(Archived ✅)*' : '*(Framed ✅ — Ready for `/spec`)*';
    lines.push(`- ${checkbox(graph.isComplete(child))} **\`${child.slug}\`**: ${child.title}  `);
    lines.push(`  ↳ *Feature:* [\`${child.projection}\`](${target})  ${stateLabel}`);
  }
  return [...header, ...lines].join('\n');
}

/** Generated `## 6. Implementation Spec(s)` section of a feature. */
function renderSpecList(artifact, graph) {
  const children = graph.children(artifact.slug);
  const header = ['## 6. Implementation Spec(s)', ''];

  if (children.length === 0) {
    return [...header, '*No execution specs linked yet.*'].join('\n');
  }

  const lines = [];
  for (const child of children) {
    const target = linkTarget(artifact.projection, child.projection);
    lines.push(`- ${checkbox(graph.isComplete(child))} **\`${child.slug}\`** : ${child.title}  `);
    lines.push(`  ↳ *Spec:* [\`${child.projection}\`](${target})`);
  }
  return [...header, ...lines].join('\n');
}

/** Generated `## 5. Strategic Initiatives Roadmap` section of the vision. */
function renderVisionRoadmap(artifact, graph) {
  const initiatives = graph.byKind('initiative');
  const buckets = [
    ['### 🚀 Active Initiatives', initiatives.filter((entry) => entry.state === 'active')],
    ['### 🎯 Planned Initiatives (Ready)', initiatives.filter((entry) => entry.state === 'planned')],
    ['### ✅ Archived / Delivered', initiatives.filter((entry) => entry.state === 'archived')],
  ];

  const lines = ['## 5. Strategic Initiatives Roadmap', ''];
  for (const [title, entries] of buckets) {
    lines.push(title, '');
    if (entries.length === 0) {
      lines.push('_None._', '');
      continue;
    }
    for (const entry of entries) {
      const target = linkTarget('vision.md', entry.projection);
      lines.push(`- ${checkbox(graph.isComplete(entry))} **\`${entry.slug}\`**: ${entry.title}  `);
      lines.push(`  ↳ *Initiative:* [\`${entry.projection}\`](${target})`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/** Renders the graph-derived sections for an artifact (empty when irrelevant). */
export function renderGeneratedSections(artifact, graph) {
  switch (artifact.kind) {
    case 'initiative':
      return renderFeatureRoadmap(artifact, graph);
    case 'feature':
      return renderSpecList(artifact, graph);
    case 'vision':
      return renderVisionRoadmap(artifact, graph);
    default:
      return '';
  }
}

/** Renders the full markdown projection of an artifact. */
export function renderDocument(artifact, graph) {
  const parts = [renderHeader(artifact), '', '---', '', artifact.body.trimEnd()];
  const generated = renderGeneratedSections(artifact, graph);
  if (generated) parts.push('', '---', '', generated);
  return `${parts.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

export { linkTarget, checkbox, STATUS_LABEL };

