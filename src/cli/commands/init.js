import { configPath, ensureDir, exists, standardLayout } from '../../core/paths.js';
import { defaultConfig, writeConfig } from '../../core/config.js';
import { assertNoCoexistence } from '../../migrate/migrate.js';
import { info, success } from '../render.js';

/**
 * `spec init` — bootstraps `.sdd/canonical/` and the config. Creates nothing
 * else. `--force` overwrites the config and is refused during a pending
 * migration (INV-5 coexistence lock).
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

  success('Initialized .sdd/ (canonical model + markdown projections).');
}