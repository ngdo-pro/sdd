import path from 'node:path';
import fsp from 'node:fs/promises';
import { configPath, ensureDir, exists, standardLayout } from '../../core/paths.js';
import { defaultConfig, writeConfig } from '../../core/config.js';
import { assertNoCoexistence } from '../../migrate/migrate.js';
import { info, success } from '../render.js';

const SITE_IGNORE_ENTRY = '.sdd/site/';

/**
 * Setup-script responsibility (arbitrage 1 — sealed rule: init adds, the
 * render never touches): appends `.sdd/site/` to the root .gitignore, once,
 * only when the file ALREADY exists and the exact line is absent. The file
 * is never created and never rewritten otherwise — creating one in a
 * non-git workspace would be an out-of-scope side effect.
 */
async function ensureGitignoreSiteEntry(cwd) {
  const file = path.join(cwd, '.gitignore');
  if (!(await exists(file))) return;
  const content = await fsp.readFile(file, 'utf8');
  const hasEntry = content.split('\n').some((line) => line.trim() === SITE_IGNORE_ENTRY);
  if (hasEntry) return;
  const separator = content === '' || content.endsWith('\n') ? '' : '\n';
  await fsp.appendFile(file, `${separator}${SITE_IGNORE_ENTRY}\n`, 'utf8');
  info(`Added \`${SITE_IGNORE_ENTRY}\` to the root .gitignore (the static site is never committed).`);
}

/**
 * `spec init` — bootstraps `.sdd/canonical/` and the config. Creates nothing
 * else (the workspace setup script also pins `.sdd/site/` into an existing
 * root .gitignore). `--force` overwrites the config and is refused during a
 * pending migration (INV-5 coexistence lock).
 */
export async function init({ cwd, flags }) {
  if (flags.force) assertNoCoexistence(cwd);

  for (const dir of standardLayout(cwd)) {
    await ensureDir(dir);
  }

  const file = configPath(cwd);
  if ((await exists(file)) && !flags.force) {
    info('Config already present at .sdd/config.json (use --force to overwrite).');
  } else {
    await writeConfig(cwd, defaultConfig());
    success('Created .sdd/config.json');
  }

  await ensureGitignoreSiteEntry(cwd);

  success('Initialized .sdd/ (canonical model + markdown projections).');
}