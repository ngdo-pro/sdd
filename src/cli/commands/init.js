import { configPath, ensureDir, exists, standardLayout } from '../../core/paths.js';
import { defaultConfig, writeConfig } from '../../core/config.js';
import { info, success } from '../render.js';

/** `spec init` — bootstraps `.specs/canonical/` and the config. Creates nothing else. */
export async function init({ cwd, flags }) {
  for (const dir of standardLayout(cwd)) {
    await ensureDir(dir);
  }

  const file = configPath(cwd);
  if ((await exists(file)) && !flags.force) {
    info('Config already present at .specs/config.json (use --force to overwrite).');
  } else {
    await writeConfig(cwd, defaultConfig());
    success('Created .specs/config.json');
  }

  success('Initialized .specs/ (canonical model + markdown projections).');
}
