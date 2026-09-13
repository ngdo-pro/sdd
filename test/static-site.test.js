import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildSiteModel, renderBodyHtml, renderSitePages } from '../src/render/site.js';
import { createMeta } from '../src/model/schema.js';
import { loadModel } from '../src/model/store.js';
import { writeIndex } from '../src/model/index.js';
import { renderProjections } from '../src/render/projections.js';
import { init } from '../src/cli/commands/init.js';
import { upsert } from '../src/cli/commands/upsert.js';
import { render } from '../src/cli/commands/render.js';
import { validate } from '../src/cli/commands/validate.js';
import { UsageError, MigrationError } from '../src/core/errors.js';
import { makeWorkspace, cleanup, seedModel, writeFiles, readWorkspaceFile, fileExists } from './helpers.js';

const BASE_FLAGS = {
  to: undefined, kind: undefined, state: undefined, slug: undefined, title: undefined,
  from: undefined, feature: undefined, initiative: undefined, field: undefined,
  backends: undefined, create: false, force: false, check: false, write: false,
  cascade: false, undo: false, done: false, site: false, dryRun: false, json: false,
};

function ctx(cwd, positionals = [], flags = {}) {
  return { cwd, positionals, flags: { ...BASE_FLAGS, ...flags } };
}

async function silently(handler) {
  const original = process.stdout.write;
  process.stdout.write = () => true;
  try {
    return await handler();
  } finally {
    process.stdout.write = original;
  }
}

/** Captures stdout while measuring `process.exitCode`. */
async function capturingExitCode(handler) {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    process.exitCode = 0;
    await handler();
    return { output: chunks.join(''), exitCode: process.exitCode };
  } finally {
    process.stdout.write = original;
  }
}

/** Snapshot of every file under a base directory: `{ relativePath: content }`. */
async function snapshot(root, base) {
  const files = {};
  async function walk(directory) {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        const relative = path.relative(root, absolute).split(path.sep).join('/');
        files[relative] = await fsp.readFile(absolute, 'utf8');
      }
    }
  }
  await walk(path.join(root, base));
  return files;
}

/** Sorted list of every path (files + dirs) under a base directory. */
async function listPaths(root, base) {
  const paths = [];
  async function walk(directory) {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const relative = path.relative(root, path.join(directory, entry.name)).split(path.sep).join('/');
      paths.push(relative);
      if (entry.isDirectory()) await walk(path.join(directory, entry.name));
    }
  }
  await walk(path.join(root, base));
  return paths.sort();
}

/** Deletes every site/ key from a workspace snapshot (bit-to-bit comparison). */
function withoutSite(files) {
  return Object.fromEntries(Object.entries(files).filter(([relative]) => !relative.startsWith('.sdd/site')));
}

/** Mixed-state fixture: vision + active initiative + 2 features + 2 specs. */
const MIXED_FIXTURE = [
  { kind: 'vision', slug: 'vision', title: 'Démo', body: '## 1. Core Purpose\n\nDémo.\n' },
  { kind: 'initiative', slug: 'demo', title: 'Démo initiative', state: 'active', body: '## 1. Intent\n\nDémo.\n' },
  { kind: 'feature', slug: '01-done', title: 'Feature done', state: 'archived', relations: { initiative: 'demo' }, body: '## 1. Problem\n\nFait.\n' },
  {
    kind: 'spec', slug: '042-first', title: 'Spec one', state: 'archived',
    relations: { feature: '01-done', initiative: 'demo' }, body: '## 1. Intent\n\nUn.\n',
  },
  { kind: 'feature', slug: '02-open', title: 'Feature open', state: 'active', relations: { initiative: 'demo' }, body: '## 1. Problem\n\nOuvert.\n' },
  {
    kind: 'spec', slug: '043-second', title: 'Spec two', state: 'planned',
    relations: { feature: '02-open', initiative: 'demo' }, body: '## 1. Intent\n\nDeux.\n',
  },
];

// ============================================================================
// Unit Tests (@unit) — §8.1 scenarios U1–U4
// ============================================================================

test('[U1][INV-2] the site module is zero-dependency: node: builtins only, no runtime dep', async () => {
  const modulePath = fileURLToPath(new URL('../src/render/site.js', import.meta.url));
  const source = await readFile(modulePath, 'utf8');

  const imports = [...source.matchAll(/import\s+[^;]*?from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
  assert.ok(imports.length > 0, 'the module must declare its imports');
  for (const source0 of imports) {
    assert.match(source0, /^node:/, `import "${source0}" is not a node: builtin`);
  }

  const pkg = JSON.parse(await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  assert.equal(pkg.dependencies, undefined, 'no runtime dependency may be declared');
});

test('[U2][INV-2] the minimal converter covers the template constructs and escapes everything', () => {
  const body = [
    '# Titre principal',
    '#### Quatrième niveau',
    '',
    'Texte avec **gras**, *italique*, `code` et un [lien](./generated/x.md).',
    '',
    'HTML inline : <b>jamais interprété</b> & <script>alert("x")</script>',
    '',
    '- [x] fait',
    '- [ ] à faire',
    '  ↳ *détail:* sous-item',
    '- deuxième point',
    '',
    '> citation ligne 1',
    '> citation ligne 2',
    '',
    '| Col A | Col B |',
    '|---|---|',
    '| a1 | a2 |',
    '',
    '---',
    '',
    '```gherkin',
    'Feature: Démo',
    '  Scenario: un scénario',
    '    Given un état',
    '    When une action',
    '    Then un résultat',
    '```',
    '',
    '```text',
    '# pas un titre | pas une table',
    '```',
    '',
  ].join('\n');

  const html = renderBodyHtml(body);

  // Headings with anchors.
  assert.match(html, /<h1 id="titre-principal">Titre principal<\/h1>/);
  assert.match(html, /<h4 id="quatrieme-niveau">Quatrième niveau<\/h4>/);

  // Inline styles + link reduced to its label.
  assert.match(html, /<strong>gras<\/strong>/);
  assert.match(html, /<em>italique<\/em>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /et un lien\./);
  assert.equal(html.includes('./generated/x.md'), false);
  assert.equal(html.includes('<a '), false);

  // Inline HTML degraded to escaped text — never interpreted.
  assert.match(html, /&lt;b&gt;jamais interprété&lt;\/b&gt;/);
  assert.match(html, /&amp; &lt;script&gt;/);
  assert.equal(html.includes('<script>'), false);

  // Checkbox lists with glyphs + nested level-2 list.
  assert.match(html, /<ul><li>☑ fait<\/li><li>☐ à faire<ul><li><em>détail:<\/em> sous-item<\/li><\/ul><\/li><li>deuxième point<\/li><\/ul>/);

  // Blockquote.
  assert.match(html, /<blockquote><p>citation ligne 1<\/p><p>citation ligne 2<\/p><\/blockquote>/);

  // Pipe table.
  assert.match(html, /<table><thead><tr><th>Col A<\/th><th>Col B<\/th><\/tr><\/thead><tbody><tr><td>a1<\/td><td>a2<\/td><\/tr><\/tbody><\/table>/);

  // Horizontal rule.
  assert.match(html, /<hr>/);

  // Gherkin fence: dedicated style + bolded keywords.
  assert.match(html, /<pre class="code gherkin">/);
  assert.match(html, /<strong>Feature<\/strong>: Démo/);
  assert.match(html, /<strong>Given<\/strong> un état/);
  assert.match(html, /<strong>Then<\/strong> un résultat/);

  // Plain fence: literal content — a title/pipe lookalike stays code.
  assert.match(html, /<pre class="code"># pas un titre \| pas une table<\/pre>/);
  assert.equal(html.split('<h1').length, 2, 'no heading may be produced inside a fence');
  assert.equal((html.match(/<th>/g) ?? []).length, 2, 'only the real table cells exist — none inside a fence');
});

test('[U3][INV-1] buildSiteModel derives graph progress with zero I/O', () => {
  const now = '2026-09-13';
  const initiative = {
    ...createMeta({ kind: 'initiative', slug: 'demo', title: 'Démo', state: 'active' }),
    createdAt: now, updatedAt: now, body: '',
  };
  const feature = {
    ...createMeta({ kind: 'feature', slug: '01-login', title: 'Login', state: 'active', relations: { initiative: 'demo' } }),
    createdAt: now, updatedAt: now, body: '',
  };
  const done = {
    ...createMeta({ kind: 'spec', slug: '042-a', title: 'A', state: 'active', relations: { feature: '01-login', initiative: 'demo' }, progress: { done: true } }),
    createdAt: now, updatedAt: now, body: '## 1. Intent\n\nA.\n',
  };
  const open = {
    ...createMeta({ kind: 'spec', slug: '043-b', title: 'B', state: 'planned', relations: { feature: '01-login', initiative: 'demo' } }),
    createdAt: now, updatedAt: now, body: '',
  };

  // buildSiteModel is synchronous and pure: it derives everything from the
  // hydrated artifacts alone — no filesystem, no index, no projection.
  const site = buildSiteModel([initiative, feature, done, open]);

  assert.equal(site.vision, null);
  assert.deepEqual(site.features[0].progress, { children: 2, completed: 1, complete: false });
  assert.deepEqual(site.initiatives[0].progress, { children: 1, completed: 0, complete: false });
  assert.equal(site.initiatives[0].done, false);
  assert.equal(site.features[0].done, false);
  assert.deepEqual(site.initiatives[0].features, ['01-login']);
  assert.deepEqual(site.features[0].specs, ['042-a', '043-b']);

  // Dates come from the metadata, untouched.
  assert.deepEqual(site.specs[0].dates, { created: now, updated: now });
  assert.deepEqual(site.initiatives[0].dates, { created: now, updated: now });
});

test('[U4][INV-1] the URL grammar is relative and closed over the site/ tree', () => {
  const now = '2026-09-13';
  const artifacts = [
    { ...createMeta({ kind: 'vision', slug: 'vision', title: 'Démo' }), createdAt: now, updatedAt: now, body: '' },
    { ...createMeta({ kind: 'initiative', slug: 'demo', title: 'Démo', state: 'active' }), createdAt: now, updatedAt: now, body: '' },
    { ...createMeta({ kind: 'feature', slug: '01-login', title: 'Login', state: 'active', relations: { initiative: 'demo' } }), createdAt: now, updatedAt: now, body: '' },
    { ...createMeta({ kind: 'spec', slug: '042-login', title: 'Magic link', state: 'active', relations: { feature: '01-login', initiative: 'demo' } }), createdAt: now, updatedAt: now, body: '' },
  ];
  const pages = renderSitePages(buildSiteModel(artifacts));
  const pagePaths = new Set(pages.map((page) => page.path));

  assert.deepEqual([...pagePaths].sort(), [
    'features/01-login.html',
    'index.html',
    'initiatives/demo.html',
    'specs/042.html',
  ]);

  // Every cross link (dashboard, roadmaps, breadcrumbs) must resolve,
  // relative to its own page, onto a page of the tree — never outside, never
  // absolute.
  for (const page of pages) {
    const directory = path.posix.dirname(page.path);
    for (const match of page.html.matchAll(/href="([^"]+)"/g)) {
      const target = match[1];
      assert.equal(path.posix.isAbsolute(target), false, `absolute href "${target}" in ${page.path}`);
      const resolved = path.posix.normalize(path.posix.join(directory, target));
      assert.ok(
        pagePaths.has(resolved),
        `href "${target}" in ${page.path} resolves to "${resolved}" — not a site page`,
      );
    }
  }
});

// ============================================================================
// Component Tests (@component) — §8.1 scenarios C1–C8
// ============================================================================

test('[C1][INV-1] render --site produces the exact site/ tree from the model', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, MIXED_FIXTURE);

    const { output, exitCode } = await capturingExitCode(() => render(ctx(root, [], { site: true })));
    assert.equal(exitCode, 0);
    assert.match(output, /initiative\s+demo\s+site\/initiatives\/demo\.html/);

    assert.deepEqual(await listPaths(root, '.sdd/site'), [
      '.sdd/site/features',
      '.sdd/site/features/01-done.html',
      '.sdd/site/features/02-open.html',
      '.sdd/site/index.html',
      '.sdd/site/initiatives',
      '.sdd/site/initiatives/demo.html',
      '.sdd/site/specs',
      '.sdd/site/specs/042.html',
      '.sdd/site/specs/043.html',
    ]);

    const dashboard = await readWorkspaceFile(root, '.sdd/site/index.html');
    assert.match(dashboard, /<span class="badge active">Actif<\/span>/);
    assert.match(dashboard, /50% \(1\/2 features\)/);
    assert.match(dashboard, /Créé \d{4}-\d{2}-\d{2} · Mis à jour \d{4}-\d{2}-\d{2}/);
    assert.match(dashboard, /href="initiatives\/demo\.html"/);

    const initiativePage = await readWorkspaceFile(root, '.sdd/site/initiatives/demo.html');
    assert.match(initiativePage, /Roadmap features/);
    assert.equal((initiativePage.match(/☑/g) ?? []).length, 1, 'one complete feature checked');
    assert.equal((initiativePage.match(/☐/g) ?? []).length, 1, 'one open feature unchecked');
    assert.match(initiativePage, /href="..\/features\/01-done\.html"/);

    const specPage = await readWorkspaceFile(root, '.sdd/site/specs/042.html');
    assert.match(specPage, /<div class="doc">/);
    assert.match(specPage, /Sommaire/);
  } finally {
    await cleanup(root);
  }
});

test('[C2][INV-3] write frontier: nothing outside .sdd/site/ is touched', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, MIXED_FIXTURE);
    const artifacts = await loadModel(root);
    await renderProjections(root, artifacts);
    await writeIndex(root, artifacts);
    await writeFiles(root, { '.gitignore': 'node_modules/\n' });

    const before = await snapshot(root, '.sdd');
    const gitignoreBefore = await readWorkspaceFile(root, '.gitignore');

    await silently(() => render(ctx(root, [], { site: true })));

    const after = await snapshot(root, '.sdd');
    assert.deepEqual(withoutSite(after), before);
    assert.equal(await readWorkspaceFile(root, '.gitignore'), gitignoreBefore);
  } finally {
    await cleanup(root);
  }
});

test('[C3][INV-1] full idempotent regeneration: the parasite dies on the first call', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, MIXED_FIXTURE);
    await silently(() => render(ctx(root, [], { site: true })));
    await writeFiles(root, { '.sdd/site/x.html': '<html>parasite</html>' });

    await silently(() => render(ctx(root, [], { site: true })));
    assert.equal(await fileExists(root, '.sdd/site/x.html'), false, 'purged on the first call');
    const first = await snapshot(root, '.sdd/site');

    await silently(() => render(ctx(root, [], { site: true })));
    assert.deepEqual(await snapshot(root, '.sdd/site'), first, 'second call rebuilds the identical tree');
  } finally {
    await cleanup(root);
  }
});

test('[C4][INV-3] validate tolerates site/ and still refuses any other root entry', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, MIXED_FIXTURE);
    await silently(() => render(ctx(root, [], { site: true })));

    const clean = await capturingExitCode(() => validate(ctx(root)));
    assert.equal(clean.exitCode, 0);
    assert.equal(clean.output.includes('root-layout'), false);

    await writeFiles(root, { '.sdd/autre/notes.md': '# Notes\n' });
    const violated = await capturingExitCode(() => validate(ctx(root)));
    assert.match(violated.output, /\[root-layout\]/);
    assert.match(violated.output, /unexpected root entry "autre\/"/);
    assert.equal(violated.exitCode, 1);
    process.exitCode = 0;
  } finally {
    await cleanup(root);
  }
});

test('[C5][arbitrage 1] init pins the .gitignore entry idempotently, never creates the file', async () => {
  // 1. Existing .gitignore without the entry → added exactly once.
  const first = await makeWorkspace();
  try {
    await writeFiles(first, { '.gitignore': 'node_modules/\n' });
    await silently(() => init(ctx(first)));
    let content = await readWorkspaceFile(first, '.gitignore');
    assert.equal(content.split('\n').filter((line) => line.trim() === '.sdd/site/').length, 1);

    // 4. Re-init the same workspace → still exactly once (no duplicate).
    await silently(() => init(ctx(first)));
    content = await readWorkspaceFile(first, '.gitignore');
    assert.equal(content.split('\n').filter((line) => line.trim() === '.sdd/site/').length, 1);
  } finally {
    await cleanup(first);
  }

  // 2. Already-compliant .gitignore → byte-identical, silent.
  const second = await makeWorkspace();
  try {
    const compliant = 'node_modules/\n.sdd/site/\n';
    await writeFiles(second, { '.gitignore': compliant });
    await silently(() => init(ctx(second)));
    assert.equal(await readWorkspaceFile(second, '.gitignore'), compliant);
  } finally {
    await cleanup(second);
  }

  // 3. No .gitignore → never created.
  const third = await makeWorkspace();
  try {
    await silently(() => init(ctx(third)));
    assert.equal(await fileExists(third, '.gitignore'), false);
  } finally {
    await cleanup(third);
  }
});

test('[C6][INV-4] --check never inspects site/ and refuses the flag conflict', async () => {
  const root = await makeWorkspace();
  try {
    await seedModel(root, MIXED_FIXTURE);
    const artifacts = await loadModel(root);
    await renderProjections(root, artifacts);
    // A falsified site/: --check must ignore it entirely.
    await writeFiles(root, { '.sdd/site/index.html': 'tampered\n' });

    const clean = await silently(async () => {
      process.exitCode = 0;
      await render(ctx(root, [], { check: true }));
      return process.exitCode;
    });
    assert.equal(clean, 0, 'a tampered site/ may not fail the generated/ drift guard');
    process.exitCode = 0;

    // Flag conflict: UsageError (exit 2 through bin/spec.js), nothing written.
    await assert.rejects(
      () => render(ctx(root, [], { site: true, check: true })),
      (error) => error instanceof UsageError && error.exitCode === 2,
    );
    await assert.rejects(
      () => render(ctx(root, [], { site: true, dryRun: true })),
      UsageError,
    );
    assert.equal(await readWorkspaceFile(root, '.sdd/site/index.html'), 'tampered\n');
  } finally {
    await cleanup(root);
  }
});

test('[C7][arbitrage 9] the coexistence guard locks --site too', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, {
      '.sdd/canonical/index.json': '{\n  "version": 3\n}\n',
      '.specs/specs/active/042-login.md': '# Spec: 042 - Login\n',
    });

    await assert.rejects(
      () => render(ctx(root, [], { site: true })),
      (error) => error instanceof MigrationError && error.exitCode === 1,
    );
    assert.equal(await fileExists(root, '.sdd/site'), false, 'nothing may be written under coexistence');
  } finally {
    await cleanup(root);
  }
});

test('[C8][INV-1] empty model: warning, nothing written, pre-existing site/ intact', async () => {
  const root = await makeWorkspace();
  try {
    await silently(() => init(ctx(root)));
    await writeFiles(root, { '.sdd/site/index.html': 'precious\n' });

    const { output, exitCode } = await capturingExitCode(() => render(ctx(root, [], { site: true })));
    assert.match(output, /model is empty/);
    assert.equal(exitCode, 0);
    assert.equal(await readWorkspaceFile(root, '.sdd/site/index.html'), 'precious\n');
  } finally {
    await cleanup(root);
  }
});

// ============================================================================
// Integration Tests (@integration) — §8.1 scenarios I1, I2
// ============================================================================

test('[I1][INV-1][INV-3] full cycle: setup gitignore, site built, roots stay compliant', async () => {
  const root = await makeWorkspace();
  try {
    await writeFiles(root, { '.gitignore': 'node_modules/\n' });
    await silently(() => init(ctx(root)));
    await silently(() => upsert(ctx(root, ['initiative'], { slug: 'demo', title: 'Démo' })));
    await silently(() => upsert(ctx(root, ['feature'], { slug: '01-login', title: 'Login', initiative: 'demo' })));
    await silently(() => upsert(ctx(root, ['spec'], { slug: '042-login', title: 'Magic link', feature: '01-login' })));

    await silently(() => render(ctx(root, [], { site: true })));

    const gitignore = await readWorkspaceFile(root, '.gitignore');
    assert.equal(gitignore.split('\n').filter((line) => line.trim() === '.sdd/site/').length, 1);

    assert.deepEqual(await listPaths(root, '.sdd/site'), [
      '.sdd/site/features',
      '.sdd/site/features/01-login.html',
      '.sdd/site/index.html',
      '.sdd/site/initiatives',
      '.sdd/site/initiatives/demo.html',
      '.sdd/site/specs',
      '.sdd/site/specs/042.html',
    ]);

    assert.equal(await capturingExitCode(() => validate(ctx(root))).then((r) => r.exitCode), 0);
    const check = await silently(async () => {
      process.exitCode = 0;
      await render(ctx(root, [], { check: true }));
      return process.exitCode;
    });
    assert.equal(check, 0);
    process.exitCode = 0;
  } finally {
    await cleanup(root);
  }
});

test('[I2][arbitrage 8] the site is independent of projections.markdown', async () => {
  const root = await makeWorkspace();
  try {
    await silently(() => init(ctx(root)));
    await writeFiles(root, {
      '.sdd/config.json': JSON.stringify({ version: 2, projections: { markdown: false } }),
    });
    await silently(() => upsert(ctx(root, ['initiative'], { slug: 'demo', title: 'Démo' })));
    await silently(() => upsert(ctx(root, ['feature'], { slug: '01-login', title: 'Login', initiative: 'demo' })));
    await silently(() => upsert(ctx(root, ['spec'], { slug: '042-login', title: 'Magic link', feature: '01-login' })));

    // Plain render: no markdown projection at all (index only).
    await silently(() => render(ctx(root)));
    assert.equal(await fileExists(root, '.sdd/generated'), false);

    // The site is generated anyway — it never reads the config.
    await silently(() => render(ctx(root, [], { site: true })));
    assert.equal(await fileExists(root, '.sdd/site/index.html'), true);
    assert.equal(await fileExists(root, '.sdd/site/specs/042.html'), true);
    assert.equal(await fileExists(root, '.sdd/generated'), false);

    // --check exits 0 vacuously (no projection expected or verified).
    const check = await silently(async () => {
      process.exitCode = 0;
      await render(ctx(root, [], { check: true }));
      return process.exitCode;
    });
    assert.equal(check, 0);
    process.exitCode = 0;
  } finally {
    await cleanup(root);
  }
});
