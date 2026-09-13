import path from 'node:path';
import fsp from 'node:fs/promises';

/**
 * Static consumption site (`spec render --site` → `.sdd/site/`).
 *
 * INV-2: this module imports nothing but `node:` builtins — the HTML is
 * produced with template literals and one inlined CSS constant, so the site
 * is generated with zero runtime dependency. The shared path contract is
 * therefore mirrored locally: SPECS_DIRNAME/SITE_DIRNAME must stay in sync
 * with src/core/paths.js (which owns ALLOWED_ROOT_ENTRIES and the `site`
 * root-layout tolerance).
 */
const SPECS_DIRNAME = '.sdd';
const SITE_DIRNAME = 'site';

/** Frontier of every write and of the full purge: `.sdd/site/` — never the parent. */
function siteRoot(cwd) {
  return path.join(cwd, SPECS_DIRNAME, SITE_DIRNAME);
}

// ---------------------------------------------------------------------------
// HTML plumbing — escape first, render second (watchout §6): bodies embed
// mermaid/HTML fences, so every piece of content goes through escapeHtml
// BEFORE any inline substitution, and inline HTML is never interpreted.
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** Local slugify (schema.js semantics, kept local for the zero-import rule). */
function anchorSlug(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[`*[\]()]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

const LINK_RE = /\[([^\]]+)\]\(([^)]*)\)/g;
const CODE_RE = /`([^`]+)`/g;
const BOLD_RE = /\*\*(.+?)\*\*/g;
const ITALIC_RE = /\*([^*]+?)\*/g;
const GHERKIN_KEYWORD_RE = /\b(Feature|Scenario|Background|Rule|Examples|Given|When|Then|And|But)\b(:)?/g;

/**
 * Inline markdown → HTML over ALREADY-ESCAPED text: links collapse to their
 * label (hrefs of bodies are projection anchors, meaningless in the site —
 * the generated chrome carries the navigation), backticks/asterisks wrap.
 */
function renderInline(escaped) {
  return escaped
    .replace(LINK_RE, '$1')
    .replace(CODE_RE, '<code>$1</code>')
    .replace(BOLD_RE, '<strong>$1</strong>')
    .replace(ITALIC_RE, '<em>$1</em>');
}

/** Bolds the Gherkin keywords of an already-escaped fence content. */
function boldGherkinKeywords(escaped) {
  return escaped.replace(GHERKIN_KEYWORD_RE, '<strong>$1</strong>$2');
}

const FENCE_OPEN_RE = /^\s*```([A-Za-z0-9_-]*)\s*$/;
const FENCE_CLOSE_RE = /^\s*```\s*$/;
const HEADING_RE = /^(#{1,4})\s+(.*)$/;
const HR_RE = /^-{3,}\s*$/;
const QUOTE_RE = /^>\s?/;
const LIST_ITEM_RE = /^(\s*)(?:[-*]|\u21B3)\s+(.*)$/;
const CHECKBOX_RE = /^\[([ xX])\]\s*(.*)$/;
const TABLE_SEPARATOR_RE = /^\s*\|?[\s:|-]+\|?\s*$/;

function tableCells(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function renderTable(header, rows) {
  const cell = (value, tag) => `<${tag}>${renderInline(escapeHtml(value))}</${tag}>`;
  const head = `<tr>${header.map((value) => cell(value, 'th')).join('')}</tr>`;
  const body = rows.map((row) => `<tr>${row.map((value) => cell(value, 'td')).join('')}</tr>`).join('');
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

/**
 * Minimal markdown → HTML converter, line by line, covering exactly the
 * constructs used by the framework templates (§4.1): headings #–####, fenced
 * blocks (literal, never re-interpreted) with a dedicated Gherkin style,
 * checkbox lists nested two levels max, pipe tables, blockquotes, hr, and
 * inline bold/italic/code. Everything is HTML-escaped first; a blank line
 * separates paragraphs. Not a full markdown parser — out of scope.
 */
export function renderBodyHtml(body) {
  const lines = String(body ?? '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  let pending = []; // buffered list items: { depth, html }

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      out.push(`<p>${paragraph.join(' ')}</p>`);
      paragraph = [];
    }
  };

  const flushList = () => {
    if (pending.length === 0) return;
    const html = [];
    let depth = 0;
    let open = false; // an <li> is currently open at `depth`
    for (const entry of pending) {
      if (entry.depth > depth) {
        html.push('<ul>');
        depth += 1;
        open = false;
      } else if (entry.depth < depth) {
        html.push('</li></ul>');
        depth -= 1;
      }
      if (open) html.push('</li>');
      html.push(`<li>${entry.html}`);
      open = true;
    }
    while (depth > 0) {
      html.push('</li></ul>');
      depth -= 1;
    }
    out.push(html.join(''));
    pending = [];
  };

  const closeBlocks = () => {
    flushList();
    flushParagraph();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    // Fenced block: literal escaped content, never interpreted as markdown —
    // titles, pipes or gherkin lookalikes inside stay code (watchout §6).
    const fence = line.match(FENCE_OPEN_RE);
    if (fence) {
      closeBlocks();
      const buffer = [];
      index += 1;
      while (index < lines.length && !FENCE_CLOSE_RE.test(lines[index])) {
        buffer.push(lines[index]);
        index += 1;
      }
      const code = escapeHtml(buffer.join('\n'));
      out.push(fence[1].toLowerCase() === 'gherkin'
        ? `<pre class="code gherkin">${boldGherkinKeywords(code)}</pre>`
        : `<pre class="code">${code}</pre>`);
      continue;
    }

    if (line.trim() === '') {
      closeBlocks();
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      closeBlocks();
      const level = heading[1].length;
      const text = heading[2].trim();
      out.push(`<h${level} id="${anchorSlug(text)}">${renderInline(escapeHtml(text))}</h${level}>`);
      continue;
    }

    if (HR_RE.test(line.trim())) {
      closeBlocks();
      out.push('<hr>');
      continue;
    }

    // Pipe table: current line holds a pipe AND the next one is a dashes row.
    if (line.includes('|') && index + 1 < lines.length
      && TABLE_SEPARATOR_RE.test(lines[index + 1]) && lines[index + 1].includes('-')) {
      closeBlocks();
      const header = tableCells(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim() !== '') {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      index -= 1;
      out.push(renderTable(header, rows));
      continue;
    }

    if (QUOTE_RE.test(line)) {
      closeBlocks();
      const quote = [];
      while (index < lines.length && QUOTE_RE.test(lines[index])) {
        quote.push(lines[index].replace(QUOTE_RE, '').trimEnd());
        index += 1;
      }
      index -= 1;
      out.push(`<blockquote>${quote.map((entry) => `<p>${renderInline(escapeHtml(entry))}</p>`).join('')}</blockquote>`);
      continue;
    }

    // List item: `- ` / `* ` at level 1, indented (`  ↳ `, `  - `) at level 2.
    const item = line.match(LIST_ITEM_RE);
    if (item) {
      flushParagraph();
      const depth = item[1].length === 0 ? 1 : 2;
      let content = item[2];
      let glyph = '';
      const checkbox = content.match(CHECKBOX_RE);
      if (checkbox) {
        glyph = checkbox[1] === ' ' ? '☐ ' : '☑ ';
        content = checkbox[2];
      }
      pending.push({ depth, html: `${glyph}${renderInline(escapeHtml(content))}` });
      continue;
    }

    flushList();
    paragraph.push(renderInline(escapeHtml(line.trim())));
  }

  closeBlocks();
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Site model — pure derivation from the loaded artifacts (§4.1): progress and
// completeness mirror buildGraph semantics locally (same rules: archived is
// complete, leaves carry progress.done, parents need every child complete),
// computed in-process with zero I/O — never index.json, never a projection.
// ---------------------------------------------------------------------------

function localGraph(artifacts) {
  const bySlug = new Map(artifacts.map((artifact) => [artifact.slug, artifact]));
  const childrenOf = new Map();

  for (const artifact of artifacts) {
    const parentSlug = artifact.kind === 'feature'
      ? artifact.relations?.initiative ?? null
      : artifact.kind === 'spec'
        ? artifact.relations?.feature ?? null
        : null;
    if (!parentSlug || !bySlug.has(parentSlug)) continue;
    if (!childrenOf.has(parentSlug)) childrenOf.set(parentSlug, []);
    childrenOf.get(parentSlug).push(artifact);
  }
  for (const children of childrenOf.values()) {
    children.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  const memo = new Map();
  function isComplete(artifact) {
    if (memo.has(artifact.slug)) return memo.get(artifact.slug);
    memo.set(artifact.slug, false); // guards against cycles
    const children = childrenOf.get(artifact.slug) ?? [];
    const complete = artifact.state === 'archived'
      ? true
      : children.length === 0
        ? artifact.progress?.done === true
        : children.every(isComplete);
    memo.set(artifact.slug, complete);
    return complete;
  }
  for (const artifact of artifacts) isComplete(artifact);

  return {
    children: (slug) => childrenOf.get(slug) ?? [],
    isComplete,
    progressOf: (slug) => {
      const children = childrenOf.get(slug) ?? [];
      const completed = children.filter(isComplete).length;
      return {
        children: children.length,
        completed,
        complete: children.length > 0 && completed === children.length,
      };
    },
  };
}

function datesOf(artifact) {
  return { created: artifact.createdAt ?? null, updated: artifact.updatedAt ?? null };
}

/**
 * Builds the pure site model consumed by the pages: the same data as
 * index.json (kind, id, slug, title, state, relations, progress) plus the
 * graph derivations, all computed from the loaded artifacts — dates come
 * from the metadata, spec bodies are carried for their page.
 */
export function buildSiteModel(artifacts) {
  const graph = localGraph(artifacts);

  const specs = artifacts
    .filter((artifact) => artifact.kind === 'spec')
    .map((artifact) => ({
      kind: 'spec',
      id: artifact.id,
      slug: artifact.slug,
      title: artifact.title,
      state: artifact.state,
      relations: { ...artifact.relations },
      fields: { ...artifact.fields },
      dates: datesOf(artifact),
      progress: graph.progressOf(artifact.slug),
      done: artifact.progress?.done === true,
      body: artifact.body ?? '',
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const features = artifacts
    .filter((artifact) => artifact.kind === 'feature')
    .map((artifact) => ({
      kind: 'feature',
      id: artifact.id,
      slug: artifact.slug,
      title: artifact.title,
      state: artifact.state,
      relations: { ...artifact.relations },
      dates: datesOf(artifact),
      progress: graph.progressOf(artifact.slug),
      done: graph.isComplete(artifact),
      specs: graph.children(artifact.slug).map((spec) => spec.slug),
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const initiatives = artifacts
    .filter((artifact) => artifact.kind === 'initiative')
    .map((artifact) => ({
      kind: 'initiative',
      id: artifact.id,
      slug: artifact.slug,
      title: artifact.title,
      state: artifact.state,
      relations: { ...artifact.relations },
      dates: datesOf(artifact),
      progress: graph.progressOf(artifact.slug),
      done: graph.isComplete(artifact),
      features: graph.children(artifact.slug).map((feature) => feature.slug),
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const vision = artifacts.find((artifact) => artifact.kind === 'vision') ?? null;

  return {
    vision: vision ? { title: vision.title } : null,
    initiatives,
    features,
    specs,
  };
}

// ---------------------------------------------------------------------------
// Page rendering (chrome français, arbitrage 7) — one CSS constant inlined
// into every page, relative same-depth links, slugs/ids used as file names
// verbatim (PDR-001 / INV-5: never transformed, the page↔artifact bijection
// is the URL grammar).
// ---------------------------------------------------------------------------

const SITE_CSS = `
:root{--bg:#f5f6f8;--card:#ffffff;--ink:#1d2433;--muted:#5d6b7e;--line:#e2e6ee;--accent:#2f6fed}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:920px;margin:0 auto;padding:20px 20px 72px}
.crumbs{font-size:13px;color:var(--muted);margin-bottom:18px}
.crumbs a{color:var(--accent);text-decoration:none}
.crumbs a:hover{text-decoration:underline}
.crumbs .sep{margin:0 6px}
h1{font-size:26px;margin:6px 0 4px}
h2{font-size:19px;margin:30px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h3{font-size:16px;margin:22px 0 8px}
.meta{color:var(--muted);font-size:13.5px;margin:4px 0 0}
.badge{display:inline-block;font-size:11px;font-weight:600;letter-spacing:.4px;padding:2px 9px;border-radius:999px;vertical-align:middle;text-transform:uppercase;white-space:nowrap}
.badge.planned{background:#eef1f8;color:#51618c}
.badge.active{background:#e5f2ea;color:#188038}
.badge.archived{background:#eef0f3;color:#68727f}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin:12px 0}
.card h3{margin:0 0 8px}
.progress{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--muted);margin:6px 0}
.progress .bar{flex:1;height:8px;background:#e9edf4;border-radius:99px;overflow:hidden}
.progress .bar i{display:block;height:100%;background:var(--accent);border-radius:99px}
ul.roadmap{list-style:none;padding:0;margin:8px 0}
ul.roadmap li{padding:7px 10px;border-bottom:1px solid var(--line);background:var(--card)}
ul.roadmap li:first-child{border-radius:8px 8px 0 0}
ul.roadmap li:last-child{border-bottom:none;border-radius:0 0 8px 8px}
.check{font-weight:700}
a{color:var(--accent)}
code{background:#eef1f6;border-radius:4px;padding:1px 5px;font-size:.92em}
pre.code{background:#14181f;color:#dce3ee;padding:14px 16px;border-radius:8px;overflow:auto;font-size:13px;line-height:1.55}
pre.code.gherkin{background:#101a2b}
pre.code.gherkin strong{color:#8fc7ff}
pre.code code{background:transparent;color:inherit;padding:0}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px;background:var(--card)}
th,td{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top}
th{background:#eef1f6}
blockquote{border-left:3px solid var(--accent);margin:12px 0;padding:4px 14px;background:var(--card);border-radius:0 8px 8px 0}
blockquote p{margin:6px 0}
hr{border:none;border-top:1px solid var(--line);margin:22px 0}
.doc{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:6px 22px 14px;margin-top:14px}
.doc h1{font-size:21px}
.empty{color:var(--muted);font-style:italic}
`;

const STATE_LABEL = { planned: 'Planifié', active: 'Actif', archived: 'Archivé' };

function badge(state) {
  const label = STATE_LABEL[state] ?? STATE_LABEL.planned;
  return `<span class="badge ${escapeHtml(state ?? 'planned')}">${label}</span>`;
}

function crumb(label, href) {
  return href
    ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
    : `<span>${escapeHtml(label)}</span>`;
}

function crumbsHtml(parts) {
  return parts.map((part) => crumb(part.label, part.href)).join('<span class="sep">&gt;</span>');
}

function progressHtml(progress, unit) {
  const pct = progress.children > 0 ? Math.round((100 * progress.completed) / progress.children) : 0;
  return `<div class="progress"><span class="bar"><i style="width:${pct}%"></i></span>`
    + `<span>${pct}% (${progress.completed}/${progress.children} ${unit})</span></div>`;
}

function percentOf(progress) {
  return progress.children > 0 ? Math.round((100 * progress.completed) / progress.children) : 0;
}

function datesLine(dates) {
  return `Créé ${dates.created ?? '—'} · Mis à jour ${dates.updated ?? '—'}`;
}

function pageShell({ title, crumbs, content }) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${SITE_CSS}</style>
</head>
<body>
<main>
<nav class="crumbs">${crumbs}</nav>
${content}
</main>
</body>
</html>
`;
}

function dashboardHtml(site) {
  const title = site.vision ? `SDD — ${site.vision.title}` : 'SDD — Tableau de bord';
  const cards = site.initiatives.map((initiative) => {
    const specCount = initiative.features.reduce((sum, slug) => {
      const feature = site.features.find((entry) => entry.slug === slug);
      return sum + (feature ? feature.specs.length : 0);
    }, 0);
    return [
      '<article class="card">',
      `<h3><a href="initiatives/${escapeHtml(initiative.slug)}.html">${escapeHtml(initiative.title)}</a> ${badge(initiative.state)}</h3>`,
      progressHtml(initiative.progress, 'features'),
      `<p class="meta">${initiative.features.length} features · ${specCount} specs · ${datesLine(initiative.dates)}</p>`,
      '</article>',
    ].join('');
  });
  const content = [
    `<h1>${escapeHtml(title)}</h1>`,
    '<h2>Initiatives</h2>',
    cards.length > 0 ? cards.join('') : '<p class="empty">Aucune initiative cadrée.</p>',
  ].join('\n');
  return pageShell({
    title,
    crumbs: crumbsHtml([{ label: 'Sommaire' }, { label: 'Tableau de bord' }]),
    content,
  });
}

function initiativeHtml(site, initiative) {
  const title = `Initiative : ${initiative.title}`;
  const items = initiative.features.map((slug) => {
    const feature = site.features.find((entry) => entry.slug === slug);
    const glyph = feature?.done ? '☑' : '☐';
    return `<li><span class="check">${glyph}</span> <a href="../features/${escapeHtml(slug)}.html">${escapeHtml(slug)}</a>`
      + ` — ${escapeHtml(feature?.title ?? '')} ${badge(feature?.state)}</li>`;
  });
  const content = [
    `<h1>${escapeHtml(initiative.title)} ${badge(initiative.state)}</h1>`,
    `<p class="meta">Progression ${percentOf(initiative.progress)}% (${initiative.progress.completed}/${initiative.progress.children} features) · ${datesLine(initiative.dates)}</p>`,
    '<h2>Roadmap features</h2>',
    items.length > 0
      ? `<ul class="roadmap">${items.join('')}</ul>`
      : '<p class="empty">Aucune feature cadrée.</p>',
  ].join('\n');
  return pageShell({
    title,
    crumbs: crumbsHtml([
      { label: 'Sommaire', href: '../index.html' },
      { label: 'Initiatives' },
      { label: initiative.slug },
    ]),
    content,
  });
}

function featureHtml(site, feature) {
  const title = `Feature : ${feature.title}`;
  const initiative = site.initiatives.find((entry) => entry.slug === feature.relations?.initiative);
  const specs = site.specs.filter((spec) => spec.relations?.feature === feature.slug);
  const items = specs.map((spec) => `<li><span class="check">${spec.done ? '☑' : '☐'}</span>`
    + ` <a href="../specs/${escapeHtml(spec.id)}.html">${escapeHtml(spec.id)}</a>`
    + ` — ${escapeHtml(spec.title)} ${badge(spec.state)}</li>`);
  const content = [
    `<h1>${escapeHtml(feature.title)} ${badge(feature.state)}</h1>`,
    `<p class="meta">Progression ${percentOf(feature.progress)}% (${feature.progress.completed}/${feature.progress.children} specs) · ${datesLine(feature.dates)}</p>`,
    '<h2>Specs liées</h2>',
    items.length > 0
      ? `<ul class="roadmap">${items.join('')}</ul>`
      : '<p class="empty">Aucune spec liée.</p>',
  ].join('\n');
  return pageShell({
    title,
    crumbs: crumbsHtml([
      { label: 'Sommaire', href: '../index.html' },
      { label: 'Initiatives' },
      ...(initiative ? [{ label: initiative.slug, href: `../initiatives/${escapeHtml(initiative.slug)}.html` }] : []),
      { label: feature.slug },
    ]),
    content,
  });
}

function specHtml(site, spec) {
  const title = `Spec ${spec.id} — ${spec.title}`;
  const feature = site.features.find((entry) => entry.slug === spec.relations?.feature);
  const initiative = feature
    ? site.initiatives.find((entry) => entry.slug === feature.relations?.initiative)
    : site.initiatives.find((entry) => entry.slug === spec.relations?.initiative);
  const fields = Object.entries(spec.fields)
    .map(([key, value]) => `${escapeHtml(key)} ${renderInline(escapeHtml(String(value ?? '')))}`);
  const content = [
    `<h1>Spec ${escapeHtml(spec.id)} — ${escapeHtml(spec.title)} ${badge(spec.state)}</h1>`,
    fields.length > 0 ? `<p class="meta">${fields.join(' · ')}</p>` : '',
    `<p class="meta">${datesLine(spec.dates)}</p>`,
    `<div class="doc">${renderBodyHtml(spec.body)}</div>`,
  ].filter(Boolean).join('\n');
  return pageShell({
    title,
    crumbs: crumbsHtml([
      { label: 'Sommaire', href: '../index.html' },
      { label: 'Initiatives' },
      ...(initiative ? [{ label: initiative.slug, href: `../initiatives/${escapeHtml(initiative.slug)}.html` }] : []),
      ...(feature ? [{ label: feature.slug, href: `../features/${escapeHtml(feature.slug)}.html` }] : []),
      { label: spec.id },
    ]),
    content,
  });
}

/**
 * Renders every site page in memory (pure — no I/O): the dashboard, one page
 * per initiative, one per feature, one per spec. Paths are site-root
 * relative POSIX, derived from slugs/ids verbatim.
 * @returns {Array<{ path: string, kind: string, slug: string, html: string }>}
 */
export function renderSitePages(site) {
  const pages = [{
    path: 'index.html',
    kind: 'dashboard',
    slug: 'index',
    html: dashboardHtml(site),
  }];
  for (const initiative of site.initiatives) {
    pages.push({
      path: `initiatives/${initiative.slug}.html`,
      kind: 'initiative',
      slug: initiative.slug,
      html: initiativeHtml(site, initiative),
    });
  }
  for (const feature of site.features) {
    pages.push({
      path: `features/${feature.slug}.html`,
      kind: 'feature',
      slug: feature.slug,
      html: featureHtml(site, feature),
    });
  }
  for (const spec of site.specs) {
    pages.push({
      path: `specs/${spec.id}.html`,
      kind: 'spec',
      slug: spec.id,
      html: specHtml(site, spec),
    });
  }
  return pages;
}

/**
 * Writes the static site: full purge of `.sdd/site/` first (migrate
 * philosophy — idempotent rebuild, no parasite survives), then every page.
 * The purge is confined to the `site/` frontier; nothing outside
 * `.sdd/site/` is ever touched (INV-3).
 * @returns {Promise<Array<{ kind: string, slug: string, status: 'written', path: string }>>}
 */
export async function renderSite(cwd, artifacts) {
  const pages = renderSitePages(buildSiteModel(artifacts));

  await fsp.rm(siteRoot(cwd), { recursive: true, force: true });

  const results = [];
  for (const page of pages) {
    const absolute = path.join(siteRoot(cwd), page.path);
    await fsp.mkdir(path.dirname(absolute), { recursive: true });
    await fsp.writeFile(absolute, page.html, 'utf8');
    results.push({ kind: page.kind, slug: page.slug, status: 'written', path: `site/${page.path}` });
  }
  return results;
}
