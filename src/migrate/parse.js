import { GENERATED_SECTIONS } from '../render/markdown.js';

const SEPARATOR_RE = /^-{3,}\s*$/;
const TITLE_PREFIX = {
  spec: /^Spec:\s*\d{3}\s*-\s*/,
  initiative: /^Initiative:\s*/,
  feature: /^Feature:\s*/,
  vision: /^Product Vision:\s*/,
};

/** Keys whose values are derived from the model and must not be stored as fields. */
const DERIVED_KEYS = new Set(['Status', 'Initiative Slug', 'Parent Initiative', 'Feature', 'Initiative']);

export function cleanTitle(kind, rawTitle) {
  const prefix = TITLE_PREFIX[kind];
  return (prefix ? rawTitle.replace(prefix, '') : rawTitle).trim();
}

/**
 * Extracts `* **Key:** value` bullets and `> **Key:** value` blockquote lines into a map.
 */
export function parseFields(headerLines) {
  const fields = {};
  for (const line of headerLines) {
    const match = line.match(/^\s*(?:[*-]|>)\s+\*\*(.+?):\*\*\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    if (DERIVED_KEYS.has(key)) continue;
    fields[key] = match[2].trim();
  }
  return fields;
}

/** Removes graph-generated sections from a body so they can be re-derived. */
export function stripGeneratedSections(body, kind) {
  const headings = GENERATED_SECTIONS[kind] ?? [];
  if (headings.length === 0) return body;

  const kept = [];
  let skipping = false;
  for (const line of body.split('\n')) {
    if (headings.includes(line.trim())) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (/^##\s+/.test(line)) skipping = false;
      else continue;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

/**
 * Parses an existing markdown document into `{ title, fields, body }`.
 * The header spans from the title to the first `---` separator. When a document
 * has no separator, it falls back to the `## Metadata` block (specs) or the
 * first `##` section heading.
 */
export function parseArtifactDocument(content, kind) {
  const lines = content.split('\n');
  let headerStart = 0;
  let title = null;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^#\s+(.+)$/);
    if (match) {
      title = cleanTitle(kind, match[1]);
      headerStart = index + 1;
      break;
    }
  }

  const bodyStart = findBodyStart(lines, headerStart);
  const headerLines = lines.slice(headerStart, bodyStart);
  const rawBody = lines.slice(bodyStart).join('\n');
  const stripped = stripGeneratedSections(rawBody, kind);

  return {
    title,
    fields: parseFields(headerLines),
    body: stripped.replace(/(?:\n\s*-{3,}\s*)+\s*$/g, '').trim(),
  };
}

/**
 * Returns the index at which the document body begins.
 * Prefers the first `---` separator; otherwise skips an optional `## Metadata`
 * block and stops at the next section heading.
 */
function findBodyStart(lines, headerStart) {
  for (let index = headerStart; index < lines.length; index += 1) {
    if (SEPARATOR_RE.test(lines[index])) return index + 1;
  }

  let metadataEnd = -1;
  for (let index = headerStart; index < lines.length; index += 1) {
    if (!/^##\s+/.test(lines[index])) continue;
    if (metadataEnd === -1) {
      if (!/^##\s+Metadata/i.test(lines[index])) return index;
      metadataEnd = index;
      continue;
    }
    return index;
  }

  return metadataEnd === -1 ? headerStart : lines.length;
}

/** Collects every spec slug referenced in a generated `## 6.` section. */
export function extractSpecSlugs(content) {
  const slugs = new Set();
  for (const match of content.matchAll(/\*\*`(\d{3}-[\w-]+)`\*\*/g)) slugs.add(match[1]);
  return [...slugs];
}
